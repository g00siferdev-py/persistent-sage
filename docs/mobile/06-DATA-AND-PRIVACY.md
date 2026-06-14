# 06 — Data and Privacy

How Persistent Sage stores data on desktop v1.0.0, and what the Android team must address for Play Store compliance and user trust.

**Related desktop docs:** [DATA-AND-PRIVACY.md](../DATA-AND-PRIVACY.md), [PRIVACY.md](../../PRIVACY.md)

---

## Privacy principles (unchanged on mobile)

1. **Local-first** — conversations, memory anchors, and personalities stay on the user's device
2. **No Persistent Sage cloud** — the app operator does not store chat data on company servers
3. **User-configured LLM** — messages are sent only to the provider the user selects (OpenAI, Anthropic, etc.)
4. **Encrypted API keys** — provider credentials are encrypted at rest
5. **Unencrypted database** — `nova_memory.sqlite` is a plain SQLite file (same policy as desktop)

---

## Data inventory

| Asset | Location | Encrypted? | Contains |
|-------|----------|------------|----------|
| `nova_memory.sqlite` | App data dir | **No** | Conversations, messages, anchors, projects, preferences |
| `settings.json` | App data dir | Partial | Settings + encrypted API key blobs |
| `personality.json` | App data dir | **No** | Companion profiles and persona fields |
| `.nova_crypto/ikm` | App data dir | **No** (file permissions) | 32-byte key derivation input |
| `.nova_crypto/salt` | App data dir | **No** | 16-byte salt for Argon2id |
| `attachments/` | App data dir | **No** | Chat image files |
| `workspace/` | App data dir | **No** | Agent sandbox files |
| `workspace/projects/` | App data dir | **No** | Project documents |
| `recipes.json` | App data dir | **No** | Saved workflows |

---

## Encryption details

### API keys

| Step | Implementation |
|------|----------------|
| Key derivation | Argon2id from `.nova_crypto/ikm` + `salt` |
| Encryption | AES-256-GCM (via `ring` crate) |
| Storage | `settings.json` → `encryptedApiKeys` map |
| Slots | `openai`, `anthropic`, `ollama`, `gemini`, `xai` |

Each encrypted blob: `{ nonce, ciphertext }` (base64).

### Desktop keyring mirror

The `keyring` crate mirrors IKM to OS credential store for legacy migration. **Android team must decide:** use Android Keystore for IKM storage instead of plain `.nova_crypto/ikm` file.

**Recommendation:** Store IKM in Android Keystore; keep Argon2id + AES-GCM algorithm unchanged for cross-platform settings file compatibility (if user exports data).

---

## Desktop data directory resolution

```
Priority:
1. PERSISTENT_SAGE_DATA_DIR env var → {dir}/nova_memory.sqlite (portable profile)
2. PERSISTENT_SAGE_PORTABLE=1 → {exe_dir}/data/nova_memory.sqlite (portable profile)
3. Default → ProjectDirs("app", "Persistent Sage", "Persistent Sage")/nova_memory.sqlite (desktop WAL)
```

**Windows default:** `%LOCALAPPDATA%\Persistent Sage\Persistent Sage\`

Legacy env vars `NOVA_DATA_DIR` and `NOVA_PORTABLE` still honored.

---

## Android storage requirements

### Recommended approach

| Storage type | Use for |
|--------------|---------|
| **App-private internal storage** | `nova_memory.sqlite`, `settings.json`, `personality.json`, `.nova_crypto/`, `workspace/`, `attachments/` |
| **No external storage (v1)** | Avoid scoped storage complexity initially |
| **Android Keystore** | IKM / encryption key material |

Tauri Android provides app data directory APIs. The Rust `memory::default_data_dir()` function **must be extended** with an Android code path — it currently uses `directories::ProjectDirs` and `current_exe()` for portable mode, neither of which map cleanly to Android.

### Data directory resolution (proposed for mobile)

```
Priority:
1. Tauri app data directory (Android internal storage)
   → {app_data}/nova_memory.sqlite
   → SQLite profile: Mobile (WAL, NORMAL sync — TBD)
2. (Future) User-selected directory via SAF
   → Optional export/import path
```

### Android backup considerations

| Item | Recommendation |
|------|----------------|
| `android:allowBackup` | **false** or exclude sensitive files — API keys and chat DB should not auto-backup to Google |
| `android:fullBackupContent` | Exclude `.nova_crypto/`, `settings.json`, `nova_memory.sqlite` |
| Auto Backup / Cloud Backup | Document in Play Store data safety form |

---

## Network data flows

Data leaves the device only when the user sends a chat message or enables agent tools:

| Destination | Data sent | User control |
|-------------|-----------|--------------|
| LLM provider API | Chat messages, system prompt, tool results, images (vision) | Provider + API key in Settings |
| DuckDuckGo (web_search) | Search query | `agentWebToolsEnabled` toggle |
| Arbitrary URLs (fetch_url, http_request) | HTTP requests | `agentWebToolsEnabled` toggle |
| Embedding API (OpenAI/Ollama) | Anchor text for vectorization | `memorySemanticEnabled` toggle |

**No telemetry** to Persistent Sage servers is implemented in v1.0.0.

---

## Android permissions (anticipated)

| Permission | Reason | When needed |
|------------|--------|-------------|
| `INTERNET` | LLM API calls, web tools | Always (core app) |
| `CAMERA` | Image attach from camera | Optional feature |
| `READ_MEDIA_IMAGES` (API 33+) | Image attach from gallery | Optional feature |
| `POST_NOTIFICATIONS` (API 33+) | Pulse background check-ins | If Pulse uses notifications |
| `FOREGROUND_SERVICE` | Pulse background loop | If Pulse runs in background |
| `WAKE_LOCK` | Pulse timer | If needed for scheduling |

**Principle of least privilege:** Request permissions at point of use, not at install.

---

## Play Store compliance checklist

| Requirement | Desktop status | Mobile action needed |
|-------------|----------------|---------------------|
| Privacy policy URL | [PRIVACY.md](https://github.com/g00siferdev-py/persistent-sage/blob/main/PRIVACY.md) on GitHub | Update policy to mention Android; host stable URL |
| Data safety form | N/A (desktop) | Declare: user content stored locally, sent to third-party LLM APIs |
| Generative AI disclosure | Yes (Microsoft Store) | Declare AI features in Play Console |
| Age rating | Productivity app | Complete IARC questionnaire |
| Encryption export | AES-256-GCM for API keys | Likely exempt (mass market encryption) — verify with counsel |
| Account deletion | Factory reset in Settings | Ensure wipe clears all local data |
| Third-party data sharing | LLM providers | Disclose in privacy policy and data safety form |

---

## User data controls (existing — reuse on mobile)

| Control | IPC command | Effect |
|---------|-------------|--------|
| Wipe memories | `database_wipe_memories` | Clears SQLite user tables |
| Factory reset | `database_wipe_all` | Wipes DB + resets settings + default personality |
| Delete conversation | `delete_conversation` | Removes thread + messages (CASCADE) |

Ensure factory reset on Android also clears `attachments/`, `workspace/`, and `.nova_crypto/`.

---

## Cross-platform data portability (future)

Not implemented in v1.0.0. Mobile team may want to plan:

| Scenario | Complexity |
|----------|------------|
| Desktop → Mobile migration | Export/import SQLite + settings + personality as encrypted archive |
| Mobile → Desktop | Same archive format |
| Cloud sync | Not in scope — contradicts local-first positioning |

---

## Security considerations for mobile

| Risk | Mitigation |
|------|------------|
| API key extraction from device | Keystore-backed IKM; no root/jailbreak guarantees |
| Chat DB readable on rooted device | Same as desktop — document in privacy policy |
| Web tool SSRF | Existing SSRF guards in `agent_tools.rs` — verify on mobile network |
| Artifact XSS in WebView | Sandboxed iframes, CSP, script stripping — test on Android WebView |
| Clipboard leaks | Consider disabling copy on API key fields |
| App backgrounding | Clear sensitive UI state if needed |

---

## SQLite on Android

| Aspect | Desktop | Mobile recommendation |
|--------|---------|----------------------|
| Engine | rusqlite bundled | Same — no change |
| Schema | v7 | Same migrations — no fork |
| Journal mode | WAL (desktop) / DELETE (portable) | WAL with mobile-appropriate sync |
| File location | OS app data | Android internal storage |
| Concurrent access | Single app process | Same |

---

## Related documents

- [03-BACKEND-REFERENCE.md](./03-BACKEND-REFERENCE.md) — database schema
- [07-BRANDING-AND-IDENTIFIERS.md](./07-BRANDING-AND-IDENTIFIERS.md) — app identifiers
- [08-DECISIONS-AND-OPEN-QUESTIONS.md](./08-DECISIONS-AND-OPEN-QUESTIONS.md) — Keystore and backup decisions
- [PRIVACY.md](../../PRIVACY.md) — current public privacy policy
