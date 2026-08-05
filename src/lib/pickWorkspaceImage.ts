import { invoke } from "@tauri-apps/api/core";
import { isNovaDesktop } from "@/lib/pickOpenclawFiles";

export type WorkspaceImagePick = {
  base64: string;
  mime: string;
  fileName: string;
};

/**
 * Native image picker scoped to the Persistent Sage workspace folder.
 * Returns `null` when cancelled or when not running in the Tauri shell.
 */
export async function pickWorkspaceImage(): Promise<WorkspaceImagePick | null> {
  if (!isNovaDesktop()) return null;

  const paths = await invoke<{ workspaceDirectory: string }>("app_data_paths");
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: false,
    directory: false,
    defaultPath: paths.workspaceDirectory,
    title: "Attach image from workspace",
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "webp", "gif"],
      },
    ],
  });

  if (picked === null) return null;
  const absolutePath = Array.isArray(picked) ? picked[0] : picked;
  if (!absolutePath) return null;

  const { base64, mime } = await invoke<{ base64: string; mime: string }>(
    "workspace_read_image_for_attach",
    { absolutePath },
  );
  const fileName =
    absolutePath.replace(/\\/g, "/").split("/").pop()?.trim() || "workspace-image.png";
  return { base64, mime, fileName };
}
