# 03 — Backend Reference

Complete reference for the Rust backend (`nova_lib`) in Persistent Sage v1.0.0. The mobile Android app should reuse this library via Tauri IPC unless a command is explicitly marked desktop-only.

---

## Module index

| Module | File | Purpose |
|--------|------|---------|
| **lib** | `lib.rs` | `NovaState`, all Tauri commands, `run()` lifecycle |
| **main** | `main.rs` | Desktop-only binary entry |
| **chat** | `chat.rs` | Full chat pipeline: memory context, tool loops, streaming |
| **memory** | `memory.rs` | SQLite Memory Anchor: conversations, messages, anchors, FTS recall |
| **memory_extract** | `memory_extract.rs` | Background LLM anchor extraction + embedding |
| **memory_tools** | `memory_tools.rs` | `memory_search` agent tool |
| **settings** | `settings.rs` | `settings.json` + encrypted API keys |
| **personality** | `personality.rs` | `personality.json` profiles and system prompt builder |
| **personality_tools** | `personality_tools.rs` | `personality_get` / `personality_update` agent tools |
| **provider** | `provider/mod.rs` | Multi-backend LLM engine factory |
| **provider/engine** | `provider/engine.rs` | `LLMProviderEngine` async trait |
| **provider/openai** | `provider/openai.rs` | OpenAI + xAI adapter |
| **provider/ollama** | `provider/ollama.rs` | Ollama local + cloud |
| **provider/anthropic** | `provider/anthropic.rs` | Anthropic Messages API |
| **provider/gemini** | `provider/gemini.rs` | Google Gemini |
| **provider/placeholder** | `provider/placeholder.rs` | Offline stub |
| **agent_tools** | `agent_tools.rs` | Web search, fetch, HTTP, workspace I/O, tool dispatch |
| **browser_fetch** | `browser_fetch.rs` | Headless Chrome `fetch_browser` (**desktop only**) |
| **artifacts** | `artifacts.rs` | Parse/store chat artifacts in assistant replies |
| **projects** | `projects.rs` | Collaborative projects under `workspace/projects/` |
| **attachments** | `attachments.rs` | Image save + vision payload building |
| **database_query** | `database_query.rs` | Sandboxed SQLite query agent tool |
| **pulse** | `pulse.rs` | Scheduled background check-in loop |
| **recipes** | `recipes.rs` | Saved one-click workflows (`recipes.json`) |
| **embedding** | `embedding.rs` | Text embeddings for semantic recall |
| **distribution** | `distribution.rs` | Store vs GitHub update channel detection (**Windows**) |
| **store_updates** | `store_updates.rs` | Microsoft Store update APIs (**Windows only**) |

---

## Tauri IPC commands

All commands are registered in `lib.rs` `generate_handler!`. Permission allowlist: `permissions/nova-invoke-allowlist.toml`.

### App and distribution

| Command | Parameters | Returns | Mobile notes |
|---------|------------|---------|--------------|
| `app_version` | — | `String` | ✅ Reuse |
| `app_distribution_info` | — | `DistributionInfo` | ⚠️ Adapt — add Play Store channel |
| `open_store_updates` | — | `Result<(), String>` | ❌ Windows MSIX only |
| `check_store_updates` | `app` | `Result<StoreUpdateCheckResult, String>` | ❌ Windows only |
| `install_store_updates` | `app` | `Result<StoreUpdateInstallResult, String>` | ❌ Windows only |
| `app_data_paths` | — | `Result<AppDataPaths, String>` | ✅ Reuse (paths differ on Android) |
| `reveal_data_directory` | — | `Result<(), String>` | ⚠️ Replace with Android file viewer |
| `open_path` | `path`, `state` | `Result<(), String>` | ⚠️ Replace with Android intent/share |
| `open_feedback_issue` | `issue_url` | `Result<(), String>` | ✅ Reuse (opens browser) |
| `read_text_files` | `paths: Vec<String>` | `Result<Vec<TextFilePayload>, String>` | ⚠️ Adapt for SAF picker paths |

### Provider and settings

| Command | Parameters | Returns |
|---------|------------|---------|
| `provider_info` | `state` | `Result<String, String>` |
| `provider_list_available` | — | `Vec<ProviderDescriptor>` |
| `provider_switch` | `provider_id`, `state` | `Result<(), String>` |
| `openai_list_models` | `state` | `Result<Vec<String>, String>` |
| `ollama_list_local_models` | `state` | `Result<Vec<String>, String>` |
| `ollama_cloud_list_models` | `state` | `Result<Vec<String>, String>` |
| `anthropic_list_models` | `state` | `Result<Vec<String>, String>` |
| `gemini_list_models` | `state` | `Result<Vec<String>, String>` |
| `xai_list_models` | `state` | `Result<Vec<String>, String>` |
| `settings_get` | `state` | `Result<SettingsView, String>` |
| `settings_update` | `patch`, `state` | `Result<SettingsView, String>` |
| `settings_save_api_key` | `provider`, `api_key`, `state` | `Result<(), String>` |

### Personality

| Command | Parameters | Returns |
|---------|------------|---------|
| `personality_get` | `state` | `Result<PersonalitySnapshot, String>` |
| `personality_save` | `file`, `state` | `Result<PersonalitySnapshot, String>` |

### Database maintenance

| Command | Parameters | Returns |
|---------|------------|---------|
| `database_wipe_memories` | `state` | `Result<(), String>` |
| `database_wipe_all` | `state` | `Result<(), String>` |

### Memory / conversations

| Command | Parameters | Returns |
|---------|------------|---------|
| `memory_set_active_personality` | `personality_id`, `state` | `Result<(), String>` |
| `memory_list_conversations` | `state` | `Result<Vec<StoredConversation>, String>` |
| `memory_create_conversation` | `title`, `state` | `Result<String, String>` (UUID) |
| `memory_get_conversation` | `conversation_id`, `state` | `Result<StoredConversation, String>` |
| `memory_rename_conversation` | `conversation_id`, `title`, `state` | `Result<(), String>` |
| `delete_conversation` | `conversation_id`, `state` | `Result<(), String>` |
| `memory_store_message` | `conversation_id`, `role`, `content`, `state` | `Result<(), String>` |
| `memory_get_recent` | `conversation_id`, `limit`, `state` | `Result<Vec<StoredMessage>, String>` |
| `memory_startup_briefing` | `conversation_id`, `state` | `Result<String, String>` |
| `memory_update_startup_briefing` | `conversation_id`, `state` | `Result<String, String>` |
| `memory_create_anchor` | `conversation_id?`, `anchor_type`, `content`, `importance`, `state` | `Result<String, String>` |
| `memory_extract_anchors_from_conversation` | `conversation_id`, `max_anchors`, `state` | `Result<Vec<String>, String>` |
| `memory_recall_anchors` | `query`, `conversation_id?`, `limit`, `state` | `Result<Vec<StoredAnchor>, String>` |
| `memory_recall` | `query`, `conversation_id?`, `anchor_limit?`, `message_limit?`, `state` | `Result<MemoryRecallBundle, String>` |
| `memory_reindex_embeddings` | `state` | `Result<u32, String>` |
| `memory_list_anchors` | `conversation_id`, `limit`, `state` | `Result<Vec<StoredAnchor>, String>` |
| `memory_list_projects` | `limit`, `state` | `Result<Vec<StoredProject>, String>` |

### Chat

| Command | Parameters | Returns |
|---------|------------|---------|
| `chat_send_message` | `app`, `state`, `conversation_id`, `message`, `personality_id?`, `image_base64?`, `image_mime?`, `silent_user_message?` | `Result<ChatSendResult, String>` |
| `chat_vision_supported` | `state` | `Result<bool, String>` |

**`ChatSendResult`:** `{ reply, toolCalls, providerId, modelId }`

### Pulse

| Command | Parameters | Returns |
|---------|------------|---------|
| `pulse_run_now` | `app`, `state` | `Result<(), String>` |

### Browser, recipes, projects

| Command | Parameters | Returns | Mobile notes |
|---------|------------|---------|--------------|
| `browser_detect_chromium` | — | `Result<Option<String>, String>` | ❌ Desktop only |
| `recipe_list` | `state` | `Result<Vec<Recipe>, String>` | ✅ |
| `recipe_run` | `app`, `state`, `recipe_id`, `conversation_id` | `Result<RecipeRunResult, String>` | ✅ |
| `project_list` | `state` | `Result<ProjectListView, String>` | ✅ |
| `project_format_form_submission` | `artifact_title`, `project_id?`, `values` | `Result<FormSubmissionMessage, String>` | ✅ |

### Tauri events (not invoke)

| Event | Payload | Handler |
|-------|---------|---------|
| `chat:stream-start` | — | `useChat` — show streaming bubble |
| `chat:stream` | `{ delta: string }` | `useChat` — append text |
| `chat:stream-error` | `{ message: string }` | `useChat` — show error |
| `pulse:tick` | — | `useChat` — reload active thread |

---

## Database schema

**File:** `{data_dir}/nova_memory.sqlite`  
**Schema version:** `7` (`PRAGMA user_version`)

### Tables

#### `conversations`
| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | UUID |
| `title` | TEXT | |
| `created_at` | TEXT | |
| `updated_at` | TEXT | |
| `personality_id` | TEXT | Default `'default'`; scopes threads per companion |

#### `messages`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `conversation_id` | TEXT FK | CASCADE delete |
| `role` | TEXT | `user` or `assistant` |
| `content` | TEXT | |
| `created_at` | TEXT | |
| `personality_id` | TEXT | |
| `image_attachment` | TEXT | Relative path under data dir |
| `image_mime` | TEXT | |
| `artifact_json` | TEXT | Serialized `ChatArtifact` |

#### `anchors`
| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | UUID |
| `conversation_id` | TEXT FK | NULL = global anchor |
| `anchor_type` | TEXT | `raw`, `curated`, `fact`, `insight` |
| `content` | TEXT | |
| `importance` | INTEGER | 1–5 |
| `embedding` | BLOB | Optional semantic vector |
| `created_at` | TEXT | |
| `personality_id` | TEXT | `__shared__` for cross-companion project anchors |

#### `anchors_fts` (FTS5 virtual table)
Full-text search index on anchor content. Maintained by INSERT/UPDATE/DELETE triggers.

#### `projects`
| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | |
| `title` | TEXT | |
| `description` | TEXT | |
| `status` | TEXT | Default `'active'` |
| `created_at` | TEXT | |

#### `preferences`
| Column | Type | Notes |
|--------|------|-------|
| `key` | TEXT PK | e.g. `nova.provider.active` |
| `value` | TEXT | Non-secret prefs mirrored from settings |
| `updated_at` | TEXT | |

### Migrations

| Version | Change |
|---------|--------|
| 1 → 2 | Add `conversations`; migrate flat messages |
| 2 → 3 | Add `conversations.created_at` |
| 3 → 4 | Add `anchors`, `projects`, `preferences` |
| 4 → 5 | FTS5 `anchors_fts` + triggers |
| 5 → 6 | `personality_id` on conversations/messages/anchors |
| 6 → 7 | `image_attachment`, `image_mime`, `artifact_json` on messages |

### SQLite profiles

| Profile | Trigger | Journal | Sync |
|---------|---------|---------|------|
| Desktop | Default OS app data | WAL | NORMAL |
| Portable | `PERSISTENT_SAGE_DATA_DIR` or `PERSISTENT_SAGE_PORTABLE=1` | DELETE | FULL |

**Mobile:** Define a third profile (e.g. WAL with mobile-appropriate sync, or DELETE for battery).

---

## Settings structure

**File:** `{data_dir}/settings.json`  
**Crypto:** `{data_dir}/.nova_crypto/` (IKM + salt) → Argon2id → AES-256-GCM

### Key settings fields

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `selectedProvider` | String | `"placeholder"` | Active LLM provider |
| `openaiModel`, `anthropicModel`, etc. | String | Provider defaults | Model IDs |
| `thinkingEffort` | String | `"medium"` | Low/Medium/High reasoning |
| `temperature` | f32 | `0.7` | |
| `maxTokens` | Option\<u32\> | null | |
| `agentWebToolsEnabled` | bool | `false` | Web search, fetch, HTTP |
| `agentBrowserFetchEnabled` | bool | `false` | Headless Chrome fetch |
| `agentWorkspaceEnabled` | bool | `false` | Workspace file tools |
| `agentPersonalityEditEnabled` | bool | `false` | Personality self-edit |
| `artifactsEnabled` | bool | `true` | Chat artifacts generation |
| `databaseAllowWrite` | bool | `false` | Allow SQL writes in agent tool |
| `databaseAppDataEnabled` | bool | `false` | Query app-data SQLite |
| `pulseEnabled` | bool | `false` | Scheduled check-ins |
| `pulseIntervalMinutes` | u32 | `15` | |
| `pulseInstructions` | String | Default prompt | |
| `pulseConversationId` | Option\<String\> | null | Bound thread |
| `memoryLlmExtractionEnabled` | bool | `true` | Background anchor extraction |
| `memorySemanticEnabled` | bool | `true` | Embedding-based recall |
| `onboardingCompleted` | bool | `false` | |
| `whatsNewSeenVersion` | String | `""` | |
| `encryptedApiKeys` | Map | — | **Encrypted** API key blobs |

### Encrypted API key slots

| Slot | Providers |
|------|-----------|
| `openai` | OpenAI |
| `anthropic` | Anthropic |
| `ollama` | Ollama local + cloud |
| `gemini` | Google Gemini |
| `xai` | xAI / Grok |

`SettingsView` (returned to UI) omits secrets; includes `hasOpenaiApiKey`, `hasAnthropicApiKey`, etc.

---

## Agent tools

Tools run inside the chat loop — not as separate IPC commands.

### Tool gating

| Tools | Setting required |
|-------|------------------|
| `web_search`, `fetch_url`, `http_request` | `agentWebToolsEnabled` |
| `fetch_browser` | + `agentBrowserFetchEnabled` |
| `workspace_*` | `agentWorkspaceEnabled` |
| `project_*` | `artifactsEnabled` |
| `database_query` | `agentWorkspaceEnabled` OR `databaseAppDataEnabled` |
| `personality_get/update` | `agentPersonalityEditEnabled` |
| `memory_search` | Tools enabled + provider ≠ placeholder |

**Note:** Tools disabled for Ollama when message includes images.

### Complete tool list

| Tool | Module | Description |
|------|--------|-------------|
| `web_search` | agent_tools | DuckDuckGo search |
| `fetch_url` | agent_tools | HTTP GET, HTML → text |
| `http_request` | agent_tools | HTTPS custom request |
| `fetch_browser` | browser_fetch | Headless Chrome (**desktop**) |
| `workspace_read_file` | agent_tools | Read file in workspace sandbox |
| `workspace_write_file` | agent_tools | Write file in workspace sandbox |
| `workspace_list_directory` | agent_tools | List workspace directory |
| `database_query` | database_query | Sandboxed SQLite SELECT (+ optional writes) |
| `personality_get` | personality_tools | Read active profile |
| `personality_update` | personality_tools | Patch persona fields |
| `memory_search` | memory_tools | Hybrid memory recall |
| `project_list` | projects | List workspace projects |
| `project_create` | projects | Create project |
| `project_read` | projects | Read project document |
| `project_write` | projects | Write project document |
| `project_set_active` | projects | Set active project |

---

## Key Rust dependencies

| Crate | Role | Mobile note |
|-------|------|-------------|
| `tauri` 2 | App shell, IPC | Mobile entry point ready |
| `tokio` | Async runtime | ✅ |
| `rusqlite` | SQLite | ✅ bundled |
| `reqwest` | HTTP client | ✅ needs `INTERNET` permission |
| `ring` + `argon2` | Encryption | ✅ evaluate Keystore for IKM |
| `keyring` | OS credential store | ⚠️ Replace on Android |
| `scraper` | HTML parsing | ✅ |
| `which` | Chrome binary locate | ❌ Desktop only |
| `windows` | Store updates | ❌ Windows only |
| `opener` | Open URLs/paths | ⚠️ Adapt for Android intents |

---

## Related documents

- [02-ARCHITECTURE.md](./02-ARCHITECTURE.md) — system layers and data flow
- [04-FRONTEND-REFERENCE.md](./04-FRONTEND-REFERENCE.md) — which commands the UI calls
- [05-FEATURE-MATRIX.md](./05-FEATURE-MATRIX.md) — mobile tool availability decisions
- [06-DATA-AND-PRIVACY.md](./06-DATA-AND-PRIVACY.md) — storage and encryption on Android
