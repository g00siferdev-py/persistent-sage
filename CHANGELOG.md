# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Microsoft Store update channel** — Store (MSIX) builds detect packaged installation. **Check for updates** queries the Microsoft Store (not GitHub); **Download & install** uses Store package update APIs. GitHub NSIS/portable/source installs keep the Tauri updater unchanged.

### Fixed

- **`main` release line** — Reverted accidental OpenSage shell branding from PR #2 (`tauri.conf.json`, data directory, keyring service, browser profile paths). Store and GitHub release builds track **Persistent Sage** again. OpenSage experiments stay on the `opensage-experimental` branch.

---

## [0.2.0-beta.9] — 2026-05-27

### Added

- **Pulse improvements** — background check-ins run without posting your instructions in chat; replies are saved with a `Pulse Response : [timestamp]` prefix. **Send Pulse now** in Settings runs a check-in immediately.
- **What's new dialog** — one-time highlights after the app version changes (e.g. after an in-app update).

### Changed

- **Ollama Cloud models** — separate model selection from local Ollama in Settings.
- **Privacy policy** — expanded `PRIVACY.md` for Microsoft Store compliance.
- **Release workflow** — `main` is the single development branch; MSIX builds on `main` pushes and `store-msix` stays mirrored automatically.

### Fixed

- **OpenAI API key save** — keys for OpenAI no longer overwrite the Ollama slot in settings.
- **Pulse IPC** — `pulse_run_now` is allowed through the Tauri invoke allowlist.

---

## [0.2.0-beta.8] — 2026-05-25

### Fixed

- **First-run setup API key entry** — selecting a cloud provider now shows the API-key box directly in setup and no longer blocks switching providers when another provider is missing a saved key.

---

## [0.2.0-beta.7] — 2026-05-25

### Added

- **Google Gemini and xAI Grok providers** — provider settings, encrypted API keys, model refresh, and chat routing.
- **Thinking selector** — Low / Medium / High control in the chat window for providers with reasoning or thinking modes.
- **Sage support guide** — `docs/SAGE-GUIDE.md` is installed as `guide.md` in the companion workspace for support-bot use.
- **Privacy and signing documents** — root `PRIVACY.md`, `SECURITY.md`, and `docs/SIGNING-AND-UPDATES.md`.
- **Tauri updater support** — signed updater artifacts, release manifest generation, and Settings-based update checks.
- **Open beta feedback flow** — Settings buttons open public prefilled GitHub Issues, backed by structured bug, idea, and beta tester issue templates.

### Changed

- **Default companion profile** — ships with Sage as one default companion profile for the Persistent Sage platform, while keeping multi-companion support clear.
- **Memory Anchor injection** — deterministic raw anchor ingest now runs even when LLM extraction is enabled, and automatic cross-session recall runs for every non-empty user turn.
- **Release publishing** — updater-enabled beta releases are published as normal GitHub releases so `/releases/latest/download/latest.json` works.

### Fixed

- **First-run setup API key save** — onboarding now sends the correct API-key payload for the selected provider.
- **Updater release JSON fetch** — documented and configured the release workflow to avoid GitHub prerelease assets being excluded from the updater endpoint.

---

## [0.2.0-beta.4] — 2026-05-19

Rebrand from codename **Nova** to **Persistent Sage** (UI, docs, installer, icons, splash).

### Added

- **Persistent Sage branding** — splash (`persistent-sage-splash.png`), sidebar plate (`persistent-sage-plate.png`), app icons from Sage artwork.
- **docs/REBRAND.md** — migration notes, repo rename guidance, data path changes.

### Changed

- **Product name** — `Persistent Sage`; Tauri identifier `app.persistentsage.desktop`; new default data directory layout.
- **Portable launcher** — `Start-Persistent-Sage-Portable.bat` (legacy `NOVA_PORTABLE` still supported).
- **Default companion display name** — `Sage` (was `Nova`).
- **Documentation** — user-facing “Nova” → “Persistent Sage” across README and `docs/`.

---

## [0.2.0-beta.3] — 2026-05-19

Windows installer, portable packaging, first-run onboarding, and branding.

### Added

- **First-run onboarding** — Setup wizard (install type, provider, memory); **Settings → General → Run setup wizard again**.
- **Windows NSIS installer** — Branded installer with WebView2 bootstrapper, Start Menu shortcuts, optional **Persistent Sage (Portable)** shortcut; see **[docs/INSTALL-WINDOWS.md](./docs/INSTALL-WINDOWS.md)**.
- **Portable packaging** — `npm run package:portable` → `dist/NovaPortable/`; `NOVA_PORTABLE=1` via `Start-Nova-Portable.bat` (legacy beta.3 names).
- **Splash screen** — Branded splash (~3.5s) on app start; logo in sidebar.
- **Branding scripts** — `npm run branding:icons`, `npm run branding:nsis`; assets under `packaging/branding/`.

### Changed

- **Tauri icons** — Regenerated from Persistent Sage logo for installer and taskbar.

---

## [0.2.0-beta.2] — 2026-05-19

Post-beta polish: semantic memory, UI theme, settings clarity, and anchor extraction stability.

### Added

- **Semantic memory** — LLM JSON extraction after user messages; hybrid FTS/keyword + cosine recall; `memory_search` agent tool; background embedding (OpenAI, Ollama, Ollama Cloud); **Re-index memory embeddings** in Settings → General → Memory.
- **Light theme** — Settings → General → Appearance → **Dark mode** toggle; preference stored in `localStorage` (`persistent-sage-theme`).
- **Friendly tool labels** — Settings and agent prompts show names like “Web Search” while internal ids stay unchanged (`toolDisplayNames.ts`).

### Changed

- **Settings → Tools** — Dependent toggles nested with visual hierarchy (browser fetch under web tools, DB writes under app data query).
- **Chat prep** — Non-blocking memory pipeline, prep timeout, lexical-only auto-recall on hot path; stream start emitted earlier.
- **USER-GUIDE** — Memory section documents auto-ingest, semantic recall, and extract-raw scope.

### Fixed

- **Extract raw anchors** — SQLite mutex deadlock when bulk-extracting anchors (UI freeze/crash).
- **Anchor ingest / upsert** — Same re-entrant lock pattern in auto-ingest and memory upsert.
- **Ollama Cloud embeddings** — `embed_texts` routes `ollama_cloud` like local Ollama.

---

## [0.2.0-beta.1] — 2026-05-19

**Persistent Sage is ready for beta testing.** See [README.md](./README.md#beta-testing) for how to install from source, report issues, and contribute.

### Migrating from OpenClaw (recommended workflow)

Settings → Companion includes **Import OpenClaw markdown…**, which maps `SOUL.md`, `IDENTITY.md`, and related files into a new Persistent Sage profile preview. **Today, the most effective way to carry an OpenClaw agent’s full personality into Persistent Sage is still a three-step workspace workflow:**

1. **Copy** — Place `IDENTITY.md`, `SOUL.md`, `JOURNAL.md`, `USER.md`, and `MEMORY.md` into Persistent Sage’s agent workspace (`{data_dir}/workspace/`). Enable **Settings → Tools → Workspace tools** so the companion can read them.
2. **Prompt** — Ask your Persistent Sage companion (with **Allow personality self-edit** enabled under **Settings → Tools**):

   > Please thoroughly read the following files located in your /workspace/ directory: IDENTITY.md, SOUL.md, JOURNAL.md, USER.md, MEMORY.md. Based on the contents of those files, edit your personality.json file using as much information as possible from those files. Remove any mention of running on the OpenClaw platform, or being dependent on markdown files to assemble your personality. Your personality from now on will be completely dependent on personality.json.

3. **Remove** — After you review the updated profile in **Settings → Companion**, delete the `.md` files from `workspace/` so the companion does not keep referring to them.

We are **still working on** a more efficient, streamlined OpenClaw → Persistent Sage migration (better field mapping, one-click import, and less manual prompting). Until then, treat the UI import as a starting point and the workflow above as the gold standard for fidelity.

Full detail: [docs/USER-GUIDE.md § Migrating from OpenClaw](./docs/USER-GUIDE.md#11-migrating-from-openclaw).

### Added

#### OpenClaw and companion personality

- **Import OpenClaw markdown…** — Settings → Companion: pick `SOUL.md`, `IDENTITY.md`, `USER.md`, `JOURNAL.md`, `MEMORY.md`, `TOOLS.md` (any subset); preview mapped fields before adding a profile.
- **Import Persistent Sage JSON** — Full `personality.json`, `profiles` array, or single profile object.
- **Native file dialog** — Tauri dialog for multi-file OpenClaw import on supported platforms.
- **Agent tools `personality_get` / `personality_update`** — Opt-in (**Settings → Tools → Allow personality self-edit**); companion can read and persist the active profile to `personality.json`.
- **Live system prompt preview** — Companion tab reflects generated persona text.

#### Agent tools (web and browser)

- **`fetch_browser`** — Headless Chrome/Chromium/Edge fetch for JS-heavy sites; opt-in under **Settings → Tools** (requires web tools + system browser or `PERSISTENT_SAGE_CHROME_PATH`).
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
