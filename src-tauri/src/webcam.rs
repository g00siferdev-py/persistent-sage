//! Native webcam capture (Windows MSMF / macOS AVFoundation / Linux V4L2).
//! Bypasses WebView2 `getUserMedia`, which often cannot access the camera in Tauri desktop apps.

use std::sync::mpsc::{self, SyncSender};
use std::thread::{self, JoinHandle};

use base64::Engine;
use nokhwa::pixel_format::RgbFormat;
use nokhwa::utils::{
    ApiBackend, CameraFormat, CameraIndex, FrameFormat, RequestedFormat, RequestedFormatType,
    Resolution,
};
use nokhwa::{query, Camera};
use serde::Serialize;

const PREVIEW_MAX_WIDTH: u32 = 480;
const PREVIEW_JPEG_QUALITY: u8 = 70;
const CAPTURE_JPEG_QUALITY: u8 = 92;

enum WebcamRequest {
    Start(SyncSender<Result<(), String>>),
    Preview(SyncSender<Result<WebcamImageResponse, String>>),
    Capture(SyncSender<Result<WebcamImageResponse, String>>),
    Stop(SyncSender<Result<(), String>>),
    Shutdown,
}

pub struct WebcamService {
    tx: mpsc::Sender<WebcamRequest>,
    worker: Option<JoinHandle<()>>,
}

impl Default for WebcamService {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for WebcamService {
    fn drop(&mut self) {
        let _ = self.tx.send(WebcamRequest::Shutdown);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebcamImageResponse {
    pub image_base64: String,
    pub mime_type: String,
}

impl WebcamService {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel();
        let worker = thread::Builder::new()
            .name("webcam-worker".into())
            .spawn(move || webcam_worker(rx))
            .expect("spawn webcam worker");
        Self {
            tx,
            worker: Some(worker),
        }
    }

    fn send_and_wait<T: Send>(
        &self,
        build: impl FnOnce(SyncSender<Result<T, String>>) -> WebcamRequest,
    ) -> Result<T, String> {
        let (reply_tx, reply_rx) = mpsc::sync_channel(1);
        self.tx
            .send(build(reply_tx))
            .map_err(|_| "webcam worker is not running".to_string())?;
        reply_rx
            .recv()
            .map_err(|_| "webcam worker did not respond".to_string())?
    }

    pub fn start(&self) -> Result<(), String> {
        self.send_and_wait(WebcamRequest::Start)
    }

    pub fn preview(&self) -> Result<WebcamImageResponse, String> {
        self.send_and_wait(WebcamRequest::Preview)
    }

    pub fn capture(&self) -> Result<WebcamImageResponse, String> {
        self.send_and_wait(WebcamRequest::Capture)
    }

    pub fn stop(&self) -> Result<(), String> {
        self.send_and_wait(WebcamRequest::Stop)
    }
}

fn webcam_worker(rx: mpsc::Receiver<WebcamRequest>) {
    let mut session: Option<Camera> = None;

    while let Ok(req) = rx.recv() {
        match req {
            WebcamRequest::Start(reply) => {
                let result = if session.is_some() {
                    Ok(())
                } else {
                    open_first_working_camera().map(|camera| {
                        session = Some(camera);
                    })
                };
                let _ = reply.send(result);
            }
            WebcamRequest::Preview(reply) => {
                let result = match session.as_mut() {
                    Some(camera) => capture_live_preview(camera),
                    None => Err("Camera is not open.".to_string()),
                };
                let _ = reply.send(result);
            }
            WebcamRequest::Capture(reply) => {
                let result = match session.as_mut() {
                    Some(camera) => capture_still(camera),
                    None => Err("Camera is not open.".to_string()),
                };
                let _ = reply.send(result);
            }
            WebcamRequest::Stop(reply) => {
                if let Some(mut camera) = session.take() {
                    let _ = camera.stop_stream();
                }
                let _ = reply.send(Ok(()));
            }
            WebcamRequest::Shutdown => break,
        }
    }

    if let Some(mut camera) = session.take() {
        let _ = camera.stop_stream();
    }
}

fn freshest_frame(camera: &mut Camera) -> Result<nokhwa::Buffer, String> {
    let mut frame = camera
        .frame()
        .map_err(|e| format!("Could not read camera frame: {e}"))?;
    for _ in 0..2 {
        match camera.frame() {
            Ok(next) => frame = next,
            Err(_) => break,
        }
    }
    Ok(frame)
}

fn capture_live_preview(camera: &mut Camera) -> Result<WebcamImageResponse, String> {
    let frame = freshest_frame(camera)?;
    frame_to_jpeg(&frame, true)
}

fn capture_still(camera: &mut Camera) -> Result<WebcamImageResponse, String> {
    let frame = freshest_frame(camera)?;
    frame_to_jpeg(&frame, false)
}

fn frame_to_jpeg(frame: &nokhwa::Buffer, preview: bool) -> Result<WebcamImageResponse, String> {
    if frame.source_frame_format() == FrameFormat::MJPEG {
        return Ok(WebcamImageResponse {
            image_base64: base64::engine::general_purpose::STANDARD.encode(frame.buffer()),
            mime_type: "image/jpeg".into(),
        });
    }

    let decoded = frame
        .decode_image::<RgbFormat>()
        .map_err(|e| format!("Could not decode camera frame: {e}"))?;
    let width = decoded.width();
    let height = decoded.height();
    let raw = decoded.into_raw();

    if preview {
        let (out_w, out_h, pixels) = downscale_rgb(raw, width, height, PREVIEW_MAX_WIDTH);
        return encode_rgb_jpeg(&pixels, out_w, out_h, PREVIEW_JPEG_QUALITY);
    }

    encode_rgb_jpeg(&raw, width, height, CAPTURE_JPEG_QUALITY)
}

fn downscale_rgb(raw: Vec<u8>, width: u32, height: u32, max_width: u32) -> (u32, u32, Vec<u8>) {
    if width <= max_width {
        return (width, height, raw);
    }
    let Some(img) = image::RgbImage::from_raw(width, height, raw) else {
        return (width, height, Vec::new());
    };
    let new_h = ((height as f64) * (max_width as f64) / (width as f64)).round() as u32;
    let resized = image::imageops::resize(
        &img,
        max_width,
        new_h.max(1),
        image::imageops::FilterType::Nearest,
    );
    (max_width, new_h.max(1), resized.into_raw())
}

fn encode_rgb_jpeg(
    raw: &[u8],
    width: u32,
    height: u32,
    quality: u8,
) -> Result<WebcamImageResponse, String> {
    let mut bytes = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality);
    encoder
        .encode(raw, width, height, image::ExtendedColorType::Rgb8)
        .map_err(|e| format!("Could not encode JPEG: {e}"))?;

    Ok(WebcamImageResponse {
        image_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        mime_type: "image/jpeg".into(),
    })
}

fn camera_hint() -> String {
    let count = query(ApiBackend::Auto)
        .map(|c| c.len())
        .unwrap_or(0);
    if count == 0 {
        "No camera was detected. Plug in a webcam or check Device Manager.".into()
    } else {
        format!(
            "Found {count} camera(s), but none could be opened. In Windows Settings → Privacy & security → Camera, turn on “Let desktop apps access your camera” (Persistent Sage may not appear in the per-app list). Close Zoom, Teams, or other apps using the camera, then try again."
        )
    }
}

fn backends_to_try() -> Vec<ApiBackend> {
    #[cfg(windows)]
    {
        vec![ApiBackend::MediaFoundation, ApiBackend::Auto]
    }
    #[cfg(not(windows))]
    {
        vec![ApiBackend::Auto]
    }
}

fn preview_formats() -> [RequestedFormat<'static>; 3] {
    [
        RequestedFormat::new::<RgbFormat>(RequestedFormatType::Closest(
            CameraFormat::new(Resolution::new(640, 480), FrameFormat::MJPEG, 30),
        )),
        RequestedFormat::new::<RgbFormat>(RequestedFormatType::Closest(
            CameraFormat::new(Resolution::new(1280, 720), FrameFormat::MJPEG, 30),
        )),
        RequestedFormat::new::<RgbFormat>(RequestedFormatType::Closest(
            CameraFormat::new(Resolution::new(640, 480), FrameFormat::YUYV, 30),
        )),
    ]
}

fn try_open_camera(
    index: CameraIndex,
    requested: &RequestedFormat<'_>,
    backend: ApiBackend,
) -> Option<Camera> {
    let Ok(mut camera) = Camera::with_backend(index, requested.clone(), backend) else {
        return None;
    };
    if camera.open_stream().is_err() {
        return None;
    }
    for _ in 0..4 {
        if camera.frame().is_ok() {
            return Some(camera);
        }
    }
    let _ = camera.stop_stream();
    None
}

fn open_first_working_camera() -> Result<Camera, String> {
    let formats = preview_formats();

    for backend in backends_to_try() {
        let Ok(cameras) = query(backend) else {
            continue;
        };
        for info in &cameras {
            let index = info.index().clone();
            for requested in &formats {
                if let Some(camera) = try_open_camera(index.clone(), requested, backend) {
                    eprintln!(
                        "persistent-sage: opened camera {} via {:?} ({:?} @ {}x{} {}fps)",
                        info.human_name(),
                        backend,
                        camera.frame_format(),
                        camera.resolution().width(),
                        camera.resolution().height(),
                        camera.frame_rate()
                    );
                    return Ok(camera);
                }
            }
        }
    }

    for idx in 0..4u32 {
        for backend in backends_to_try() {
            for requested in &formats {
                if let Some(camera) =
                    try_open_camera(CameraIndex::Index(idx), requested, backend)
                {
                    eprintln!("persistent-sage: opened camera index {idx} via {backend:?}");
                    return Ok(camera);
                }
            }
        }
    }

    Err(camera_hint())
}

#[tauri::command]
pub fn webcam_start(service: tauri::State<'_, WebcamService>) -> Result<(), String> {
    service.start()
}

#[tauri::command]
pub fn webcam_preview(service: tauri::State<'_, WebcamService>) -> Result<WebcamImageResponse, String> {
    service.preview()
}

#[tauri::command]
pub fn webcam_capture(service: tauri::State<'_, WebcamService>) -> Result<WebcamImageResponse, String> {
    service.capture()
}

#[tauri::command]
pub fn webcam_stop(service: tauri::State<'_, WebcamService>) -> Result<(), String> {
    service.stop()
}
