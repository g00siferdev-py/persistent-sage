# Persistent Sage — project status

**Version:** 2.1.0  
**Repository:** [g00siferdev-py/persistent-sage](https://github.com/g00siferdev-py/persistent-sage)  
**Maintainer:** [g00siferdev-py](https://github.com/g00siferdev-py)

---

## Executive summary

Persistent Sage is a **local-first desktop AI companion** (Tauri 2 + React + Rust). **Version 2.0** added **Coding mode**; **2.1** adds UX polish (timestamps, playground, notepad, debug panels, Help, cache manager, light/dark theme, unified context).

Conversations and memory live in **SQLite on your machine**. **API keys and GitHub PATs are encrypted**; the **database file is not encrypted**. There is no Persistent Sage cloud for chat storage.

**Release:** Persistent Sage **2.1.0** — Companion + Coding with Snowball-derived UX improvements (no security audit tooling). Feedback via [GitHub Issues](https://github.com/g00siferdev-py/persistent-sage/issues).

**Documentation:** See **[docs/README.md](./docs/README.md)** — including **[CODING-MODE.md](./docs/CODING-MODE.md)**, **[releases/v2.1.0.md](./docs/releases/v2.1.0.md)**, and **[INSTALL.md](./docs/INSTALL.md)**.

---

## What works today

| Area | Status |
|------|--------|
| **Dual mode** | Companion ↔ Coding switcher; unified active conversation (2.1+) |
| Streaming chat | Per-thread history (Companion); per-repo coding threads |
| Memory Anchor | Anchors, briefings, hybrid recall, personality scoping |
| **Coding mode** | Repos, file tree, editor tabs, terminal, coding agent tools |
| **Coding UX (2.1)** | Playground, notepad, Agent Action Stream, Event Stream Debugger, Settings in coding |
| **Companion UX (2.1)** | Timestamps, Help menu, token counter, abort turn, MessageContent, copy buttons |
| **Git integration** | Local git + HTTPS remote via encrypted GitHub PAT |
| **New project templates** | empty, rust, node, python, tauri, csharp |
| Providers | OpenAI, Google Gemini, xAI Grok, Ollama local, Ollama Cloud, Anthropic, placeholder |
| Companion | Multi-profile `personality.json`, import, live prompt preview |
| Agent tools (Companion) | Web, `fetch_browser`, workspace, projects, optional `database_query` |
| Chat artifacts | HTML, charts, tables, forms (Companion + coding chat, 2.1+) |
| Updates | Microsoft Store (MSIX) **or** GitHub Tauri updater |
| Pulse | Scheduled ticks in **open sidebar thread** (Companion) |
| Vision | Image attach + multimodal provider payloads |
| Settings | Companion, Provider, Tools (incl. Coding v2), General, **cache manager** |
| Platform | Single-instance guard, ErrorBoundary, light/dark theme |
| Docs | Full `docs/` suite including 2.1 release notes |

---

## Coding mode (v2 / 2.1) snapshot

| Component | Implementation |
|-----------|----------------|
| Repos | `workspace/repos/`, `_index.json`, clone/create/list/tree IPC |
| IDE | `coding_ide.rs`, `CodeEditorPanel`, read/write/shell IPC |
| Agent | `coding_tools.rs`, `coding.rs` system prompt, up to 32 tool rounds |
| Playground | `playground.rs`, `CodingPlaygroundPanel` |
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

1. **Coding IDE** — Syntax highlighting, richer editor (Monaco or similar)
2. **OpenClaw migration UX** — One-click fidelity matching the workspace workflow
3. **Database encryption** — SQLCipher or OS-level guidance (not shipped)
4. **Tauri capability tightening** — audit allowlists as surface grows
5. **Projects UI** — data exists; no dedicated screen yet
6. **Mobile** — planning docs in `docs/mobile/`; not shipped

---

## Build verification

```bash
npm install
npm run build
cd src-tauri && cargo check
npm run tauri dev
```

Windows release: see **[docs/PUBLISH.md](./docs/PUBLISH.md)** and **[docs/MICROSOFT-STORE.md](./docs/MICROSOFT-STORE.md)**.
