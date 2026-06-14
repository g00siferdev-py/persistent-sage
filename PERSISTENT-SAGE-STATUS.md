# Persistent Sage — project status

**Version:** 2.0.0  
**Repository:** [g00siferdev-py/persistent-sage](https://github.com/g00siferdev-py/persistent-sage)  
**Maintainer:** [g00siferdev-py](https://github.com/g00siferdev-py)

---

## Executive summary

Persistent Sage is a **local-first desktop AI companion** (Tauri 2 + React + Rust). **Version 2.0** adds **Coding mode**: a repo-scoped workspace with editor, terminal, git integration, and a dedicated coding agent—alongside the existing Companion experience.

Conversations and memory live in **SQLite on your machine**. **API keys and GitHub PATs are encrypted**; the **database file is not encrypted**. There is no Persistent Sage cloud for chat storage.

**Release:** Persistent Sage **2.0** — Companion mode (1.0 feature set) + Coding mode. Feedback via [GitHub Issues](https://github.com/g00siferdev-py/persistent-sage/issues).

**Documentation:** See **[docs/README.md](./docs/README.md)** — including **[CODING-MODE.md](./docs/CODING-MODE.md)** and **[INSTALL.md](./docs/INSTALL.md)**.

---

## What works today

| Area | Status |
|------|--------|
| **Dual mode** | Companion ↔ Coding switcher in header |
| Streaming chat | Per-thread history (Companion); per-repo coding threads |
| Memory Anchor | Anchors, briefings, hybrid recall, personality scoping |
| **Coding mode** | Repos, file tree, editor tabs, terminal, coding agent tools |
| **Git integration** | Local git + HTTPS remote via encrypted GitHub PAT |
| **New project templates** | empty, rust, node, python, tauri, csharp |
| Providers | OpenAI, Google Gemini, xAI Grok, Ollama local, Ollama Cloud, Anthropic, placeholder |
| Companion | Multi-profile `personality.json`, import, live prompt preview |
| Agent tools (Companion) | Web, `fetch_browser`, workspace, projects, optional `database_query` |
| Chat artifacts | HTML, charts, tables, forms (Settings → Tools) |
| Updates | Microsoft Store (MSIX) **or** GitHub Tauri updater |
| Pulse | Scheduled ticks in **open sidebar thread** (Companion) |
| Vision | Image attach + multimodal provider payloads |
| Settings | Companion, Provider, Tools (incl. Coding v2), General |
| Docs | Full `docs/` suite including coding mode guide |

---

## Coding mode (v2) snapshot

| Component | Implementation |
|-----------|----------------|
| Repos | `workspace/repos/`, `_index.json`, clone/create/list/tree IPC |
| IDE | `coding_ide.rs`, `CodeEditorPanel`, read/write/shell IPC |
| Agent | `coding_tools.rs`, `coding.rs` system prompt, up to 32 tool rounds |
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
