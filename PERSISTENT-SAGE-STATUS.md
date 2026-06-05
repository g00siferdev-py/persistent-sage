# Persistent Sage — project status

**Version:** 1.0.0
**Repository:** [g00siferdev-py/persistent-sage](https://github.com/g00siferdev-py/persistent-sage)  
**Maintainer:** [g00siferdev-py](https://github.com/g00siferdev-py)

---

## Executive summary

Persistent Sage is a **local-first desktop AI companion** (Tauri 2 + React + Rust). Conversations and memory live in **SQLite on your machine**. **API keys are encrypted**; the **database file is not encrypted**. There is no Persistent Sage cloud for chat storage.

**Release:** Persistent Sage **1.0** — artifacts, projects, agent tools, and dual update channels (Microsoft Store + GitHub). Feedback via [GitHub Issues](https://github.com/g00siferdev-py/persistent-sage/issues).

**Documentation:** See **[docs/README.md](./docs/README.md)** for the full guide index, including **[fresh install instructions](./docs/INSTALL.md)**.

---

## What works today

| Area | Status |
|------|--------|
| Streaming chat | Per-thread history, rename/delete, optimistic UI |
| Memory Anchor | Anchors, briefings, hybrid recall, extract, personality scoping |
| Providers | OpenAI, Google Gemini, xAI Grok, Ollama local, Ollama Cloud, Anthropic, placeholder |
| Companion | Multi-profile `personality.json`, Persistent Sage JSON + OpenClaw markdown import, live prompt preview |
| Personality agent tools | Opt-in `personality_get` / `personality_update` |
| Agent tools | Web, `fetch_browser`, workspace, projects (with artifacts), optional `database_query` (opt-in) |
| Chat artifacts | HTML, charts, tables, forms (Settings → Tools) |
| Updates | Microsoft Store (MSIX) **or** GitHub Tauri updater — auto-detected per install |
| Pulse | Scheduled ticks in **open sidebar thread** |
| Vision | Image attach + multimodal provider payloads |
| Settings | Four tabs: Companion, Provider, Tools, General |
| Data controls | Memory wipe, factory reset, `PERSISTENT_SAGE_DATA_DIR` / portable |
| Feedback | Settings buttons open structured public GitHub Issues |
| Docs | `docs/` install, privacy, user guide, architecture, development, signing/update notes |

---

## OpenClaw migration (current best practice)

| Method | Fidelity | Notes |
|--------|----------|-------|
| **Workspace + companion prompt** | Highest | Copy five `.md` files → prompt to fill `personality.json` → remove `.md` files ([USER-GUIDE](./docs/USER-GUIDE.md#11-migrating-from-openclaw)) |
| **Import OpenClaw markdown…** (UI) | Good starting point | Maps stems to Persistent Sage fields; preview before save; may miss nuance vs manual workflow |

**In progress:** Streamlined one-shot migration without manual workspace steps.

---

## Privacy and storage (explicit)

| Asset | Encrypted at rest? | Location |
|-------|-------------------|----------|
| `nova_memory.sqlite` | **No** | App data directory |
| Chat image files | **No** | `{data_dir}/attachments/` |
| `personality.json` | **No** | App data directory |
| API keys | **Yes** (AES-256-GCM) | `settings.json` + `.nova_crypto/` |

Details: **[PRIVACY.md](./PRIVACY.md)** and **[docs/DATA-AND-PRIVACY.md](./docs/DATA-AND-PRIVACY.md)**

---

## Technical snapshot

- **`NovaState`** — memory, settings, personality, LLM engine, HTTP client, data paths
- **`chat_send_message`** → `execute_chat_turn` → briefing + recall + `run_chat_completion`
- **`attachments.rs`** — save images, build provider-specific `ChatTurn` JSON
- **`browser_fetch.rs`** — headless Chrome for `fetch_browser`
- **`personality_tools.rs`** — agent read/update of active profile
- **`pulse.rs`** — background loop; same chat path as manual send
- **Schema v6** + idempotent image column migration on every open

---

## Shipped in 0.2.0-beta.1

- Open beta documentation and version bump
- OpenClaw markdown import UI + Persistent Sage JSON import
- Personality self-edit agent tools
- `fetch_browser` + robots.txt toggle
- Pulse in active conversation, vision attachments, settings tab layout
- Full `docs/` suite and README refresh

---

## Backlog (high level)

1. **OpenClaw migration UX** — One-click fidelity matching the workspace workflow
2. **Database encryption** — SQLCipher or OS-level guidance (not shipped)
3. **Tauri capability tightening** — audit allowlists as surface grows
4. **Automated CI** — `cargo test`, `npm run build`, smoke tests
5. **Projects UI** — data exists; no dedicated screen yet
6. **Semantic embeddings** — column reserved; recall is FTS + keyword today
7. **In-app data directory picker** — portable/USB UX

---

## Build verification

```bash
cd src-tauri && cargo check && cargo test
npm run build
npm run tauri dev   # manual smoke test
```

---

*Last updated for **1.0.0** — artifacts, projects, browser fetch fixes, Persistent Sage branding, dual update channels.*
