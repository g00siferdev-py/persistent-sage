import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";

import {
  captureNativeWebcamBlob,
  drawJpegBase64OnCanvas,
  fetchNativeWebcamPreview,
  isTauriApp,
  stopNativeWebcam,
  tryStartNativeWebcam,
} from "@/lib/nativeWebcam";
import { requestWebcamStream, stopMediaStream, waitForVideoReady } from "@/lib/webcam";

type Props = {
  open: boolean;
  onClose: () => void;
  onCapture: (blob: Blob) => void;
};

type CaptureMode = "native" | "browser";

export function WebcamCaptureModal({ open, onClose, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const previewActiveRef = useRef(false);
  const previewBusyRef = useRef(false);
  const readyRef = useRef(false);
  const [mode, setMode] = useState<CaptureMode | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const stopPreviewLoop = useCallback(() => {
    previewActiveRef.current = false;
    if (previewFrameRef.current !== null) {
      cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
  }, []);

  const releaseBrowserStream = useCallback(() => {
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    stopPreviewLoop();
    releaseBrowserStream();
    void stopNativeWebcam();
    previewBusyRef.current = false;
    readyRef.current = false;
    setMode(null);
    setReady(false);
    setError(null);
    setCapturing(false);
  }, [stopPreviewLoop, releaseBrowserStream]);

  const runNativePreviewLoop = useCallback(() => {
    stopPreviewLoop();
    previewActiveRef.current = true;

    const tick = async () => {
      if (!previewActiveRef.current) return;

      if (!previewBusyRef.current) {
        previewBusyRef.current = true;
        try {
          const base64 = await fetchNativeWebcamPreview();
          const canvas = canvasRef.current;
          if (canvas) {
            await drawJpegBase64OnCanvas(canvas, base64);
            if (!readyRef.current) {
              readyRef.current = true;
              setReady(true);
            }
            setError(null);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          previewBusyRef.current = false;
        }
      }

      if (previewActiveRef.current) {
        previewFrameRef.current = requestAnimationFrame(() => {
          void tick();
        });
      }
    };

    void tick();
  }, [stopPreviewLoop]);

  const startNative = useCallback(async () => {
    setMode("native");
    setReady(false);
    readyRef.current = false;
    setError(null);
    const ok = await tryStartNativeWebcam();
    if (!ok) {
      throw new Error("Native camera unavailable.");
    }
    runNativePreviewLoop();
  }, [runNativePreviewLoop]);

  const startBrowser = useCallback(async () => {
    setMode("browser");
    setReady(false);
    setError(null);
    const stream = await requestWebcamStream();
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) {
      stopMediaStream(stream);
      throw new Error("Camera preview is not ready.");
    }
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    await waitForVideoReady(video);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!open) {
      cleanup();
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        if (isTauriApp()) {
          await startNative();
          return;
        }

        const nativeOk = await tryStartNativeWebcam();
        if (nativeOk) {
          setMode("native");
          runNativePreviewLoop();
          return;
        }

        if (!cancelled) {
          await startBrowser();
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [open, cleanup, startNative, startBrowser, runNativePreviewLoop]);

  const handleCapture = async () => {
    if (!ready) return;
    setCapturing(true);
    try {
      if (mode === "native") {
        const blob = await captureNativeWebcamBlob();
        onCapture(blob);
        onClose();
        return;
      }

      const video = videoRef.current;
      if (!video) throw new Error("Camera is not ready yet.");
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) throw new Error("Camera is not ready yet.");
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not capture photo.");
      ctx.drawImage(video, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", 0.92);
      });
      if (!blob) throw new Error("Could not capture photo.");
      onCapture(blob);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCapturing(false);
    }
  };

  if (!open) return null;

  const showNativePreview = mode === "native";

  return (
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-ps-canvas p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="webcam-capture-title"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-ps-border bg-white shadow-2xl dark:bg-ps-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-ps-border px-4 py-3 dark:border-ps-border">
          <div className="flex items-center gap-2 text-sm font-semibold text-ps-ink">
            <Camera className="size-4 text-ps-accent" aria-hidden />
            <span id="webcam-capture-title">Take a photo</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ps-faint hover:bg-ps-elevated hover:text-ps-ink dark:hover:bg-ps-surface dark:hover:text-ps-ink"
            aria-label="Close camera"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-ps-canvas">
            {showNativePreview ? (
              <canvas
                ref={canvasRef}
                className="size-full object-cover"
                aria-label="Webcam preview"
              />
            ) : (
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="size-full object-cover"
                aria-label="Webcam preview"
              />
            )}
            {!ready && !error ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ps-canvas px-4 text-center">
                <Loader2 className="size-8 animate-spin text-ps-accent" aria-hidden />
                <p className="text-xs text-ps-muted">Opening system camera…</p>
              </div>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="text-xs text-amber-700 dark:text-amber-200">
              {error}
            </p>
          ) : null}
          <p className="text-[10px] text-ps-faint">
            {showNativePreview
              ? "Uses your system camera directly (not the browser). In Windows, enable Settings → Privacy → Camera → “Let desktop apps access your camera”. Persistent Sage may not appear in the per-app list — that toggle applies to all desktop apps."
              : "Browser camera preview (dev fallback)."}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-ps-border px-3 py-1.5 text-xs font-medium text-ps-muted hover:bg-ps-elevated dark:border-ps-border dark:text-ps-ink dark:hover:bg-ps-surface"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!ready || capturing}
              onClick={() => void handleCapture()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ps-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-ps-accent disabled:opacity-40"
            >
              {capturing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              Capture photo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
