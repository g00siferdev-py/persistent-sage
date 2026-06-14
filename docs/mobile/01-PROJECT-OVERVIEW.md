# 01 — Project Overview

**Persistent Sage** is a privacy-oriented, local-first desktop AI companion. Version **2.0.0** is the current desktop release (Microsoft Store MSIX and GitHub Releases). **2.0** adds **Coding mode** — repo-scoped IDE, terminal, and coding agent — alongside the **1.0** Companion feature set.

This document gives the production team a product-level understanding before diving into architecture and code.

---

## What Persistent Sage does

Persistent Sage is a **personal AI companion application** — not a thin chat wrapper. It combines:

1. **Multi-thread chat** with streaming responses from user-configured LLM providers
2. **Memory Anchor** — persistent SQLite storage of conversations, messages, and long-term memory anchors with hybrid search recall
3. **Companion personalities** — customizable system prompts, multiple profiles, import from OpenClaw markdown
4. **Agent tools** (opt-in) — web search, URL fetch, headless browser fetch, HTTP requests, workspace file I/O, database query, project tools
5. **Chat artifacts** — HTML reports, inline charts, markdown tables, interactive forms rendered in the chat window
6. **Collaborative projects** — living documents the agent can read/write under `workspace/projects/`
7. **Pulse** — scheduled background check-ins in the user's active chat thread
8. **Vision** — image attachments for multimodal models

**Privacy model:** All conversation data stays on the user's device. API keys are encrypted at rest. There is no Persistent Sage-operated cloud for chat storage. Messages are sent only to the LLM provider the user configures.

---

## Tech stack (desktop 1.0.0)

| Layer | Technology |
|-------|------------|
| Desktop shell | [Tauri 2](https://v2.tauri.app/) |
| UI | React 19, TypeScript, Vite 7, Tailwind CSS v4 |
| Backend | Rust 1.77+, rusqlite (SQLite), reqwest (HTTP), ring (AES-GCM encryption) |
| Data | SQLite (`nova_memory.sqlite`), JSON files (`settings.json`, `personality.json`) |
| Distribution | Windows NSIS + portable (GitHub); MSIX (Microsoft Store) |

---

## User-facing application structure

The desktop app uses a **three-pane layout**:

```
┌─────────────────┬──────────────────────────────┬─────────────────┐
│  Sidebar        │  Chat (center)               │  Settings       │
│  - Conversations│  - Message list              │  (right panel)  │
│  - Memory Anchor│  - Composer + attachments    │  4 tabs:        │
│  - Recall search│  - Artifacts (HTML/chart/form)│  Companion,     │
│                 │  - Project/recipe chips      │  Provider,      │
│                 │                              │  Tools, General │
└─────────────────┴──────────────────────────────┴─────────────────┘
```

**First-run flow:** Onboarding wizard (welcome → storage → provider → API key → done) → optional What's New modal.

**Settings tabs:**

| Tab | Contents |
|-----|----------|
| **Companion** | Personality profiles, system prompt preview, OpenClaw/JSON import |
| **Provider** | LLM provider selection, API keys, model pickers, temperature, thinking effort |
| **Tools** | Agent web tools, browser fetch, workspace, personality self-edit, artifacts, database query |
| **General** | Pulse, memory extraction, theme, updates, data directory, feedback, wipe controls |

---

## Core user journeys

### 1. Chat with memory

1. User selects or creates a conversation thread
2. User sends a message (optionally with image attachment)
3. Backend loads recent messages, startup briefing, hybrid anchor recall, active project context
4. LLM responds (streaming); optional tool loop (web search, workspace, etc.)
5. Assistant reply stored in SQLite; artifacts parsed and attached to message row
6. Memory extraction may run in background to create curated anchors

### 2. Memory Anchor management

- **Startup briefing** — markdown summary of thread context, anchors, projects, preferences
- **Extract raw anchors** — heuristic extraction from recent user messages
- **Global recall search** — hybrid FTS + keyword search across anchors and messages
- **Anchor types:** `raw`, `curated`, `fact`, `insight`

### 3. Companion personality

- Multiple profiles in `personality.json`; each scoped to its own conversation list
- Agent can self-edit personality when `agentPersonalityEditEnabled` is on
- Import paths: Persistent Sage JSON, OpenClaw markdown (five core `.md` files)

### 4. Agent tools (opt-in)

Tools are gated by settings flags. The LLM invokes them during chat turns. Examples:

- `web_search` — DuckDuckGo search
- `fetch_url` — simple HTTP page fetch
- `fetch_browser` — headless Chrome for JS-heavy sites (desktop only today)
- `workspace_read_file` / `workspace_write_file` — sandboxed file I/O
- `project_*` — collaborative project CRUD
- `memory_search` — hybrid memory recall

### 5. Pulse check-ins

- Timer-driven background loop posts to a bound conversation
- User's instructions are hidden; replies prefixed with `Pulse Response : [timestamp]`
- **Send Pulse now** triggers immediate check-in from Settings

### 6. Updates (desktop dual-channel)

| Install type | Update path |
|--------------|-------------|
| Microsoft Store (MSIX) | Store APIs — no GitHub updater |
| GitHub NSIS / portable | Tauri signed updater → `latest.json` |

Runtime detection via `GetCurrentPackageFullName()` on Windows.

---

## v1.0.0 release highlights

From [CHANGELOG.md](../../CHANGELOG.md) and [docs/releases/v1.0.0.md](../releases/v1.0.0.md):

**Added:**
- Chat artifacts (HTML, charts, tables, forms)
- Collaborative projects with agent tools
- Microsoft Store update channel (separate from GitHub updater)

**Changed:**
- Unified **Persistent Sage 1.0** branding (OpenSage experimental features merged)
- Browser fetch improvements (Chrome profile isolation, timeouts)

**Fixed:**
- Browser fetch Windows exit 13
- Form artifact select/radio object rendering
- Settings tooltip clipping
- Sidebar Memory Anchor layout at full window height

---

## Desktop vs mobile — strategic context

| Aspect | Desktop 1.0.0 | Mobile (planned) |
|--------|---------------|------------------|
| **Shell** | Tauri 2 (Windows primary) | Tauri 2 Android (recommended path) or alternative |
| **Layout** | Three-pane fixed layout | Single-pane with navigation (drawer/tabs) |
| **Data** | OS app data dir or portable | Android scoped storage / app-private dir |
| **Updates** | Store or GitHub | Google Play (TBD) |
| **Agent tools** | Full set incl. headless Chrome | Subset — browser fetch needs replacement |
| **Ollama local** | Supported | Unlikely on device; cloud providers primary |
| **File workspace** | Full filesystem sandbox | Android SAF / app-private storage |

The Rust backend (`nova_lib`) is already structured for mobile reuse via `tauri::mobile_entry_point`. The React frontend exists but is **desktop-layout-only** and will need a mobile UX pass.

---

## Repository layout (high level)

```
persistent-sage/
├── src/                    # React frontend
│   ├── components/         # UI: chat, sidebar, settings, onboarding
│   ├── hooks/              # useChat, useNovaMemory, useTheme
│   ├── lib/                # artifacts, theme, personality, tauri helpers
│   └── types/              # TypeScript types
├── src-tauri/              # Rust backend
│   ├── src/                # All business logic modules
│   ├── icons/android/      # Launcher icons (generated, present)
│   ├── capabilities/       # Tauri permission allowlists
│   └── tauri.conf.json     # Desktop Tauri config (v1.0.0)
├── docs/                   # Desktop documentation
├── docs/mobile/            # This mobile documentation set
├── packaging/              # Brand assets, NSIS art, portable scripts
├── public/                 # Splash, favicon, sidebar plate images
├── Package.appxmanifest    # Microsoft Store MSIX manifest
└── .github/workflows/      # CI: Windows NSIS, MSIX build
```

---

## What "success" looks like for mobile v1

Define explicitly in your project summary, but reasonable starting goals:

1. **Chat + memory** — core companion experience with provider configuration
2. **Personality** — at least one companion profile with settings UI
3. **Local-first privacy** — same data-on-device model; encrypted API keys
4. **Android-appropriate navigation** — not a shrunk desktop three-pane layout
5. **Clear feature scope** — documented parity matrix (see [05-FEATURE-MATRIX.md](./05-FEATURE-MATRIX.md))

Defer or exclude desktop-only features (headless Chrome, Microsoft Store updater, portable USB mode) unless there is an Android equivalent.

---

## Next documents

- [**02-ARCHITECTURE.md**](./02-ARCHITECTURE.md) — technical layers and data flow
- [**05-FEATURE-MATRIX.md**](./05-FEATURE-MATRIX.md) — what to ship on Android
- [**08-DECISIONS-AND-OPEN-QUESTIONS.md**](./08-DECISIONS-AND-OPEN-QUESTIONS.md) — decisions before coding
