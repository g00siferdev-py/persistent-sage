# Persistent Sage — project status

**Version:** 3.0.0 (beta — `v3.0.0-beta.1` on GitHub; Store GA planned Aug 3)  
**Repository:** [g00siferdev-py/persistent-sage](https://github.com/g00siferdev-py/persistent-sage)  
**Maintainer:** [g00siferdev-py](https://github.com/g00siferdev-py)

---

## Executive summary

Persistent Sage is a **local-first desktop AI companion** (Tauri 2 + React + Rust). **Version 3.0** adds **Moltbook**, Favorites, Share/copy enhancements, agent **PDF** tools, personality update improvements, and a refactored Settings UI — on top of **Coding mode (2.0)** and **UX polish (2.1)**.

Conversations and memory live in **SQLite on your machine**. **API keys and GitHub PATs are encrypted**; the **database file is not encrypted**. There is no Persistent Sage cloud for chat storage.

**Release:** GitHub **beta** at [v3.0.0-beta.1](https://github.com/g00siferdev-py/persistent-sage/releases/tag/v3.0.0-beta.1). **Latest** on the repo homepage remains **2.0.0** until Store/GitHub GA. Feedback via [GitHub Issues](https://github.com/g00siferdev-py/persistent-sage/issues).

**Documentation:** See **[docs/README.md](./docs/README.md)** — including **[releases/v3.0.0.md](./docs/releases/v3.0.0.md)**, **[CODING-MODE.md](./docs/CODING-MODE.md)**, and **[INSTALL.md](./docs/INSTALL.md)**.

---

## What works today

| Area | Status |
|------|--------|
| **Dual mode** | Companion ↔ Coding switcher; unified active conversation (2.1+) |
| Streaming chat | Per-thread history (Companion); per-repo coding threads |
| Memory Anchor | Anchors, briefings, hybrid recall, personality scoping |
| **Moltbook (3.0)** | Panel, agent tools, scheduler, verification (opt-in) |
| **Favorites / Share (3.0)** | Favorites panel; Share menu and enhanced message copy |
| **PDF tools (3.0)** | `workspace_read_pdf`, `workspace_write_pdf` (MD/HTML/text → PDF) |
| **Personality (3.0)** | Improved edit/import/prompt sync in Settings → Companion |
| **Settings UX (3.0)** | General / Provider / Tools tabs (refactored panel) |
| **Coding mode** | Repos, file tree, editor tabs, terminal, coding agent tools |
| **Coding UX (2.1)** | Playground, notepad, Agent Action Stream, Event Stream Debugger |
| **Companion UX (2.1)** | Timestamps, Help menu, token counter, abort turn, MessageContent |
| **Git integration** | Local git + HTTPS remote via encrypted GitHub PAT |
| Providers | OpenAI, Google Gemini, xAI Grok, Ollama local, Ollama Cloud, Anthropic, placeholder |
| Agent tools (Companion) | Web, `fetch_browser`, workspace, PDF, Moltbook, projects, optional `database_query` |
| Chat artifacts | HTML, charts, tables, forms (Companion + coding chat) |
| Updates | Microsoft Store (MSIX) **or** GitHub Tauri updater |
| Pulse | Scheduled ticks in **open sidebar thread** (Companion) |
| Vision / webcam | Image attach + multimodal; webcam capture (3.0) |
| Platform | Single-instance guard, ErrorBoundary, light/dark theme |
| Docs | Full `docs/` suite including 3.0 release notes |

---

## Coding mode (v2 / 2.1) snapshot

| Component | Implementation |
|-----------|----------------|
| Repos | `workspace/repos/`, `_index.json`, clone/create/list/tree IPC |
| IDE | `coding_ide.rs`, `CodeEditorPanel`, read/write/shell IPC |
| Agent | `coding_tools.rs`, `coding.rs` system prompt, up to 32 tool rounds |
| Playground | `playground.rs`, `CodingPlaygroundPanel`, Markdown/JSON panels (3.0) |
| Notepad | `coding_notes.rs`, `CodingNotepad` |
| Stream UI | `agent_stream.rs`, `AgentActionStream`, `EventStreamDebugger` |
| Git auth | `git_auth.rs`, `GIT_ASKPASS`, encrypted PAT |
| Companion link | Shared persona + filtered memory extraction |
| UI | `CodingLayout`, `useCodingIde`, `useCodingChat` |

Tool-capable providers for coding: **OpenAI, Anthropic, xAI, Ollama**. Gemini and Placeholder: chat only.

---

## Privacy and storage (explicit)

| Asset | Encrypted at rest? | Location |
|-------|-------------------|----------|
| `nova_memory.sqlite` | **No** | App data directory |
| Repo source files | **No** | `workspace/repos/` |
| GitHub PAT | **Yes** (AES-256-GCM) | `settings.json` + `.nova_crypto/` |
| API keys | **Yes** | `settings.json` + `.nova_crypto/` |
| Cache / playground temp | **No** | `{data_dir}/cache/`, `{data_dir}/playground/` |

Details: **[PRIVACY.md](./PRIVACY.md)** and **[docs/DATA-AND-PRIVACY.md](./docs/DATA-AND-PRIVACY.md)**

---

## Backlog (high level)

1. **Microsoft Store 3.0** — MSIX packaging and Partner Center submission (target Aug 3)
2. **Coding IDE** — Syntax highlighting, richer editor (Monaco or similar)
3. **OpenClaw migration** — smoother one-click import beyond workspace workflow
4. **Mobile** — Android planning docs in `docs/mobile/` (desktop ships first)

---

## Links

| Resource | URL |
|----------|-----|
| Beta download | https://github.com/g00siferdev-py/persistent-sage/releases/tag/v3.0.0-beta.1 |
| Releases | https://github.com/g00siferdev-py/persistent-sage/releases |
| Issues | https://github.com/g00siferdev-py/persistent-sage/issues |
