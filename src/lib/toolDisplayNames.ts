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
  coding_grep: "Code Search",
  coding_apply_patch: "Apply Patch",
  coding_run_command: "Run Command",
  coding_git_status: "Git Status",
  coding_git_diff: "Git Diff",
  coding_git_commit: "Git Commit",
  coding_git_push: "Git Push",
  coding_git_pull: "Git Pull",
  coding_git_fetch: "Git Fetch",
  coding_git_clone: "Git Clone",
  coding_repo_create: "Create Repo",
  coding_github_save_pat: "Save GitHub PAT",
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
