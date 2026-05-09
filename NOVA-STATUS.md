# Nova — project status

Nova is a **portable, privacy-first AI companion**: Tauri 2 + React + TypeScript on the desktop, with **local SQLite** as the default store and **no cloud** in core. This file summarizes what exists today and sensible next steps.

---

## What has been built

### Platform and tooling

- **Tauri 2** desktop app (`src-tauri/`) with `tauri.conf.json`, capabilities, generated icons, and bundle id `app.nova.desktop`.
- **React 19 + TypeScript + Vite 7** frontend with `@/*` path alias and **Tailwind CSS v4** (`@tailwindcss/vite`).
- **npm** scripts: `dev`, `build`, `tauri dev`, `tauri build`. Full chat + memory require **`npm run tauri dev`** (browser-only Vite preview has no Rust IPC).

### Frontend (UI)

- **Three-panel layout**: left **ConversationSidebar** (threads, Memory Anchor briefing, anchors, keyword recall, **rename** + **delete**), center **ChatMain** (streaming assistant + composer), right **collapsible Settings** rail.
- **Dark-first** styling (`class="dark"` on `<html>`).
- **Icons** via `lucide-react`; branding asset `public/nova-icon.svg`.
- **Chat** is fully wired: **`chat_send_message`** with **SSE-style Tauri events** (`chat:stream-start`, `chat:stream`, `chat:stream-error`), optimistic user bubble, **`useChat`** local message state, conversation list refresh.
- **Settings** panel: **General** tab (providers, API keys, models, temperature) and **Companion** tab (**Customize Nova** — personality form + live system-prompt preview).

### Rust backend

- **`lib.rs`**: **`NovaState`** holds shared **`reqwest::Client`**, **`tokio::sync::RwLock`** for the active **`LLMProviderEngine`**, **`Arc<dyn ConversationMemory>`**, **`Arc<SettingsManager>`**, **`Arc<PersonalityManager>`**; Tauri commands registered in one place.
- **`chat.rs`**: **`chat_send_message`** — stores user message, rebuilds engine from settings, streams model output to the webview, persists assistant reply; **merges** MemoryAnchor briefing with **personality system prompt** (persona first, then session/memory block).
- **`provider/`**: async **`LLMProviderEngine`** (`complete`, `stream`), **`OpenAIProvider`**, **`OllamaProvider`**, **`PlaceholderEngine`**, **`AnthropicPlaceholder`**; **`build_engine`** from settings + HTTP client.
- **`settings.rs`**: **`settings.json`** under the data dir; **AES-256-GCM** API keys; **Argon2id** + persisted salt; **keyring** + on-disk **`.nova_crypto/ikm`** (canonical IKM); commands **`settings_get`**, **`settings_update`**, **`settings_save_api_key`** (IPC args use **camelCase**, e.g. `apiKey`, `conversationId`).
- **`personality.rs`**: **`personality.json`**; multi-profile **`PersonalityProfile`**; **`personality_get`**, **`personality_save`**; **`build_system_prompt`** for rich companion instructions.
- **`memory.rs`**: **`MemoryAnchor`** + **`ConversationMemory`** trait; **rusqlite** (`bundled`) with **`conversations`**, **`messages`** (FK), **`anchors`**, **`projects`**, **`preferences`**; **raw + curated** anchor model, enriched **`get_startup_briefing`**, anchor CRUD/recall/extract, **`preference_get` / `preference_set` / `preference_delete`**, **`delete_conversation`**.
- **Portable / USB-oriented paths and SQLite tuning**:
  - `NOVA_DATA_DIR` → database at `{dir}/nova_memory.sqlite`; **`settings.json`**, **`personality.json`**, **`.nova_crypto/`** live alongside under the same directory.
  - `NOVA_PORTABLE=1` → `{exe_dir}/data/nova_memory.sqlite` (and same siblings).
  - Otherwise OS app data via `directories` (`app` / `Nova` / `Nova`).
  - **Desktop profile**: WAL + `synchronous=NORMAL`. **Portable profile** (when `NOVA_DATA_DIR` or `NOVA_PORTABLE` is set): `DELETE` journal + `synchronous=FULL`.
- **Tauri commands** (non-exhaustive): `app_version`, `provider_info`, `provider_list_available`, `provider_switch`, `settings_*`, `personality_get`, `personality_save`, `chat_send_message`, `delete_conversation`, memory + anchor + project + preference commands (see `lib.rs` `generate_handler!`).
- **`main.rs`**: thin desktop entry that calls `nova_lib::run()`.

### Documentation

- **`README.md`**: setup, scripts, layout overview (some paths may drift as the repo evolves; prefer this file for current backend/API truth).

---

## Next logical steps

Listed in roughly dependency order; **done** items are checked.

1. ~~**Wire the chat UI to memory**~~ — **Done.** Composer uses **`chat_send_message`** + streaming; history from **`memory_get_recent`**; per-conversation SQLite model.
2. ~~**Conversation model in SQLite**~~ — **Done.** `conversations` + FK on `messages`; sidebar list, rename, delete.
3. ~~**Long-term memory beyond chat rows**~~ — **Done.** Anchors, projects, preferences; briefing composition in **`get_startup_briefing`**.
4. ~~**Real LLM provider implementations**~~ — **Done.** OpenAI + Ollama (+ placeholders) behind **`LLMProviderEngine`** with streaming.
5. ~~**Settings that persist**~~ — **Done.** Encrypted keys, models, provider switch; General settings UI.
6. ~~**Companion personality**~~ — **Done.** **`personality.json`**, multi-profile, injected system layer in **`chat_send_message`**; Companion tab UI.
7. **Anthropic (and more backends)** — Implement **`AnthropicPlaceholder`** replacement with real Messages API; optional Azure / custom OpenAI-compatible hosts.
8. **Security hardening** — Tauri capabilities: tighten beyond **`core:default`** as the command surface grows; audit event allowlists.
9. **Portable UX** — In-app “data directory” picker for USB workflows; deeper README coverage for `NOVA_DATA_DIR` / `NOVA_PORTABLE`.
10. **Tests and CI** — `cargo test` for memory, settings, personality, providers; frontend smoke tests; CI pipeline.

---

*Last updated: reflects chat streaming, MemoryAnchor, providers, encrypted settings, personality system, and sidebar conversation management.*
