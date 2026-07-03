# Coding mode (Persistent Sage v2 / 2.1)

**Coding mode** is a repo-scoped development workspace inside Persistent Sage. You manage git repositories under `workspace/repos/`, browse files, edit in a built-in editor, run allowlisted shell commands in an integrated terminal, chat with an AI coding agent, and use **playground**, **notepad**, and **debug panels** introduced in **2.1**.

Switch modes with **Companion | Coding** in the app header. Your last mode and active conversation are remembered.

---

## Layout

| Region | Purpose |
|--------|---------|
| **Left** | Repository list, **New project**, **Clone repository** |
| **Center** | View toolbar (Split / Editor / Chat / **Playground**), file editor with tabs, coding chat, integrated terminal, **notepad** |
| **Right** | File tree (click a file to open; **Collapse all** / **Expand all**) |
| **Far right** (collapsible) | **Agent Action Stream**, **Event Stream Debugger** |

The center column supports four view modes:

| Mode | Shows |
|------|--------|
| **Split** | Editor above, chat below (default) |
| **Editor** | Editor only (more space for files) |
| **Chat** | Agent chat only |
| **Playground** | Ad-hoc code runner (Python, Node, TS, Bash, PowerShell, Rust) outside the repo |

The terminal can be collapsed, cleared, and resized by dragging the handle above it. Terminal height is persisted locally.

---

## Repositories

All coding projects live under **`{data_dir}/workspace/repos/`**. Persistent Sage does not open arbitrary paths outside this tree.

### Adding a repository

| Method | How |
|--------|-----|
| **New project** | Sidebar form: name + template → creates folder, runs `git init`, registers in index |
| **Clone** | HTTPS URL + optional folder name → `coding_git_clone` (requires GitHub PAT when remote is enabled) |
| **Manual** | Copy or clone a git repo into `workspace/repos/`, then click **Refresh** in the header |

The active repository is stored in `workspace/repos/_index.json`. Switch repos from the left sidebar.

### Starter templates

| Template | Creates |
|----------|---------|
| `empty` | README + `.gitignore`, `git init` |
| `rust` | `cargo init` |
| `node` | `package.json` with a minimal Node layout |
| `python` | `pyproject.toml` + `src/` layout |
| `tauri` | Tauri 2 app via `npm create tauri-app` (**requires npm** on the machine) |
| `csharp` | .NET console project via `dotnet new` (**requires .NET SDK**) |

Aliases: `py` → python, `dotnet` → csharp, `ts` → node. The agent can also call `coding_repo_create` with the same template names.

---

## Built-in IDE

The coding workspace includes a lightweight editor (not a full Monaco/VS Code fork):

| Feature | Details |
|---------|---------|
| **Tabs** | Open multiple files; dirty indicator (•) on unsaved tabs |
| **Save** | Toolbar button or **Ctrl+S** / **Cmd+S** |
| **Revert** | Restore last saved content on the active tab |
| **Open externally** | Opens the file in the OS default app via `open_path` |
| **Line numbers** | Shown beside the editor textarea |
| **Language hint** | Inferred from extension for display (`data-language`); no syntax highlighting yet |

**Size limits:** reads up to **512 KB** per file; writes up to **900 KB**. Larger files must be edited outside the app.

After the agent modifies files, clean (saved) open tabs refresh automatically when a chat turn completes. The file tree rescans at the same time.

---

## Integrated terminal

The terminal runs **allowlisted** commands in the active repo directory (same rules as the agent’s `coding_run_command` tool).

- Enable shell in **Settings → Tools → Coding mode (v2) → Allow Run Command**.
- Type a command and press **Run** (placeholder: “Type a command…”).
- Agent `coding_run_command` output streams into the terminal during chat turns.

On Windows, commands run through `cmd.exe /C` — pass the inner command only (e.g. `cargo check`, not `cmd /C cargo check`).

---

## Coding chat agent

Each **repository + companion scope** has its own coding conversation in SQLite (`app_mode = coding`, `coding_repo_id` set). Threads are created automatically when you select a repo.

### Provider requirements

Coding agent **tools** (grep, patch, shell, git) require a provider with native tool calling:

| Provider | Coding tools |
|----------|----------------|
| OpenAI | Yes |
| Anthropic | Yes |
| xAI Grok | Yes |
| Ollama / Ollama Cloud | Yes |
| Google Gemini | **No** (chat works; tools are not executed) |
| Placeholder | **No** |

Configure **Settings → Provider** before coding sessions. The same model is used for Companion and Coding modes.

### Companion link (default: on)

When **Link coding mode to active companion** is enabled (**Settings → Tools → Coding mode**):

- Coding uses your **active companion** persona and system prompt, plus coding-specific rules.
- Long-term memory recall runs for coding turns (project decisions, preferences).
- After coding chats, memory extraction saves **non-code** anchors only (no diffs, tool output, or source snippets).

When link is **off**, coding uses the fixed `__coding__` personality scope.

Legacy threads created under `__coding__` are migrated to the active companion when you return to that repo.

---

## Coding notepad (2.1+)

Per-repo scratch notes stored under the app data directory (not in the git repo). Open from the coding layout; the agent can read/write via `coding_notepad_*` tools when enabled.

Use it for task lists, API notes, or session context without committing to the repository.

---

## Code playground (2.1+)

The **Playground** view runs short snippets in a temp sandbox under `{data_dir}/playground/`:

| Language | Runtime |
|----------|---------|
| Python | `python` / `python3` |
| JavaScript / TypeScript | `node` (TS uses native strip-types when supported) |
| Bash / shell | Git Bash on Windows; POSIX `bash` elsewhere |
| PowerShell | `powershell` / `pwsh` |
| Rust | `rustc` then run binary |

Optional **Allow network** toggle (off by default applies proxy sandbox — not a full container). Output, exit code, and elapsed time appear in the panel.

---

## Agent Action Stream & Event Stream Debugger (2.1+)

Collapsible panels on the right show live **tool calls** and raw **IPC/event payloads** during coding agent turns. Useful for debugging provider tool loops without reading terminal logs.

Panel open state and width persist in local storage.

---

## Settings in coding mode (2.1+)

Open **Settings** from the coding header (same four-tab panel as Companion). Provider, tools, and cache changes apply immediately to coding sessions.

---

## Settings → Tools → Coding mode (v2)

All coding toggles default to **off** except **Companion link** (on). Enable what you need:

| Setting | Agent tools / behavior |
|---------|------------------------|
| **Link coding mode to active companion** | Shared persona + filtered memory (default **on**) |
| **Allow coding grep / patch** | `coding_grep`, `coding_apply_patch` |
| **Allow Run Command** | `coding_run_command` + **integrated terminal** |
| **Allow local git** | `coding_git_status`, `coding_git_diff`, `coding_git_commit` |
| **Allow remote git** | `coding_git_push`, `coding_git_pull`, `coding_git_fetch`, `coding_git_clone` |
| **GitHub PAT** | Encrypted like API keys; used for HTTPS git only |

`coding_repo_create` is always available to the agent during coding turns (no separate toggle).

Companion-mode tools (web search, browser fetch, projects, etc.) are **not** mixed into coding turns — only coding tools and workspace file tools (`workspace_read_file`, `workspace_write_file`, `workspace_list_directory`) with paths relative to the workspace root (e.g. `repos/my-app/src/main.rs`).

---

## Agent tool reference

| Tool | Purpose |
|------|---------|
| `coding_grep` | Regex search across repo files (max 80 matches, 512 KB per file) |
| `coding_apply_patch` | Search/replace patch in one file (max 900 KB) |
| `coding_run_command` | Allowlisted shell in repo (output capped ~96 KB; build commands up to 1200 s) |
| `coding_git_status` | Porcelain status |
| `coding_git_diff` | Diff for path or whole repo |
| `coding_git_commit` | Stage all + commit (**does not push**) |
| `coding_git_push` / `pull` / `fetch` | Remote ops via HTTPS + PAT |
| `coding_git_clone` | Clone into `workspace/repos/` |
| `coding_repo_create` | New repo from template |
| `coding_github_save_pat` | Save GitHub token when user pastes it in chat |
| `workspace_*` | Read/write/list under workspace (use `repos/...` paths) |

**Blocked:** force push (`--force`, `-f`), destructive shell patterns (e.g. `rm -rf`, `format c:`), SSH clone URLs.

---

## GitHub authentication

- Save a **Personal Access Token** in **Settings → Tools → GitHub (coding mode)** or ask the agent to store one via `coding_github_save_pat`.
- Tokens are **encrypted** with the same mechanism as LLM API keys (`settings.json` + `.nova_crypto/`).
- Git uses **`GIT_ASKPASS`** with a small helper script — the token is **never** written to `.git/config`.
- Use **HTTPS** URLs only (`https://github.com/owner/repo.git`).

Fine-grained or classic PATs need `repo` scope for private repositories.

---

## Direct command execution

If you paste an explicit run request (e.g. “run: `cargo check`” or “Use coding_run_command with cwd src-tauri…”), the backend may execute it **without** waiting for the model to call the tool — reducing hallucinated command output. This still requires **Allow Run Command** to be enabled.

---

## Data and privacy

| Item | Location | Encrypted? |
|------|----------|------------|
| Coding chat history | `nova_memory.sqlite` | **No** |
| Repository files | `workspace/repos/{name}/` | **No** |
| GitHub PAT | `settings.json` (ciphertext) | **Yes** |
| Repo index | `workspace/repos/_index.json` | **No** |

Your source code stays on disk locally. Messages still go to your configured LLM provider when you chat.

See [DATA-AND-PRIVACY.md](./DATA-AND-PRIVACY.md) for the full privacy model.

---

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| Agent does not edit files | Enable grep/patch in Settings; use OpenAI, Anthropic, xAI, or Ollama |
| Terminal says shell disabled | **Allow Run Command** in Settings |
| Clone/push fails | GitHub PAT saved; HTTPS URL; remote git enabled |
| `cargo check` fails on Tauri repo | Run with `cwd: src-tauri` — root may have no `Cargo.toml` |
| File too large to open | IDE read limit 512 KB — use external editor |
| Tauri template fails | Install Node.js/npm; run from a machine with network for `create tauri-app` |
| C# template fails | Install .NET SDK |

---

## Related documents

- [USER-GUIDE.md](./USER-GUIDE.md) — Companion mode and shared settings
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Rust modules and IPC
- [DATA-AND-PRIVACY.md](./DATA-AND-PRIVACY.md) — Storage and encryption
- [INSTALL.md](./INSTALL.md) — Build and first-run setup
