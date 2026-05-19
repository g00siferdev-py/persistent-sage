import { invoke } from "@tauri-apps/api/core";

export type PickedTextFile = { fileName: string; text: string };

function tauriPlatform(): string | undefined {
  return (import.meta as ImportMeta & { env?: { TAURI_ENV_PLATFORM?: string } }).env
    ?.TAURI_ENV_PLATFORM;
}

/** True when running inside the Nova Tauri shell (not `npm run dev` in a browser). */
export function isNovaDesktop(): boolean {
  return typeof tauriPlatform() === "string" && tauriPlatform()!.length > 0;
}

/**
 * Native multi-file picker + disk read (Tauri only).
 * Returns `null` when the user cancels; use the hidden `<input type="file">` on web dev.
 */
export async function pickOpenclawMarkdownFiles(): Promise<PickedTextFile[] | null> {
  if (!isNovaDesktop()) return null;

  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: true,
    directory: false,
    title: "Import OpenClaw markdown",
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
  });

  if (picked === null) return null;
  const paths = Array.isArray(picked) ? picked : [picked];
  if (paths.length === 0) return null;

  return invoke<PickedTextFile[]>("read_text_files", { paths });
}
