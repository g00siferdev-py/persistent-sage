const CAMERA_TIMEOUT_MS = 20_000;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  onLateSuccess?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(message));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        if (settled) {
          onLateSuccess?.(value);
          return;
        }
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        if (settled) return;
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

/** Request a front-facing camera stream with sensible fallbacks for desktop WebViews. */
export async function requestWebcamStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera capture is not available in this environment.");
  }

  const attempts: MediaStreamConstraints[] = [
    { video: { facingMode: "user" }, audio: false },
    { video: true, audio: false },
  ];

  let lastError: Error | null = null;
  for (const constraints of attempts) {
    try {
      return await withTimeout(
        navigator.mediaDevices.getUserMedia(constraints),
        CAMERA_TIMEOUT_MS,
        "Camera access timed out. In Windows, enable Settings → Privacy → Camera → “Let desktop apps access your camera”. Persistent Sage may not appear in the per-app list — that master toggle covers desktop apps. Close other apps using the webcam and try again.",
        (stream) => stopMediaStream(stream),
      );
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  throw lastError ?? new Error("Could not access the camera.");
}

export function stopMediaStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

export function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Camera preview failed to start."));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("error", onError);
  });
}
