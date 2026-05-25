
<img width="757" height="597" alt="Splash" src="https://github.com/user-attachments/assets/0218f6c2-8511-49d9-87a2-270e8649b413" />




# Persistent Sage

**Persistent Sage** is a privacy-oriented desktop AI companion: multi-thread chat, long-term **Memory Anchor** storage, optional **agent tools**, customizable companion personalities, **Pulse** scheduled check-ins, and **vision** image attachments—all in a local-first **Tauri 2** application.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**Repository:** [github.com/g00siferdev-py/persistent-sage](https://github.com/g00siferdev-py/persistent-sage)  
**Status:** **Open beta** (`0.2.0-beta.4`) — feedback welcome via [GitHub Issues](https://github.com/g00siferdev-py/persistent-sage/issues)

---

## Beta testing

Persistent Sage is in **open beta**. **Windows users** can install from **[GitHub Releases](https://github.com/g00siferdev-py/persistent-sage/releases)** (pre-built installer). Developers and other platforms: build from source below.

| Step | Action |
|------|--------|
| 1 | **Windows install** — **[Releases](https://github.com/g00siferdev-py/persistent-sage/releases)** → download `Persistent Sage_*_x64-setup.exe` → run installer. See **[docs/INSTALL-WINDOWS.md](./docs/INSTALL-WINDOWS.md)**. |
| 2 | **Build from source** — `git clone https://github.com/g00siferdev-py/persistent-sage.git && cd persistent-sage` → **[docs/INSTALL.md](./docs/INSTALL.md)**. |
| 3 | **Configure** — **Settings → Provider** (API key + model), then start a chat |
| 4 | **Report** — [GitHub Issues](https://github.com/g00siferdev-py/persistent-sage/issues) with OS, app version, provider, steps to reproduce |
| 5 | **Contribute** — **[CONTRIBUTING.md](./CONTRIBUTING.md)** |

**Maintainers:** how to publish installers → **[docs/PUBLISH.md](./docs/PUBLISH.md)**. CI builds → **[docs/BUILD-CI.md](./docs/BUILD-CI.md)**.

---

## Documentation

| Guide | Description |
|-------|-------------|
| **[docs/INSTALL.md](./docs/INSTALL.md)** | **Fresh install** — prerequisites, clone, build, first-run setup |
| **[docs/INSTALL-WINDOWS.md](./docs/INSTALL-WINDOWS.md)** | **Windows users** — download from Releases, installer, portable USB |
| **[docs/PUBLISH.md](./docs/PUBLISH.md)** | **Maintainers** — publish beta builds to GitHub Releases |
| **[docs/BUILD-CI.md](./docs/BUILD-CI.md)** | CI Windows builds (Actions) |
| **[docs/USER-GUIDE.md](./docs/USER-GUIDE.md)** | Day-to-day usage — chat, memory, settings, Pulse, OpenClaw migration |
| **[docs/DATA-AND-PRIVACY.md](./docs/DATA-AND-PRIVACY.md)** | What is stored locally; **API keys encrypted**, **database not encrypted** |
| **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** | Technical overview for developers |
| **[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)** | Dev workflow and pre-push checklist |
| [CHANGELOG.md](./CHANGELOG.md) | Release notes |
| [docs/REBRAND.md](./docs/REBRAND.md) | Codename, rebrand, and legacy data migration |
| [PERSISTENT-SAGE-STATUS.md](./PERSISTENT-SAGE-STATUS.md) | Engineering status |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | How to test and contribute |

---

## Migrating from OpenClaw

Settings → Companion includes **Import OpenClaw markdown…**, but the **most reliable** way to move a mature OpenClaw personality into Persistent Sage today is:

1. Copy `IDENTITY.md`, `SOUL.md`, `JOURNAL.md`, `USER.md`, and `MEMORY.md` into Persistent Sage’s **`workspace/`** folder (enable workspace tools).
2. Prompt the companion to read those files and update **`personality.json`** via personality self-edit (enable in **Settings → Tools**).
3. Remove the `.md` files from `workspace/` when done.

We are **still improving** one-click migration; see **[docs/USER-GUIDE.md § Migrating from OpenClaw](./docs/USER-GUIDE.md#11-migrating-from-openclaw)** and **[CHANGELOG.md](./CHANGELOG.md)** for the exact prompt and details.

---

## Privacy at a glance

| Data | Where | Encrypted? |
|------|-------|------------|
| Chats, anchors, memory | `nova_memory.sqlite` on your disk | **No** (local file) |
| API keys | `settings.json` + `.nova_crypto/` | **Yes** |
| Personalities | `personality.json` | No |

After you build and run Persistent Sage, **nothing is stored on a Persistent Sage-operated cloud**. Messages go only to the **LLM provider you configure** (and optional tool URLs if you enable agent tools). See **[docs/DATA-AND-PRIVACY.md](./docs/DATA-AND-PRIVACY.md)** for the full picture.

---

## Key features

- **Memory Anchor** — SQLite conversations, messages, anchors, projects, and preferences; hybrid FTS recall and startup briefings.
- **Companion profiles** — Multiple personalities with live system-prompt preview; Persistent Sage JSON and OpenClaw markdown import; optional agent self-edit of `personality.json`.
- **Providers** — OpenAI, Google Gemini, xAI Grok, Ollama (local), Ollama Cloud, Anthropic, or offline placeholder.
- **Agent tools** (opt-in) — Web search, URL fetch, headless **`fetch_browser`**, HTTPS `http_request`, sandboxed workspace files, optional database query.
- **Pulse** — Timer-driven check-ins that run as **normal chat turns** in your selected sidebar thread.
- **Vision** — Attach images in the composer; multimodal payloads for supported models.
- **In-app updates** — Tauri updater checks GitHub Releases for signed update packages.
- **Portable layouts** — `PERSISTENT_SAGE_DATA_DIR` and `PERSISTENT_SAGE_PORTABLE` (legacy `NOVA_*` also works) for custom or USB data locations.



<img width="261" height="389" alt="IMG_0029" src="https://github.com/user-attachments/assets/57583b42-ebe6-4475-b95c-e5e5a7828e76" />

---

## Quick start (experienced developers)

```bash
git clone https://github.com/g00siferdev-py/persistent-sage.git
cd persistent-sage
npm install
npm run tauri dev
```

First launch creates local data under your OS app directory (or `PERSISTENT_SAGE_DATA_DIR` if set). Configure **Settings → Provider**, then start a chat.

**New to the stack?** Follow the step-by-step guide in **[docs/INSTALL.md](./docs/INSTALL.md)**.

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `PERSISTENT_SAGE_DATA_DIR` | Absolute path for `nova_memory.sqlite`, settings, personalities, workspace, attachments (legacy `NOVA_DATA_DIR` still works) |
| `PERSISTENT_SAGE_PORTABLE=1` | Store data in `{executable}/data/` (legacy `NOVA_PORTABLE=1` also works) |
| `PERSISTENT_SAGE_CHROME_PATH` | Chrome/Chromium/Edge binary for `fetch_browser` (legacy `NOVA_CHROME_PATH` also works) |
| `PERSISTENT_SAGE_CHROME_NO_SANDBOX` | Set to `1` in Docker or locked-down environments |
| *(unset)* | OS default application data location |

```bash
export PERSISTENT_SAGE_DATA_DIR="$HOME/PersistentSageData"
mkdir -p "$PERSISTENT_SAGE_DATA_DIR"
npm run tauri dev
```

---

## npm scripts

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run tauri dev` | **Run Persistent Sage** (desktop + Rust backend) |
| `npm run tauri build` | Release build and installers |
| `npm run build` | Frontend typecheck and Vite production build |
| `npm run dev` | Vite only — **not** sufficient for full Persistent Sage |

---

## Tech stack

| Layer | Technologies |
|-------|----------------|
| Desktop | [Tauri 2](https://v2.tauri.app/) |
| UI | React 19, TypeScript, Vite 7, Tailwind CSS v4 |
| Backend | Rust 1.77+, rusqlite, reqwest, encrypted settings |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Chat does nothing | Use `npm run tauri dev`, not `npm run dev` |
| Placeholder replies | Settings → Provider → live backend + API key |
| Model ignores images | Use a vision model; on Ollama, tools are off for image turns |
| `fetch_browser` fails | Install Chrome/Chromium or set `PERSISTENT_SAGE_CHROME_PATH` |
| Linux build errors | [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) |

More: **[docs/INSTALL.md § Troubleshooting](./docs/INSTALL.md#10-troubleshooting)**

---

## Project status

Persistent Sage **0.2.0-beta.4** is in **open beta**: core chat, memory, personalities, Pulse, vision, and agent tools are usable; migration UX and hardening continue. See [PERSISTENT-SAGE-STATUS.md](./PERSISTENT-SAGE-STATUS.md) and [CHANGELOG.md](./CHANGELOG.md).

<img width="261" height="389" alt="IMG_2515" src="https://github.com/user-attachments/assets/7f7731f4-5c19-44b4-b86f-bc7c101df250" />


**Maintainer:** [g00siferdev-py](https://github.com/g00siferdev-py)

---

## License

[MIT License](./LICENSE) — Copyright (c) 2026 [g00siferdev-py](https://github.com/g00siferdev-py)
