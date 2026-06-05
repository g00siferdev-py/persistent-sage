# Persistent Sage — Product Knowledge Base

**Purpose:** This document is the canonical knowledge base for external agents that market, promote, and support Persistent Sage. Use it to answer product questions accurately, write marketing copy, troubleshoot user issues, and explain privacy tradeoffs in plain language.

**Product version:** 0.2.0-beta.9 (open beta)  
**Last updated:** May 31, 2026  
**Repository:** https://github.com/g00siferdev-py/persistent-sage  
**Maintainer:** g00siferdev-py / g00sifer Development Lab  
**License:** MIT  

**Related docs (for humans):** [USER-GUIDE.md](./USER-GUIDE.md) · [PRIVACY.md](../PRIVACY.md) · [INSTALL-WINDOWS.md](./INSTALL-WINDOWS.md) · [SAGE-GUIDE.md](./SAGE-GUIDE.md) (in-app companion support guide)

---

## Agent instructions

When acting as a Persistent Sage marketing or support agent:

1. **Be accurate.** Persistent Sage is open beta software. Do not claim features that are not shipped or imply enterprise-grade security (database encryption, multi-user ACLs, audit logs are not implemented).
2. **Lead with privacy and local-first.** This is a core differentiator: chats and memory stay on the user's machine; there is no Persistent Sage cloud for conversation storage.
3. **Be honest about cloud providers.** When users choose OpenAI, Anthropic, Gemini, xAI, or Ollama Cloud, their messages leave the device to that provider. Local Ollama keeps inference on the user's machine.
4. **Never ask for or repeat API keys, passwords, or private chat content** in public channels.
5. **For troubleshooting, collect:** OS + version, Persistent Sage version, provider + model, installer vs portable, exact error text, whether it happens in a new chat, and whether Settings → General → Reveal data folder shows the expected path.
6. **Escalate to GitHub Issues** for bugs, feature requests, or unresolved issues: https://github.com/g00siferdev-py/persistent-sage/issues  
7. **Security vulnerabilities:** direct reporters to [SECURITY.md](../SECURITY.md), not public issues with exploit details.

**Tone for marketing:** Warm, clear, privacy-conscious, practical. Avoid hype. Emphasize companion + memory + control, not “AGI” or vague “superintelligence.”

**Tone for support:** Patient, step-by-step, non-judgmental. Recommend backups before destructive actions (factory reset, memory wipe).

---

## Elevator pitch (30 seconds)

**Persistent Sage** is a privacy-oriented desktop AI companion for Windows (and other platforms when built from source). It gives you multi-thread chat, long-term **Memory Anchors**, customizable companion personalities, optional agent tools, scheduled **Pulse** check-ins, and vision image attachments—all in a **local-first** app built with Tauri 2. Your conversations live in SQLite on your machine. You choose the AI provider. There is no Persistent Sage-operated cloud storing your chats.

---

## One-line taglines (marketing)

- *Your AI companion that remembers—on your machine, on your terms.*
- *Local-first chat, long-term memory, your choice of AI provider.*
- *A desktop AI companion with Memory Anchors—not another cloud chat tab.*
- *Private by design: chats stay local; you pick who processes them.*

---

## What Persistent Sage is

| Aspect | Detail |
|--------|--------|
| **Category** | Desktop AI companion application |
| **Platform** | Tauri 2 (Rust backend + React 19 webview UI) |
| **Distribution** | Open beta via GitHub Releases (Windows installer + portable zip); build from source on Linux/macOS |
| **Business model** | Open-source (MIT); users bring their own API keys for cloud providers |
| **Cloud service** | **None** for chat/memory storage—Persistent Sage does not operate a backend that stores user conversations |
| **Default companion** | **Sage** — shipped default personality; also acts as in-app support bot when workspace tools are enabled |

---

## What Persistent Sage is NOT

- Not a hosted SaaS chat product with Persistent Sage accounts
- Not a replacement for your LLM provider—you still need OpenAI/Anthropic/Gemini/xAI keys or local Ollama for real AI responses
- Not end-to-end encrypted chat storage (SQLite database is **not encrypted**)
- Not code-signed for Windows yet (SmartScreen may warn on beta installers)
- Not a mobile app (desktop only today)
- Not fully automated OpenClaw migration (workspace workflow is the gold standard for fidelity)

---

## Target users and use cases

### Who benefits

| Persona | Why Persistent Sage fits |
|---------|---------------------------|
| **Privacy-conscious users** | Local SQLite storage; no Persistent Sage cloud; optional local Ollama |
| **Power users / developers** | Agent tools, workspace sandbox, database query, portable USB mode |
| **Long-term companion seekers** | Memory Anchors, multi-profile personalities, Pulse check-ins |
| **OpenClaw migrants** | Import markdown personalities; workspace workflow for full fidelity |
| **Windows desktop users** | NSIS installer, portable zip, in-app updater |

### Common use cases

- Daily AI companion with continuity across sessions (memory + briefings)
- Personal knowledge assistant with semantic recall
- Custom personas (work mentor, creative partner, support bot)
- Scheduled proactive check-ins via Pulse (habits, journaling prompts, project nudges)
- Vision tasks (describe photos, read screenshots) with supported models
- Research with optional web search and browser fetch tools
- USB/portable workflows with `PERSISTENT_SAGE_PORTABLE=1`

---

## Key differentiators

1. **Local-first memory** — Conversations, Memory Anchors, and personalities persist in SQLite on disk, scoped per companion profile.
2. **Provider choice** — OpenAI, Anthropic, Google Gemini, xAI Grok, Ollama (local), Ollama Cloud, or offline placeholder.
3. **Memory Anchor system** — Hybrid keyword + FTS + optional semantic embeddings; startup briefings inject relevant context automatically.
4. **Companion personalities** — Multiple profiles in `personality.json`; live system-prompt preview; OpenClaw and JSON import.
5. **Opt-in agent tools** — Web search, URL fetch, headless browser, HTTPS requests, sandboxed workspace files, optional DB query—all off by default.
6. **Pulse** — Timer-driven check-ins in the user's selected sidebar thread; instructions stay hidden; replies prefixed `Pulse Response : [timestamp]`.
7. **No analytics SDK** — No telemetry to a Persistent Sage-operated server.
8. **Open source** — MIT license; inspectable codebase.

---

## Feature reference

### Chat

- **Multi-thread conversations** with streaming replies
- **Sidebar** lists threads per active companion profile
- **Actions:** New chat, rename (inline), delete (destructive—removes thread and messages)
- **Composer:** Enter to send, Shift+Enter for newline
- **Streaming events:** `chat:stream-start`, token deltas, `done`; “Thinking…” before first token
- **Thinking control:** Low / Medium / High — sent to providers that support reasoning/thinking (xAI, OpenAI reasoning models, Gemini thinking budget)
- **Errors:** Amber banner for IPC, provider, or validation errors

**On each send (backend pipeline):**

1. User message saved to SQLite (text + optional image)
2. Startup briefing built (transcript + anchors + projects + preferences)
3. Automatic cross-session memory recall for qualifying user turns
4. Companion system prompt merged with briefing
5. Recent turns sent to model (images encoded for vision APIs)
6. Assistant reply saved and streamed to UI

### Memory Anchor

**Memory Anchors** are compact long-term memory entries separate from raw chat history. Types include `fact`, `insight`, `curated`, and raw heuristic anchors.

| Capability | Description |
|------------|-------------|
| **Startup briefing** | Read-only sidebar panel showing context injected into the model |
| **Recent anchors** | Thread-scoped + global anchors (`conversation_id` null) |
| **LLM extraction** | After user messages, optional JSON extraction creates durable anchors (Settings → General → Memory) |
| **Heuristic raw anchors** | Keyword-based fallback when LLM extraction is off |
| **Semantic recall** | Background embedding of anchors; `memory_search` tool during chat; hybrid FTS + keyword for auto-inject |
| **Re-index embeddings** | Run after changing provider or embedding model |
| **Extract raw anchors** | Bulk-processes last ~40 user messages in active thread only—not required for normal chat storage |
| **Hybrid recall search** | Keyword + FTS + optional semantic search across all threads for active companion |
| **Wipe memories** | Settings → General → Wipe all memories (keeps settings/personalities) |

**Important:** Every chat message is saved to SQLite automatically. Anchors are *additional* compact memory snippets for recall—not a substitute for message history.

### Companion personalities

Stored in `{data_dir}/personality.json`. Each profile includes:

- Profile name, companion name
- Core personality, tone of voice, background story
- Core values, relationship style, special instructions
- Optional avatar description

**Capabilities:**

- Switch, create, delete profiles
- Live system prompt preview
- Import Persistent Sage JSON (full file, profiles array, or single profile)
- Import OpenClaw markdown (`SOUL.md`, `IDENTITY.md`, `USER.md`, `JOURNAL.md`, `MEMORY.md`, `TOOLS.md`)
- **Personality self-edit tools** (opt-in): `personality_get`, `personality_update` — companion can read/write active profile

**Default profile:** Sage — helpful, friendly, caring, intelligent; doubles as support bot referencing `workspace/guide.md`.

### Vision (image attachments)

- Attach JPEG, PNG, WebP, or GIF from composer (camera icon)
- Preview before send; remove with X
- Stored at `{data_dir}/attachments/{conversationId}/` (not encrypted)
- Multimodal payloads for OpenAI, Anthropic, Ollama
- Attach button disabled when active model lacks vision support
- **Ollama quirk:** Agent tools disabled for turns with images (Ollama ignores images when tools are set)

**Vision-capable model examples:** OpenAI `gpt-4o*`, Claude 3+, Ollama llava/kimi/vision models

### Pulse (scheduled check-ins)

- Runs as **normal chat turns** in the **sidebar-selected** conversation
- Settings → General → Pulse: enable, interval (minutes), custom instructions
- **Send Pulse now** — immediate check-in
- User instructions are **not posted in chat**; replies saved with prefix `Pulse Response : [timestamp] - …`
- Uses same tool toggles as manual chat when tools are enabled
- Emits `pulse:tick` event; UI reloads thread after each run

### Agent tools (all opt-in)

| User-facing name | Internal ID | Requires | Notes |
|------------------|-------------|----------|-------|
| Web Search | `web_search` | Web tools ON | DuckDuckGo; leaves device |
| Fetch URL | `fetch_url` | Web tools ON | Plain text page fetch; SSRF guards |
| HTTP Request | `http_request` | Web tools ON | HTTPS-only |
| Browser Page Fetch | `fetch_browser` | Web tools + Browser fetch ON | Headless Chrome/Chromium/Edge; JS-rendered pages |
| Read Workspace File | `workspace_read_file` | Workspace tools ON | Sandboxed to `{data_dir}/workspace/` |
| Write Workspace File | `workspace_write_file` | Workspace tools ON | Sandboxed |
| List Workspace Folder | `workspace_list_directory` | Workspace tools ON | Sandboxed |
| Database Query | `database_query` | Workspace and/or App data DB ON | Read-only by default; optional writes |
| View Personality | `personality_get` | Personality self-edit ON | Read active profile |
| Update Personality | `personality_update` | Personality self-edit ON | Write active profile |
| Memory Search | `memory_search` | Semantic recall enabled | Semantic + keyword anchor search |

**Tool-capable providers:** OpenAI, Anthropic, Ollama, Ollama Cloud, xAI (not Placeholder, not Gemini for tools in current build—verify Settings footnote)

**Browser fetch environment variables:**

- `PERSISTENT_SAGE_CHROME_PATH` — path to Chrome/Chromium/Edge
- `PERSISTENT_SAGE_CHROME_NO_SANDBOX=1` — Docker/containers
- `PERSISTENT_SAGE_CHROME_IGNORE_CERT_ERRORS=1` — development only

### Settings panel (four tabs)

#### Companion tab

- Manage personality profiles
- Import OpenClaw markdown or Persistent Sage JSON
- Live system prompt preview
- Save changes / Save as new profile

#### Provider tab

| Provider ID | Label | API key required | Default base URL |
|-------------|-------|------------------|------------------|
| `placeholder` | Placeholder (offline) | No | N/A |
| `openai` | OpenAI | Yes | `https://api.openai.com/v1` |
| `gemini` | Google Gemini | Yes | `https://generativelanguage.googleapis.com/v1beta` |
| `xai` | xAI Grok | Yes | `https://api.x.ai/v1` |
| `ollama` | Ollama (local) | No | `http://127.0.0.1:11434` |
| `ollama_cloud` | Ollama Cloud | Yes | Ollama cloud endpoint |
| `anthropic` | Anthropic | Yes | Anthropic API |

**Model examples:**

- OpenAI: `gpt-4o`, `gpt-4o-mini`, `o3-mini`
- Gemini: `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.0-flash`
- xAI: `grok-4-fast-reasoning`, `grok-4-fast-non-reasoning`, `grok-3`, `grok-3-mini`
- Ollama local: `llama3.2`, vision models like `llava`
- Ollama Cloud: `kimi-k2.5:cloud`, `gpt-oss:120b-cloud`
- Anthropic: Claude Sonnet/Haiku/Opus model IDs

Local Ollama and Ollama Cloud have **separate model selectors** in Settings.

#### Tools tab

Nested toggles with clear hierarchy:

- Web tools → Browser fetch → Ignore robots.txt
- Workspace tools → App data databases → Allow database writes
- Allow personality self-edit

All off by default.

#### General tab

| Section | Options |
|---------|---------|
| **Appearance** | Dark mode toggle (off = light theme) |
| **Generation** | Temperature, max output tokens |
| **Memory** | LLM extraction, semantic recall, embedding model override, re-index embeddings |
| **Pulse** | Enable, interval, instructions, Send Pulse now |
| **Updates** | Check GitHub Releases for signed Tauri updater packages |
| **Open beta feedback** | Prefilled GitHub Issues (bug, idea, beta tester) |
| **Data** | Reveal data folder, wipe memories, factory reset |
| **Setup** | Run setup wizard again |
| **About** | Backend version |

### First-run onboarding wizard

Steps: Welcome → Storage choice (desktop vs portable) → Provider → API key (if needed) → Done

Can rerun from Settings → General.

### In-app updates

- Tauri updater checks GitHub Releases for `latest.json` and signed packages
- Settings → General → Updates → Check for updates
- Updater-enabled releases must be **normal** GitHub releases (not marked prerelease)

### What's new dialog

One-time highlights shown after app version changes (e.g., after in-app update).

---

## Application layout

| Region | Component | Purpose |
|--------|-----------|---------|
| Left | Conversation sidebar | Thread list, Memory Anchor panel |
| Center | Chat | Messages, composer, companion picker, Settings toggle |
| Right | Settings panel | Companion · Provider · Tools · General |

Settings slides in from the right via header toggle.

---

## Data storage and privacy

### Summary table

| Data | Location | Encrypted? | Leaves device? |
|------|----------|------------|----------------|
| Chats, anchors, messages | `nova_memory.sqlite` | **No** | Only via chosen cloud LLM |
| Personalities | `personality.json` | **No** | No |
| Settings (non-secret) | `settings.json` | **No** | No |
| API keys | `settings.json` + `.nova_crypto/` | **Yes** (AES-256-GCM) | Decrypted locally; sent to your provider only |
| Image attachments | `attachments/{conversationId}/` | **No** | Yes when sent to vision API |
| Workspace files | `workspace/` | **No** | Only via enabled tools |

### Default data directories

| OS / mode | Path |
|-----------|------|
| Windows (installer) | `%LOCALAPPDATA%\Persistent Sage\Persistent Sage\data\` |
| Windows (portable) | `<install folder>\data\` |
| Linux | `~/.local/share/persistent-sage/data/` |
| macOS | `~/Library/Application Support/Persistent Sage/` |

**Reveal path:** Settings → General → Reveal data folder

### Environment variables

| Variable | Purpose |
|----------|---------|
| `PERSISTENT_SAGE_DATA_DIR` | Pin all app data to a directory |
| `PERSISTENT_SAGE_PORTABLE=1` | Use `{exe}/data/` (USB-friendly) |
| `PERSISTENT_SAGE_CHROME_PATH` | Browser binary for fetch_browser |
| `PERSISTENT_SAGE_CHROME_NO_SANDBOX=1` | Container/Docker Chrome |
| `PERSISTENT_SAGE_CHROME_IGNORE_CERT_ERRORS=1` | Dev only |

Legacy `NOVA_*` variables still work (rebrand from codename Nova).

### Data wipe controls

| Action | Effect |
|--------|--------|
| **Wipe all memories** | Clears SQLite user tables; re-seeds default thread; keeps settings and personalities |
| **Factory reset** | Wipes database **and** resets settings/personalities to defaults |

**Always quit the app** before manually copying or restoring `nova_memory.sqlite`.

### What Persistent Sage does NOT collect

- No Persistent Sage user accounts
- No ads or Windows advertising ID usage
- No analytics/telemetry to Persistent Sage servers
- No GPS, contacts, calendar, microphone (except images you attach)
- No payment/billing inside the app

Full policy: [PRIVACY.md](../PRIVACY.md)

---

## Installation and distribution

### Windows (recommended for most users)

1. Download from **GitHub Releases**: https://github.com/g00siferdev-py/persistent-sage/releases
2. Run `Persistent.Sage_*_x64-setup.exe`
3. SmartScreen may warn (unsigned beta) → **More info → Run anyway**
4. Complete setup wizard

**Start Menu shortcuts:**

- **Persistent Sage** — data in AppData
- **Start Persistent Sage (Portable)** — data next to executable (USB-friendly)

### Portable zip

1. Download `PersistentSagePortable.zip` from Releases
2. Unzip; run `Start-Persistent-Sage-Portable.bat` (**not** the raw `.exe` alone)

### Build from source

```bash
git clone https://github.com/g00siferdev-py/persistent-sage.git
cd persistent-sage
npm install
npm run tauri dev
```

Requires Node.js LTS, Rust 1.77+, and [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

**Important:** `npm run dev` (Vite only) does **not** run the full app—use `npm run tauri dev` or an installed release.

### Microsoft Store

MSIX packaging is in progress; see [MICROSOFT-STORE.md](./MICROSOFT-STORE.md). Primary distribution today is GitHub Releases.

---

## Migrating from OpenClaw

Persistent Sage supports OpenClaw-style companion migration two ways:

| Method | Fidelity | Steps |
|--------|----------|-------|
| **UI import** | Good starting point | Settings → Companion → Import OpenClaw markdown… → preview → add profile |
| **Workspace workflow** | Highest fidelity | Copy 5 `.md` files to `workspace/` → enable workspace + personality tools → prompt companion to fill `personality.json` → delete `.md` files |

**Recommended workspace files:** `IDENTITY.md`, `SOUL.md`, `JOURNAL.md`, `USER.md`, `MEMORY.md`

**Gold-standard prompt:**

> Please thoroughly read the following files located in your /workspace/ directory: IDENTITY.md, SOUL.md, JOURNAL.md, USER.md, MEMORY.md. Based on the contents of those files, edit your personality.json file using as much information as possible from those files. Remove any mention of running on the OpenClaw platform, or being dependent on markdown files to assemble your personality. Your personality from now on will be completely dependent on personality.json.

Streamlined one-click migration is **in progress**.

---

## Tech stack (for technical audiences)

| Layer | Technologies |
|-------|--------------|
| Desktop shell | Tauri 2 |
| UI | React 19, TypeScript, Vite 7, Tailwind CSS v4 |
| Backend | Rust 1.77+, rusqlite, reqwest |
| Storage | SQLite (`nova_memory.sqlite`), JSON settings |
| Security | AES-256-GCM + Argon2id for API keys; OS keyring where available |

---

## Known limitations (beta honesty)

| Topic | Status |
|-------|--------|
| Database encryption | Not implemented |
| Windows Authenticode signing | Not active; SmartScreen warnings expected |
| Dedicated projects UI | Projects exist in briefing data; no dedicated screen |
| Gemini agent tools | Limited compared to OpenAI/Anthropic/Ollama/xAI |
| OpenClaw one-click migration | In progress |
| Multi-user / enterprise | Not supported |
| Mobile apps | Not available |

---

## FAQ — Marketing

### Why choose Persistent Sage over ChatGPT/Claude web apps?

Persistent Sage keeps conversation history and Memory Anchors in **local SQLite** on your machine. You control the provider, enable tools intentionally, run multiple companion personalities, and can use portable/USB layouts. It is a **desktop companion platform**, not a browser tab tied to one vendor.

### Is Persistent Sage free?

The app is **open source (MIT)** and free to download. Cloud AI providers charge separately via your API keys. Local Ollama is free aside from your hardware/electricity.

### Does Persistent Sage train on my data?

Persistent Sage itself does **not** operate a cloud that stores or trains on your chats. If you use a third-party LLM provider, their policies apply to content sent to them.

### Can I run fully offline?

Use **Placeholder** for UI testing only (no real AI), or **local Ollama** for offline inference on your machine. Memory and chat storage remain local either way.

### Is it safe for sensitive data?

Open beta software. The SQLite database and attachments are **not encrypted**. Evaluate your threat model; use full-disk encryption (BitLocker, FileVault, LUKS) for additional protection. Do not store regulated/high-risk data unless you accept current limitations.

---

## FAQ — Support and troubleshooting

### Chat does nothing / no replies

1. Confirm you run `npm run tauri dev` or an installed release—not `npm run dev` alone
2. Settings → Provider: not Placeholder unless testing UI
3. Verify API key saved for cloud providers
4. Try a simpler model (e.g., `gpt-4o-mini`, `gemini-2.5-flash`)
5. Check amber error banner for exact message

### Placeholder mode

Offline stub for UI testing. Switch to a real provider in Settings → Provider.

### API key not working after reinstall

Keys are stored per data directory. Fresh install or new data path requires re-entering keys.

### OpenAI key overwrote Ollama key

Fixed in 0.2.0-beta.9. Update if on older beta.

### Model ignores attached image

- Use a vision-capable model
- On Ollama: tools are disabled for image turns by design
- Check attach button—not disabled with tooltip?

### fetch_browser fails

- Install Chrome, Chromium, or Edge
- Set `PERSISTENT_SAGE_CHROME_PATH`
- In Docker: `PERSISTENT_SAGE_CHROME_NO_SANDBOX=1`

### Memory not working / companion “forgets”

- Enable LLM memory extraction (Settings → General → Memory)
- Enable semantic recall if desired
- Re-index embeddings after provider/model change
- Confirm not using Placeholder provider
- Check active companion profile matches chat threads

### Tools not being used

- Enable relevant toggles in Settings → Tools
- Provider must support tools (OpenAI, Anthropic, Ollama, Ollama Cloud, xAI)
- Model must support tool calling
- Image attachment on Ollama disables tools for that turn

### Pulse not running

- Pulse enabled in Settings → General
- A conversation selected in sidebar (Pulse runs in open thread)
- Interval set (1–1440 minutes)
- Try **Send Pulse now**

### Windows SmartScreen warning

Beta installer is unsigned. Click **More info → Run anyway**. Code signing planned for future releases.

### Data not on USB drive

Use **Start Persistent Sage (Portable).bat** or portable zip launcher—not the raw executable without portable env.

### Where are my chats?

In `nova_memory.sqlite` under your data directory. Settings → General → Reveal data folder.

### How do I back up?

Quit app; copy entire data folder including `nova_memory.sqlite`, `settings.json`, `personality.json`, `attachments/`, `workspace/`.

### How do I report a bug?

Settings → General → Open beta feedback, or https://github.com/g00siferdev-py/persistent-sage/issues  
Include: OS, app version, provider, model, steps to reproduce. **Do not paste API keys or private chats in public issues.**

### Thinking control causes errors

Some models reject reasoning parameters. Switch to Medium or choose a model known to support thinking/reasoning.

### Semantic recall / embeddings with Ollama Cloud

Semantic recall and re-index use **local Ollama** at your configured base URL for embeddings—not `ollama.com/api/embed` (unsupported). Chat can still use Ollama Cloud separately.

---

## Support response template

```
Thanks for reaching out about Persistent Sage.

To help troubleshoot, could you share:
1. OS and version (e.g., Windows 10/11)
2. Persistent Sage version (Settings → General → About)
3. Provider and model (Settings → Provider)
4. Installer or portable?
5. Exact error message (screenshot or copy/paste)
6. Does it happen in a brand-new chat?

Common quick checks:
- Settings → Provider: real provider selected + API key saved
- For images: vision-capable model selected
- For tools: enabled in Settings → Tools + tool-capable provider
- Settings → General → Reveal data folder: expected location?

If this looks like a bug, please file at:
https://github.com/g00siferdev-py/persistent-sage/issues

(Please do not include API keys or private chat content in public issues.)
```

---

## Marketing copy blocks

### Short description (store/listing)

Persistent Sage is a local-first desktop AI companion with multi-thread chat, Memory Anchors for long-term recall, customizable personalities, optional agent tools, Pulse check-ins, and vision attachments. Built with Tauri 2 for Windows. Your data stays on your machine—you choose the AI provider.

### Feature bullets

- **Local-first memory** — Conversations and Memory Anchors in SQLite on your device
- **Your provider, your keys** — OpenAI, Anthropic, Gemini, xAI, Ollama local/cloud, or offline placeholder
- **Companion personalities** — Multiple profiles with import from OpenClaw or JSON
- **Memory Anchor** — LLM extraction, semantic recall, hybrid search, startup briefings
- **Agent tools (opt-in)** — Web search, browser fetch, workspace files, HTTPS requests
- **Pulse** — Scheduled proactive check-ins in your open chat thread
- **Vision** — Attach photos for multimodal models
- **Privacy-oriented** — No Persistent Sage cloud; API keys encrypted at rest
- **Portable mode** — USB-friendly data directory option
- **Open source** — MIT license on GitHub

### Social post example

Introducing Persistent Sage — a local-first desktop AI companion. 🌿

Your chats and Memory Anchors stay on *your* machine. Pick OpenAI, Claude, Gemini, Grok, or local Ollama. Optional tools, custom personalities, and Pulse check-ins.

Open beta for Windows: github.com/g00siferdev-py/persistent-sage

#LocalFirst #AI #OpenSource #Privacy

---

## Version history highlights

| Version | Date | Notable changes |
|---------|------|-----------------|
| **0.2.0-beta.9** | 2026-05-27 | Pulse improvements, What's new dialog, Ollama Cloud model split, OpenAI key fix |
| **0.2.0-beta.8** | 2026-05-25 | First-run API key UX fix |
| **0.2.0-beta.7** | 2026-05-25 | Gemini + xAI providers, thinking selector, updater, feedback flow, Sage guide |
| **0.2.0-beta.4** | 2026-05-19 | Rebrand Nova → Persistent Sage |
| **0.2.0-beta.3** | 2026-05-19 | Windows installer, portable packaging, onboarding |
| **0.2.0-beta.2** | 2026-05-19 | Semantic memory, light theme, tool labels |
| **0.2.0-beta.1** | 2026-05-19 | Open beta: OpenClaw import, Pulse, vision, fetch_browser |

Full changelog: [CHANGELOG.md](../CHANGELOG.md)

---

## Links and contact

| Resource | URL |
|----------|-----|
| GitHub repository | https://github.com/g00siferdev-py/persistent-sage |
| Releases (downloads) | https://github.com/g00siferdev-py/persistent-sage/releases |
| Issues (bugs, ideas, feedback) | https://github.com/g00siferdev-py/persistent-sage/issues |
| Privacy policy | https://github.com/g00siferdev-py/persistent-sage/blob/main/PRIVACY.md |
| Security reporting | [SECURITY.md](../SECURITY.md) |
| Maintainer | https://github.com/g00siferdev-py |

---

## Glossary

| Term | Definition |
|------|------------|
| **Memory Anchor** | Compact long-term memory snippet stored in SQLite, used for recall and briefings |
| **Startup briefing** | Context bundle injected into the model (transcript excerpts, anchors, projects, prefs) |
| **Companion profile** | A personality preset in `personality.json` with system-prompt fields |
| **Sage** | Default shipped companion; also in-app support bot referencing `guide.md` |
| **Pulse** | Scheduled background check-in that runs a chat turn with hidden instructions |
| **Agent tools** | Optional capabilities the model can invoke (web, files, DB, personality edit) |
| **Placeholder provider** | Offline demo backend with no network calls |
| **Portable mode** | Data stored in `{exe}/data/` for USB/removable media |
| **OpenClaw** | External agent platform whose markdown personality files can be imported |

---

## Document maintenance

Update this file when:

- User-visible features change
- New providers or tools ship
- Data paths or privacy posture changes
- Version number increments

Align with [USER-GUIDE.md](./USER-GUIDE.md), [SAGE-GUIDE.md](./SAGE-GUIDE.md), and [CHANGELOG.md](../CHANGELOG.md).

*Persistent Sage 0.2.0-beta.9 — open beta. MIT License.*
