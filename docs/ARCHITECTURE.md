# Architecture overview

Nova is a **Tauri 2** desktop application: a **React 19** frontend talks to a **Rust** backend over IPC. All persistent state lives on disk under the application data directory.

---

## High-level diagram

```text
┌─────────────────────────────────────────────────────────────┐
│  Webview (React + TypeScript + Tailwind v4)                 │
│  ChatMain · ConversationSidebar · SettingsPanel             │
└───────────────────────────┬─────────────────────────────────┘
                            │ Tauri invoke + events
┌───────────────────────────▼─────────────────────────────────┐
│  Rust (src-tauri/src/)                                      │
│  lib.rs — NovaState, command registration                   │
│  chat.rs — send pipeline, streaming, agent tool loop        │
│  memory.rs — MemoryAnchor (SQLite)                          │
│  settings.rs · personality.rs                               │
│  provider/ — OpenAI, Ollama, Anthropic, Placeholder         │
│  attachments.rs — vision payloads                           │
│  pulse.rs — scheduled ticks in open thread                  │
│  agent_tools.rs · browser_fetch.rs · personality_tools.rs   │
│  database_query.rs                                          │
└───────────────────────────┬─────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
 nova_memory.sqlite   settings.json      personality.json
 attachments/         .nova_crypto/      workspace/
```

---

## `NovaState` (shared application state)

Held in Tauri managed state (`lib.rs`):

| Field | Role |
|-------|------|
| `memory` | `Arc<dyn ConversationMemory>` — SQLite via `MemoryAnchor` |
| `settings` | `Arc<SettingsManager>` — JSON + encrypted keys |
| `personality` | `Arc<PersonalityManager>` — companion profiles |
| `llm` | `RwLock<Arc<dyn LLMProviderEngine>>` — active provider engine |
| `http` | Shared `reqwest::Client` |
| `data_directory` | Canonical path for DB siblings, attachments, workspace |
| `workspace_root` | `{data_directory}/workspace` |

---

## Chat send pipeline

**Entry:** `chat_send_message` → optional image save → `execute_chat_turn`

1. Sync active `personality_id` to memory and personality store.
2. `build_engine` from settings (OpenAI / Ollama / Ollama Cloud / Anthropic / Placeholder).
3. Vision gate if image attached (`model_supports_vision`).
4. Store user message (text + optional `image_attachment` / `image_mime`).
5. Emit `chat:stream-start`.
6. Build **startup briefing** (transcript + anchors + projects + prefs).
7. Optional **auto memory recall** for qualifying user text.
7. Load recent messages; map each to `ChatTurn` via `attachments::chat_turn_from_stored`.
8. `run_chat_completion` — streaming or agent tool loop.
9. Persist assistant reply; stream events to UI.

**Pulse** (`pulse.rs`) calls the same `execute_chat_turn` on a timer for the conversation id stored in settings (`pulseConversationId`), bound to the sidebar-selected thread from the frontend.

---

## Memory Anchor (SQLite)

- **Trait:** `ConversationMemory` implemented by `MemoryAnchor`
- **Schema version:** 6 (`personality_id` isolation)
- **Migrations:** Run on every open; image columns added idempotently for v6 databases
- **Anchors:** `ON DELETE SET NULL` on conversation delete — anchor text survives thread removal

**Hybrid recall:** FTS5 shadow table on anchors + keyword `LIKE` on messages.

---

## Provider layer

| `provider_id` | Implementation |
|---------------|----------------|
| `openai` | Chat Completions + tools + multimodal `image_url` parts |
| `ollama` / `ollama_cloud` | `/api/chat` + `images` array for vision |
| `anthropic` | Messages API + image blocks |
| `placeholder` | Offline stub |

`ChatTurn` may carry provider-specific JSON overrides (`openai_message`, `ollama_message`, `anthropic_message`) for tool rounds and vision.

**Ollama + images:** When the transcript includes images, Nova **disables agent tools** for that request because Ollama often ignores `images` when `tools` are present.

---

## Agent tools

Merged when enabled in settings (`chat.rs`):

| Source | Tools |
|--------|-------|
| Web | `web_search`, `fetch_url`, `http_request` |
| Browser | `fetch_browser` (headless Chrome; `browser_fetch.rs`) |
| Personality | `personality_get`, `personality_update` (opt-in; `personality_tools.rs`) |
| Workspace | `workspace_read_file`, `workspace_write_file`, `workspace_list_directory` |
| Database | `database_query` (optional app-data DB, optional writes) |

Non-streaming multi-round loop (`agent_complete_with_tools`); synthetic stream events update the UI.

---

## Frontend structure

| Path | Role |
|------|------|
| `src/hooks/useChat.ts` | Conversations, messages, send, stream listeners, Pulse target sync |
| `src/components/chat/ChatMain.tsx` | Composer, image attach, message list |
| `src/components/sidebar/ConversationSidebar.tsx` | Threads, memory panel |
| `src/components/settings/SettingsPanel.tsx` | Companion / Provider / Tools / General tabs |
| `src/types/chat.ts` | IPC DTO types (camelCase from Rust serde) |

---

## IPC security

Commands are allowlisted in `src-tauri/permissions/nova-invoke-allowlist.toml`. Capabilities use Tauri 2 defaults plus **asset protocol** for local attachment display.

---

## Environment variables

| Variable | Effect |
|----------|--------|
| `NOVA_DATA_DIR` | Pin all app data to one directory |
| `NOVA_PORTABLE=1` | `{exe}/data/` layout + stricter SQLite pragmas |
| `NOVA_CHROME_PATH` | Chrome/Chromium/Edge for `fetch_browser` |
| `NOVA_CHROME_NO_SANDBOX` | Sandbox flags for containerized Chrome |

---

## Related documents

- [DEVELOPMENT.md](./DEVELOPMENT.md) — Build, test, contribute
- [DATA-AND-PRIVACY.md](./DATA-AND-PRIVACY.md) — Encryption boundaries
