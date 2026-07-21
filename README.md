
<img width="757" height="597" alt="Splash" src="https://github.com/user-attachments/assets/0218f6c2-8511-49d9-87a2-270e8649b413" />




# Persistent Sage

**Persistent Sage** is a privacy-oriented desktop AI companion: multi-thread chat, long-term **Memory Anchor** storage, optional **agent tools**, customizable companion personalities, **Pulse** scheduled check-ins, **vision** image attachments, and **Coding mode** — a repo-scoped development workspace with editor, terminal, and git tools—all in a local-first **Tauri 2** application.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**Repository:** [github.com/g00siferdev-py/persistent-sage](https://github.com/g00siferdev-py/persistent-sage)  
**Status:** **Persistent Sage 3.0.0 (beta)** — GitHub tag [`v3.0.0-beta.1`](https://github.com/g00siferdev-py/persistent-sage/releases/tag/v3.0.0-beta.1); Microsoft Store **3.0** planned **Aug 3**. Feedback welcome via [GitHub Issues](https://github.com/g00siferdev-py/persistent-sage/issues)

---

## Get Persistent Sage

**Version 3.0.0 (beta)** — Moltbook, Favorites, Share, PDF agent tools, personality updates. **Beta testers:** [v3.0.0-beta.1 prerelease](https://github.com/g00siferdev-py/persistent-sage/releases/tag/v3.0.0-beta.1). Microsoft Store **3.0** planned **Aug 3**.

| Step | Action |
|------|--------|
| 1 | **Beta testers** — download **[v3.0.0-beta.1](https://github.com/g00siferdev-py/persistent-sage/releases/tag/v3.0.0-beta.1)** (`Persistent.Sage_3.0.0_x64-setup.exe` or portable zip). |
| 2 | **Microsoft Store** — search for Persistent Sage (currently **2.0**; **3.0** Store launch Aug 3), or use **[GitHub Releases](https://github.com/g00siferdev-py/persistent-sage/releases/latest)** for the current public installer. See **[docs/INSTALL-WINDOWS.md](./docs/INSTALL-WINDOWS.md)**. |
| 3 | **Build from source** — `git clone https://github.com/g00siferdev-py/persistent-sage.git && cd persistent-sage` → **[docs/INSTALL.md](./docs/INSTALL.md)**. |
| 4 | **Configure** — **Settings → Provider** (API key + model), then start a chat |
| 5 | **Update** — **Store installs:** Microsoft Store → Library → Get updates. **GitHub installs:** **Settings → General → Updates** |
| 6 | **Report** — **Settings → General → Send feedback** or [GitHub Issues](https://github.com/g00siferdev-py/persistent-sage/issues) with OS, app version, provider, steps to reproduce |
| 7 | **Support development** — optional donations via **[docs/SUPPORT.md](./docs/SUPPORT.md)**; code contributions via **[CONTRIBUTING.md](./CONTRIBUTING.md)** |

**Maintainers:** publish installers → **[docs/PUBLISH.md](./docs/PUBLISH.md)**; MSIX → **[docs/MICROSOFT-STORE.md](./docs/MICROSOFT-STORE.md)**; CI → **[docs/BUILD-CI.md](./docs/BUILD-CI.md)**.

---

## Documentation

| Guide | Description |
|-------|-------------|
| **[docs/INSTALL.md](./docs/INSTALL.md)** | **Fresh install** — prerequisites, clone, build, first-run setup |
| **[docs/INSTALL-WINDOWS.md](./docs/INSTALL-WINDOWS.md)** | **Windows users** — download from Releases, installer, portable USB |
| **[docs/PUBLISH.md](./docs/PUBLISH.md)** | **Maintainers** — publish builds to GitHub Releases |
| **[docs/MICROSOFT-STORE.md](./docs/MICROSOFT-STORE.md)** | **Maintainers** — MSIX packaging for Microsoft Store |
| **[docs/BUILD-CI.md](./docs/BUILD-CI.md)** | CI Windows builds (Actions) |
| **[docs/CODING-MODE.md](./docs/CODING-MODE.md)** | **Coding mode (v2)** — repos, IDE, terminal, agent tools, GitHub PAT |
| **[docs/USER-GUIDE.md](./docs/USER-GUIDE.md)** | Day-to-day usage — Companion + Coding, memory, settings, Pulse |
| **[docs/PRODUCT-KNOWLEDGE-BASE.md](./docs/PRODUCT-KNOWLEDGE-BASE.md)** | Full product KB for marketing & support agents |
| **[docs/DATA-AND-PRIVACY.md](./docs/DATA-AND-PRIVACY.md)** | What is stored locally; **API keys encrypted**, **database not encrypted** |
| **[PRIVACY.md](./PRIVACY.md)** | Public privacy policy |
| **[docs/SUPPORT.md](./docs/SUPPORT.md)** | **Support development** — optional donations, issues, contributing |
| **[docs/SIGNING-AND-UPDATES.md](./docs/SIGNING-AND-UPDATES.md)** | Updater behavior and SignPath readiness |
| **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** | Technical overview for developers |
| **[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)** | Dev workflow and pre-push checklist |
| [CHANGELOG.md](./CHANGELOG.md) | Release notes |
| **[docs/releases/v3.0.0.md](./docs/releases/v3.0.0.md)** | 3.0.0 beta release highlights |
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

After you build and run Persistent Sage, **nothing is stored on a Persistent Sage-operated cloud**. Messages go only to the **LLM provider you configure** (and optional tool URLs if you enable agent tools). See **[PRIVACY.md](./PRIVACY.md)** and **[docs/DATA-AND-PRIVACY.md](./docs/DATA-AND-PRIVACY.md)** for the full picture.

---

## Key features

- **3.0 (beta)** — **Moltbook** panel and agent tools, **Favorites**, **Share** menu and enhanced copy, agent **PDF** read/create, improved personality update/import, webcam capture, Settings tabs (General / Provider / Tools), Markdown/JSON playground polish.
- **Coding mode (v2 / 2.1+)** — Git repos, editor, terminal, coding agent, **playground**, **notepad**, Agent Action Stream. See **[docs/CODING-MODE.md](./docs/CODING-MODE.md)**.
- **UX (2.1+)** — Message timestamps, Help menu, token counter, light/dark theme, cache manager, abort turn, unified Companion↔Coding context.
- **Memory Anchor** — SQLite conversations, messages, anchors, projects, and preferences; hybrid FTS + keyword (+ optional semantic) recall and startup briefings.
- **Companion profiles** — Multiple personalities with live system-prompt preview; Persistent Sage JSON and OpenClaw markdown import; optional agent self-edit of `personality.json`.
- **Providers** — OpenAI, Google Gemini, xAI Grok, Ollama (local), Ollama Cloud, Anthropic, or offline placeholder.
- **Agent tools** (opt-in) — Web search, URL fetch, headless **`fetch_browser`**, HTTPS `http_request`, sandboxed workspace files, **PDF read/create**, optional database query, **Moltbook** (when enabled).
- **Pulse** — Timer-driven check-ins that run as **normal chat turns** in your selected sidebar thread.
- **Vision** — Attach images or capture from webcam in the composer; multimodal payloads for supported models.
- **In-app updates** — Store updates via Microsoft Store; GitHub installs use Tauri updater on Releases.
- **Send feedback** — Settings buttons open prefilled GitHub Issues without attaching private chats or logs.
- **Optional donations** — PayPal / Cash App links in footer and onboarding (no feature unlock).
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
| Data | Local SQLite (`nova_memory.sqlite`); API keys encrypted at rest |

---

## Built with Cursor, Codex, and GPT-5.6

Persistent Sage was developed in **[Cursor](https://cursor.com)** with heavy AI pair-programming. Throughout the project, coding work was driven by selecting **Codex** and **GPT-5.6** as the models inside Cursor.

Those two models played a huge part in writing Persistent Sage: implementing the Rust backend and React UI, Memory Anchor / SQLite recall, provider integrations, agent tools (including PDF), Coding mode, packaging, and docs. Direction, product decisions, review, and release ownership stayed with the maintainer; Codex and GPT-5.6 were the primary coding partners in the editor.

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

Persistent Sage **3.0.0** (beta, tag [`v3.0.0-beta.1`](https://github.com/g00siferdev-py/persistent-sage/releases/tag/v3.0.0-beta.1)) ships **Moltbook**, Favorites, Share/copy enhancements, agent **PDF** tools, personality update improvements, webcam capture, and a refactored Settings UI — on top of Companion + Coding from 2.x. GitHub beta installers are available now; Microsoft Store **3.0** is planned for **Aug 3**. See [PERSISTENT-SAGE-STATUS.md](./PERSISTENT-SAGE-STATUS.md), [CHANGELOG.md](./CHANGELOG.md), and [docs/releases/v3.0.0.md](./docs/releases/v3.0.0.md).

<img width="261" height="389" alt="IMG_2515" src="https://github.com/user-attachments/assets/7f7731f4-5c19-44b4-b86f-bc7c101df250" />

**Maintainer:** [g00siferdev-py](https://github.com/g00siferdev-py)

---

## License

[MIT License](./LICENSE) — Copyright (c) 2026 [g00siferdev-py](https://github.com/g00siferdev-py)
