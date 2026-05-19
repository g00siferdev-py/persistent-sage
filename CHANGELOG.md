# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

_Nothing yet._

---

## [0.2.0-beta.1] — 2026-05-19

**Nova is ready for beta testing.** See [README.md](./README.md#beta-testing) for how to install from source, report issues, and contribute.

### Migrating from OpenClaw (recommended workflow)

Settings → Companion includes **Import OpenClaw markdown…**, which maps `SOUL.md`, `IDENTITY.md`, and related files into a new Nova profile preview. **Today, the most effective way to carry an OpenClaw agent’s full personality into Nova is still a three-step workspace workflow:**

1. **Copy** — Place `IDENTITY.md`, `SOUL.md`, `JOURNAL.md`, `USER.md`, and `MEMORY.md` into Nova’s agent workspace (`{data_dir}/workspace/`). Enable **Settings → Tools → Workspace tools** so the companion can read them.
2. **Prompt** — Ask your Nova companion (with **Allow personality self-edit** enabled under **Settings → Tools**):

   > Please thoroughly read the following files located in your /workspace/ directory: IDENTITY.md, SOUL.md, JOURNAL.md, USER.md, MEMORY.md. Based on the contents of those files, edit your personality.json file using as much information as possible from those files. Remove any mention of running on the OpenClaw platform, or being dependent on markdown files to assemble your personality. Your personality from now on will be completely dependent on personality.json.

3. **Remove** — After you review the updated profile in **Settings → Companion**, delete the `.md` files from `workspace/` so the companion does not keep referring to them.

We are **still working on** a more efficient, streamlined OpenClaw → Nova migration (better field mapping, one-click import, and less manual prompting). Until then, treat the UI import as a starting point and the workflow above as the gold standard for fidelity.

Full detail: [docs/USER-GUIDE.md § Migrating from OpenClaw](./docs/USER-GUIDE.md#11-migrating-from-openclaw).

### Added

#### OpenClaw and companion personality

- **Import OpenClaw markdown…** — Settings → Companion: pick `SOUL.md`, `IDENTITY.md`, `USER.md`, `JOURNAL.md`, `MEMORY.md`, `TOOLS.md` (any subset); preview mapped fields before adding a profile.
- **Import Nova JSON** — Full `personality.json`, `profiles` array, or single profile object.
- **Native file dialog** — Tauri dialog for multi-file OpenClaw import on supported platforms.
- **Agent tools `personality_get` / `personality_update`** — Opt-in (**Settings → Tools → Allow personality self-edit**); companion can read and persist the active profile to `personality.json`.
- **Live system prompt preview** — Companion tab reflects generated persona text.

#### Agent tools (web and browser)

- **`fetch_browser`** — Headless Chrome/Chromium/Edge fetch for JS-heavy sites; opt-in under **Settings → Tools** (requires web tools + system browser or `NOVA_CHROME_PATH`).
- **Robots.txt** — Optional ignore for `fetch_browser` (personal automation; off by default).
- **`read_text_files`** IPC — UTF-8 reads for OpenClaw import paths from the native picker.

#### Chat vision (image attachments)

- **Composer** — Attach JPEG, PNG, WebP, or GIF from the chat input; preview before send.
- **Storage** — Images saved under `{data_dir}/attachments/{conversationId}/`; paths stored in SQLite (`image_attachment`, `image_mime`).
- **Providers** — Multimodal payloads for OpenAI (`image_url`), Anthropic (image blocks), Ollama (`images` array).
- **`chat_vision_supported`** IPC — UI disables attach when the active model is not vision-capable.
- **Asset protocol** — Tauri config enables local attachment display via `convertFileSrc`.

#### Pulse (scheduled companion check-ins)

- **In-thread execution** — Pulse runs `execute_chat_turn` on the **sidebar-selected** conversation (same SQLite transcript, briefing, streaming as manual chat).
- **Settings** — `pulseEnabled`, `pulseIntervalMinutes`, `pulseInstructions`, `pulseConversationId` in `settings.json`.
- **Events** — `pulse:tick` emitted to the UI after each run.

#### Documentation

- **`docs/`** suite — [INSTALL](./docs/INSTALL.md), [USER-GUIDE](./docs/USER-GUIDE.md), [DATA-AND-PRIVACY](./docs/DATA-AND-PRIVACY.md), [ARCHITECTURE](./docs/ARCHITECTURE.md), [DEVELOPMENT](./docs/DEVELOPMENT.md).
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — Beta testing and contribution expectations.
- **README** — Beta call, OpenClaw migration summary, privacy summary.

### Changed

- **Project status** — Early alpha → **open beta** (`0.2.0-beta.1`).
- **Settings panel** — Tabs reorganized: **Companion**, **Provider**, **Tools**, **General** (Pulse under General).
- **Ollama + images** — Agent tools disabled for requests that include images (Ollama ignores `images` when `tools` are set).
- **`model_supports_vision`** — Expanded heuristics (e.g. `kimi`, `qwen`, `-vl` models).
- **`loadActiveThread`** — Loads messages first; briefing/anchor failures no longer wipe the transcript.
- **Memory migrations** — Image columns migrate on every app open (fixes v6 databases missing columns).

### Fixed

- **`get_recent`** failing on existing databases at schema v6 without image columns.
- **Pulse** calling `execute_chat_turn` with updated signature.
- **`chat_vision_supported`** command visibility for Tauri handler registration.

---

## [0.1.0] — prior releases on main

### Added — Agent workspace and HTTPS tools

- Sandboxed `workspace/` tools (`workspace_read_file`, `workspace_write_file`, `workspace_list_directory`).
- **`http_request`** — HTTPS-only agent tool with custom headers and body.
- Settings: `agentWorkspaceEnabled`, `agentWebToolsEnabled`, database query toggles.

### Added — Web agent tools

- `web_search`, `fetch_url` with SSRF guards.

### Added — Core platform

- Tauri 2 + React 19 chat UI with streaming.
- Memory Anchor SQLite schema (v6 personality isolation).
- OpenAI, Ollama, Anthropic providers; encrypted API keys.
- Companion personality profiles.

---

## Pre-push checklist

1. `cd src-tauri && cargo check && cargo test`
2. `npm run build`
3. Smoke-test `npm run tauri dev` (chat, optional image, settings, optional OpenClaw import)
4. Do not commit secrets or `nova_memory.sqlite`
