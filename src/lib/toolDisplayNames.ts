/** User-facing labels for agent tool ids (API names stay snake_case in Rust). */

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  web_search: "Web Search",
  fetch_url: "Fetch URL",
  http_request: "HTTP Request",
  fetch_browser: "Browser Page Fetch",
  workspace_read_file: "Read Workspace File",
  workspace_write_file: "Write Workspace File",
  workspace_list_directory: "List Workspace Folder",
  database_query: "Database Query",
  personality_get: "View Personality",
  personality_update: "Update Personality",
  memory_search: "Memory Search",
};

/** Friendly title for settings UI and docs; falls back to a spaced version of the id. */
export function toolDisplayName(toolId: string): string {
  const key = toolId.trim();
  if (TOOL_DISPLAY_NAMES[key]) return TOOL_DISPLAY_NAMES[key];
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Bold-friendly mention for info popovers: "Web Search" without monospace code styling. */
export function toolLabelList(toolIds: string[]): string {
  return toolIds.map((id) => toolDisplayName(id)).join(", ");
}
