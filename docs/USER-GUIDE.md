# Persistent Sage user guide

Complete guide to the Persistent Sage desktop application as shipped in **version 2.0.0**.

**Runtime requirement:** `npm run tauri dev` or an installed release build. Browser-only Vite preview cannot access chat, memory, or settings backends.

---

## 1. What Persistent Sage does

Persistent Sage is a **local-first AI companion**:

- Multi-thread **chat** with streaming replies
- **Memory Anchor** — SQLite-backed long-term memory (anchors, briefings, hybrid search)
- **Companion personalities** — per-profile tone and system instructions
- **Optional agent tools** — web search, URL fetch, HTTPS requests, workspace files, database query
- **Pulse** — scheduled check-ins in your **currently selected** conversation
- **Image attachments** — send photos to vision-capable models from the composer
- **Coding mode (v2)** — repo-scoped IDE, terminal, and coding agent (see [§ 12 Coding mode](#12-coding-mode-v2))

Your data stays on your machine. See [DATA-AND-PRIVACY.md](./DATA-AND-PRIVACY.md): the **database is not encrypted**, but it is **local** after install.

---

## 2. Application modes and layout

Persistent Sage has two top-level modes, switched from the header: **Companion** and **Coding**.

### Companion mode (default)

| Region | Component | Purpose |
|--------|-----------|---------|
| **Left** | Conversation sidebar | Thread list, Memory Anchor panel |
| **Center** | Chat | Messages, composer, companion picker, Settings toggle |
| **Right** | Settings panel | Companion · Provider · Tools · General |

Settings slides in from the right; toggle **Settings** / **Hide** in the chat header.

### Coding mode

| Region | Component | Purpose |
|--------|-----------|---------|
| **Left** | Repositories | Repo list, new project, clone |
| **Center** | IDE + chat + terminal | Editor tabs, coding agent chat, shell |
| **Right** | Files | Repo file tree |

See **[CODING-MODE.md](./CODING-MODE.md)** for full coding documentation.

---

## 3. Conversations (Companion mode)

### List and actions

- **New chat** — creates a thread for the active companion profile
- **Select** — loads history and memory context
- **Rename** — inline edit (pen icon)
- **Delete** — removes thread and messages (destructive)

### Companion header dropdown

Choose which **companion profile** receives new chats and memory scoping. Switching profiles filters the sidebar to that profile’s threads.

---

## 4. Chat

### Sending messages

- Type in the composer; **Enter** sends, **Shift+Enter** newline
- **Attach image** (camera icon) — pick JPEG, PNG, WebP, or GIF when your model supports vision
- Preview appears above the composer; **X** removes it before send
- User bubble shows immediately (optimistic UI); assistant reply streams in

### Streaming

Persistent Sage emits `chat:stream-start`, token deltas on `chat:stream`, and `done`. A “Thinking…” state shows before the first token.

### Errors

Amber banner at the top for IPC, provider, or validation errors (for example non-vision model with an image attached).

### What happens on send (backend)

1. User message saved to SQLite (text + optional image path)
2. Startup briefing built (transcript + anchors + projects + preferences)
3. Optional automatic memory recall appended for qualifying questions
4. Companion system prompt merged with briefing
5. Recent turns sent to the model (images encoded for vision APIs)
6. Assistant reply saved and streamed to the UI

---

## 5. Memory Anchor

### Startup briefing

Read-only panel in the sidebar: context Persistent Sage injects into the model (recent transcript excerpts, anchors, projects, preferences).

### Recent anchors

Anchors for the current thread plus global anchors (`conversation_id` null).

### What is stored automatically

Every chat message (user and assistant) is saved to SQLite in `nova_memory.sqlite` for that companion profile. That is separate from **anchors**, which are compact memory snippets used for recall.

After each **user** message, Persistent Sage can store memory in two ways (Settings → General → **Memory**):

1. **LLM memory extraction** (on by default) — A small JSON completion extracts durable facts (preferences, health, accessibility) as `fact` / `insight` / `curated` anchors (global or thread scope).
2. **Heuristic raw anchors** — When LLM extraction is off, keyword heuristics create raw anchors (thread + global copies when new).

### Semantic recall

When **Semantic recall (embeddings)** is enabled, anchors are embedded in the background (not on every keystroke). During chat, the model can call **`memory_search`** for semantic + keyword recall; auto-injected briefing uses fast keyword/FTS only so the UI stays responsive. Use **Re-index memory embeddings** after changing provider or embedding model.

### Extract raw anchors

**Not required for chat storage.** This button bulk-processes the last ~40 **user** messages in the **active thread only** and adds any missing raw anchors (useful after long chats or if auto-ingest missed something). It does not replace normal message history or LLM extraction.

### Hybrid recall search

Keyword + FTS + optional semantic search across anchors and **all threads** for this companion. Associative terms help (e.g. a query about “vision” also searches for “colorblind”).

---

## 6. Settings

Open **Settings** from the chat header. Four tabs:

### 6.1 Companion

- Switch, create, or delete personality **profiles**
- Edit companion name, tone, values, special instructions
- **Live system prompt preview**
- **Import Persistent Sage JSON** or **Import OpenClaw markdown…** (preview mapped fields, then add a profile)
- **Save changes** / **Save as new profile**

File on disk: `personality.json`

For migrating a long-running OpenClaw agent with maximum fidelity, see [§ 11 Migrating from OpenClaw](#11-migrating-from-openclaw).

### 6.2 Provider

| Backend | Notes |
|---------|-------|
| **Placeholder** | Offline; no network |
| **OpenAI** | API key, base URL, model (e.g. `gpt-4o`, `gpt-4o-mini`) |
| **Google Gemini** | API key, base URL, model (e.g. `gemini-2.5-flash`) |
| **xAI Grok** | API key, base URL, model (e.g. `grok-4-fast-reasoning`) |
| **Ollama (local)** | Base URL (default `http://127.0.0.1:11434`), model name |
| **Ollama Cloud** | API key, cloud model (e.g. `kimi-k2.5:cloud`) |
| **Anthropic** | API key, Claude model id |

### 6.3 Tools

| Toggle | Tools enabled |
|--------|----------------|
| **Web tools** | `web_search`, `fetch_url`, `http_request` (HTTPS-only) |
| **Headless browser fetch** | `fetch_browser` (Chrome/Chromium/Edge; JS-rendered pages) |
| **Ignore robots.txt** | Optional for `fetch_browser` only (off by default) |
| **Allow personality self-edit** | `personality_get`, `personality_update` on active profile |
| **Workspace tools** | Read/write/list under `{data_dir}/workspace` |
| **App data databases** | `database_query` on `.sqlite` in data folder |
| **Allow database writes** | INSERT/UPDATE/DELETE via `database_query` (dangerous) |

#### Coding mode (v2)

| Toggle | Tools / behavior |
|--------|------------------|
| **Link coding mode to active companion** | Shared persona + filtered memory (default **on**) |
| **Allow coding grep / patch** | `coding_grep`, `coding_apply_patch` |
| **Allow Run Command** | `coding_run_command` + integrated terminal |
| **Allow local git** | status, diff, commit |
| **Allow remote git** | push, pull, fetch, clone (HTTPS + GitHub PAT) |
| **GitHub PAT** | Encrypted token for HTTPS git |

Coding agent tools require **OpenAI, Anthropic, xAI, or Ollama**. Gemini and Placeholder do not execute tools.

Full reference: [CODING-MODE.md](./CODING-MODE.md).

**Note:** When you send an **image** on Ollama, web/workspace tools are **disabled for that request** so the model can receive the image payload.

### 6.4 General

| Section | Purpose |
|---------|---------|
| **Generation** | Temperature, max output tokens |
| **Memory** | LLM extraction, semantic recall, optional embedding model override, re-index embeddings |
| **Pulse** | Enable timer, interval (minutes), instructions; runs in **sidebar-selected** thread |
| **Updates** | **Store installs:** Microsoft Store (Library → Get updates). **GitHub installs:** Tauri updater checks GitHub Releases |
| **Open beta feedback** | Open prefilled GitHub Issues for bugs, ideas, or general beta notes |
| **Data** | Reveal data folder, wipe memories, factory reset |
| **About** | Backend version |

Pulse emits `pulse:tick` events; the chat UI reloads the thread after each tick.

---

## 7. Vision (image attachments)

### Requirements

- Vision-capable model (e.g. OpenAI `gpt-4o*`, Claude 3+, Ollama llava/kimi/vision models)
- Attach button is **disabled** with a tooltip when the active model is not supported

### Storage

Images save to `{data_dir}/attachments/{conversationId}/`. Paths are stored in SQLite. **Files are not encrypted.**

### Tips

- Add a short caption (“What is in this photo?”) with the image
- For Ollama Cloud **kimi** and similar models, ensure Provider tab shows the correct model id
- If the model acts blind, check terminal logs for `persistent-sage: chat completion includes image(s)`

---

## 8. Data and privacy (essentials)

| Item | Encrypted? |
|------|------------|
| `nova_memory.sqlite` | **No** — local only |
| `personality.json`, `settings.json` (non-key fields) | **No** |
| API keys in settings | **Yes** (AES-GCM) |
| Image files in `attachments/` | **No** |

Full detail: [PRIVACY.md](../PRIVACY.md) and [DATA-AND-PRIVACY.md](./DATA-AND-PRIVACY.md)

### Feedback privacy

The feedback buttons open public GitHub Issues. Persistent Sage pre-fills safe app context but does not attach private chats, Memory Anchors, logs, or API keys automatically.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `PERSISTENT_SAGE_DATA_DIR` | Custom data folder (legacy `NOVA_DATA_DIR` also works) |
| `PERSISTENT_SAGE_PORTABLE=1` | Portable `data/` next to executable (legacy `NOVA_PORTABLE=1` also works) |

---

## 9. Known limitations

| Topic | Status |
|-------|--------|
| Database encryption | Not implemented |
| Light theme | Settings → General → Appearance → Dark mode (off = light) |
| Browser-only `npm run dev` | No backend |
| Semantic vector search | Optional in Settings → Memory; hybrid with FTS + keyword |
| Windows code signing | Not active yet; see [SIGNING-AND-UPDATES.md](./SIGNING-AND-UPDATES.md) |
| Dedicated projects UI | Projects in briefing only |
| Coding IDE syntax highlighting | Textarea editor only (no Monaco) |
| Pulse + tools | Pulse uses normal chat path; tools follow same rules as manual send |

---

## 10. Quick reference checklist

- [x] Multi-conversation chat with streaming
- [x] Memory Anchor briefing, anchors, extract, recall
- [x] Four settings tabs (Companion, Provider, Tools, General)
- [x] Encrypted API keys; **unencrypted** local SQLite
- [x] Pulse in open thread
- [x] Image attach for vision models
- [x] Agent tools (optional), including `fetch_browser`
- [x] OpenClaw / Persistent Sage JSON personality import
- [x] In-app updater support for updater-enabled releases
- [x] Portable / custom data directory
- [x] Coding mode — repos, editor, terminal, coding agent tools

---

## 12. Coding mode (v2)

Switch to **Coding** in the header to work on software projects stored under `workspace/repos/`.

### Quick start

1. Open **Coding** mode.
2. **New project** or **Clone** a repository (or copy a repo folder and click **Refresh**).
3. Select the repo in the sidebar.
4. Enable coding tools in **Settings → Tools → Coding mode (v2)**.
5. Click files in the tree to edit; use the chat panel to ask the agent for changes.
6. Run commands in the integrated terminal (requires **Allow Run Command**).

### Key behaviors

- One coding conversation per **repository** (and companion when link is on).
- Editor supports multiple tabs, **Ctrl+S** save, revert, and open in external app.
- View modes: **Split**, **Editor**, or **Chat** only.
- Agent shell output appears in the terminal during chat turns.

Detailed documentation: **[CODING-MODE.md](./CODING-MODE.md)**.

---

## 11. Migrating from OpenClaw

Persistent Sage can import OpenClaw-style markdown from **Settings → Companion → Import OpenClaw markdown…** (`SOUL.md`, `IDENTITY.md`, `USER.md`, `JOURNAL.md`, `MEMORY.md`, `TOOLS.md`). That path is useful for a quick profile, but it may not capture everything a mature OpenClaw agent accumulated.

**Today, the most effective migration** uses Persistent Sage’s workspace and personality self-edit:

### Prerequisites

1. **Settings → Tools → Workspace tools** — on (so the companion can read files in `workspace/`).
2. **Settings → Tools → Allow personality self-edit** — on (so the companion can call `personality_update` and write `personality.json`).
3. Know your data folder: **Settings → General → Reveal data folder** → open `workspace/`.

### Step 1 — Copy markdown into workspace

Copy these files from your OpenClaw workspace into Persistent Sage’s `workspace/` directory:

- `IDENTITY.md`
- `SOUL.md`
- `JOURNAL.md`
- `USER.md`
- `MEMORY.md`

(`TOOLS.md` and others are optional; the five above are the usual core set.)

### Step 2 — Prompt the companion

In chat, send a message like:

> Please thoroughly read the following files located in your /workspace/ directory: IDENTITY.md, SOUL.md, JOURNAL.md, USER.md, MEMORY.md. Based on the contents of those files, edit your personality.json file using as much information as possible from those files. Remove any mention of running on the OpenClaw platform, or being dependent on markdown files to assemble your personality. Your personality from now on will be completely dependent on personality.json.

Review the result under **Settings → Companion** (fields and system prompt preview). Send follow-up tweaks in chat if needed.

### Step 3 — Remove workspace markdown

After you are satisfied, delete those `.md` files from `workspace/` so future turns do not treat them as live instructions.

### UI import vs this workflow

| Approach | When to use |
|----------|-------------|
| **Import OpenClaw markdown…** | Fast bootstrap; preview before adding a profile |
| **Workspace + prompt (above)** | Best fidelity for a long-running OpenClaw personality |

We are **still working on** a more efficient, streamlined migration (better mapping, fewer manual steps). Until then, treat the UI import as a starting point and the three-step workflow as the gold standard.

---

*For installation: [INSTALL.md](./INSTALL.md). For developers: [ARCHITECTURE.md](./ARCHITECTURE.md).*
