import { invoke, isTauri } from "@tauri-apps/api/core";

const NATIVE_START_TIMEOUT_MS = 20_000;

type WebcamImageResponse = {
  imageBase64: string;
  mimeType: string;
};

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

/** True when running inside the Tauri desktop shell. */
export function isTauriApp(): boolean {
  return isTauri();
}

function isInvokeUnavailableError(error: unknown): boolean {
  const msg = String(error).toLowerCase();
  return (
    msg.includes("unknown command") ||
    msg.includes("not found") ||
    msg.includes("not allowed by scope") ||
    msg.includes("webview.invoke") ||
    msg.includes("ipc")
  );
}

export function base64ToBlob(base64: string, mime = "image/jpeg"): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

export async function drawJpegBase64OnCanvas(
  canvas: HTMLCanvasElement,
  base64: string,
): Promise<void> {
  const blob = base64ToBlob(base64);
  const bitmap = await createImageBitmap(blob);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Could not draw camera preview.");
  }
  if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
}

/**
 * Try the native Rust webcam path (works in the desktop app).
 * Returns false only when IPC is unavailable (e.g. Vite-only browser dev).
 */
export async function tryStartNativeWebcam(): Promise<boolean> {
  try {
    await withTimeout(
      invoke("webcam_start"),
      NATIVE_START_TIMEOUT_MS,
      "Opening the system camera timed out. Turn on Windows Settings → Privacy → Camera → “Let desktop apps access your camera”, close other apps using the webcam, then try again.",
    );
    return true;
  } catch (error) {
    if (isInvokeUnavailableError(error)) {
      return false;
    }
    throw error;
  }
}

export async function startNativeWebcam(): Promise<void> {
  const ok = await tryStartNativeWebcam();
  if (!ok) {
    throw new Error("Native camera is only available in the Persistent Sage desktop app.");
  }
}

export async function stopNativeWebcam(): Promise<void> {
  if (!isTauriApp()) return;
  try {
    await invoke("webcam_stop");
  } catch {
    /* ignore stop errors */
  }
}

export async function fetchNativeWebcamPreview(): Promise<string> {
  const res = await invoke<WebcamImageResponse>("webcam_preview");
  return res.imageBase64;
}

export async function captureNativeWebcamBlob(): Promise<Blob> {
  const res = await invoke<WebcamImageResponse>("webcam_capture");
  return base64ToBlob(res.imageBase64, res.mimeType || "image/jpeg");
}
