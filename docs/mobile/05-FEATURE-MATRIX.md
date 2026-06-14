# 05 — Feature Matrix

Feature-by-feature analysis for Persistent Sage Android. Use this matrix when writing the project summary and scoping mobile v1.

**Legend:**
- ✅ **Ship** — reuse with minimal or no changes
- 🔧 **Adapt** — reuse with platform-specific modifications
- ⏸️ **Defer** — valid feature but not in mobile v1
- ❌ **Exclude** — not viable on Android without major rework

---

## Core experience

| Feature | Desktop 1.0 | Mobile recommendation | Notes |
|---------|-------------|----------------------|-------|
| Multi-thread chat | ✅ | ✅ Ship | Core product |
| Streaming responses | ✅ | ✅ Ship | Via `chat:stream` events |
| Conversation rename/delete | ✅ | ✅ Ship | |
| Companion selector | ✅ | ✅ Ship | Header or overflow menu |
| Thinking effort selector | ✅ | 🔧 Adapt | Move to overflow menu on narrow screens |
| Onboarding wizard | ✅ | 🔧 Adapt | Rewrite storage copy for Android |
| What's New modal | ✅ | ✅ Ship | |
| Dark/light theme | ✅ | ✅ Ship | `useTheme` + localStorage |
| Backend hint banner | ✅ | ✅ Ship | Missing API key warning |

---

## Memory Anchor

| Feature | Desktop 1.0 | Mobile recommendation | Notes |
|---------|-------------|----------------------|-------|
| Startup briefing | ✅ | ✅ Ship | May move to dedicated Memory screen |
| Anchor list (per thread) | ✅ | 🔧 Adapt | Sidebar → drawer or Memory tab |
| Extract raw anchors | ✅ | ✅ Ship | |
| Global recall search | ✅ | 🔧 Adapt | Dedicated search screen |
| Hybrid FTS recall | ✅ | ✅ Ship | Backend unchanged |
| Semantic embedding recall | ✅ | ✅ Ship | Requires network for embedding API |
| LLM anchor extraction | ✅ | ✅ Ship | Background task — test battery impact |
| Reindex embeddings | ✅ | ✅ Ship | Settings → General |
| Personality-scoped memory | ✅ | ✅ Ship | |
| Shared project anchors | ✅ | ✅ Ship | `__shared__` personality ID |

---

## Companion / Personality

| Feature | Desktop 1.0 | Mobile recommendation | Notes |
|---------|-------------|----------------------|-------|
| Multiple profiles | ✅ | ✅ Ship | |
| Personality editor | ✅ | 🔧 Adapt | Full-screen on mobile |
| System prompt preview | ✅ | ✅ Ship | Scrollable panel |
| Persistent Sage JSON import | ✅ | 🔧 Adapt | SAF file picker |
| OpenClaw markdown import | ✅ | 🔧 Adapt | SAF file picker |
| Personality self-edit (agent) | ✅ | ✅ Ship | Backend tool unchanged |
| Live prompt preview | ✅ | ✅ Ship | |

---

## LLM Providers

| Provider | Desktop 1.0 | Mobile recommendation | Notes |
|----------|-------------|----------------------|-------|
| OpenAI | ✅ | ✅ Ship | Primary mobile provider |
| Anthropic | ✅ | ✅ Ship | |
| Google Gemini | ✅ | ✅ Ship | Tool support limited on desktop too |
| xAI Grok | ✅ | ✅ Ship | |
| Ollama Cloud | ✅ | ✅ Ship | Requires API key |
| Ollama local | ✅ | ❌ Exclude | No local LLM server on phone |
| Placeholder | ✅ | ✅ Ship | Offline demo mode |

---

## Vision / Attachments

| Feature | Desktop 1.0 | Mobile recommendation | Notes |
|---------|-------------|----------------------|-------|
| Image attach in composer | ✅ | 🔧 Adapt | Camera + gallery picker |
| `convertFileSrc` display | ✅ | 🔧 Adapt | Verify Tauri mobile asset URLs |
| Vision model detection | ✅ | ✅ Ship | `chat_vision_supported` |
| Image storage in attachments/ | ✅ | ✅ Ship | App-private dir |

---

## Chat artifacts

| Artifact type | Desktop 1.0 | Mobile recommendation | Notes |
|---------------|-------------|----------------------|-------|
| HTML reports | ✅ | 🔧 Adapt | Test WebView sandbox + CSP |
| Vega-Lite charts (SVG) | ✅ | 🔧 Adapt | Self-contained; test iframe sizing |
| Markdown tables | ✅ | ✅ Ship | |
| Interactive forms | ✅ | 🔧 Adapt | Test touch targets, select/radio |
| Citation pills → open file | ✅ | 🔧 Adapt | Replace `open_path` with in-app viewer |
| Artifact streaming placeholder | ✅ | ✅ Ship | "Preparing report…" |

---

## Agent tools

| Tool | Desktop 1.0 | Mobile recommendation | Notes |
|------|-------------|----------------------|-------|
| `web_search` | ✅ | ✅ Ship | Network permission required |
| `fetch_url` | ✅ | ✅ Ship | |
| `http_request` | ✅ | ✅ Ship | HTTPS only |
| `fetch_browser` | ✅ | ❌ Exclude | Requires headless Chrome — no Android equivalent in codebase |
| `workspace_read_file` | ✅ | 🔧 Adapt | App-private workspace dir |
| `workspace_write_file` | ✅ | 🔧 Adapt | Same sandbox model |
| `workspace_list_directory` | ✅ | 🔧 Adapt | |
| `database_query` | ✅ | ⏸️ Defer | Advanced; low mobile priority |
| `personality_get/update` | ✅ | ✅ Ship | |
| `memory_search` | ✅ | ✅ Ship | |
| `project_list/create/read/write/set_active` | ✅ | 🔧 Adapt | v1: ship if artifacts enabled |

**Mobile v1 tool recommendation:** Enable web tools + workspace + memory + personality + projects. Hide browser fetch and database query.

---

## Projects

| Feature | Desktop 1.0 | Mobile recommendation | Notes |
|---------|-------------|----------------------|-------|
| Project chips in composer | ✅ | 🔧 Adapt | Horizontal scroll on narrow screen |
| Agent project tools | ✅ | 🔧 Adapt | |
| Project form submission | ✅ | ✅ Ship | Silent send flow |
| Dedicated projects UI | ❌ (data only) | ⏸️ Defer | Desktop has no screen either |
| `workspace/projects/` storage | ✅ | ✅ Ship | App-private dir |

---

## Pulse

| Feature | Desktop 1.0 | Mobile recommendation | Notes |
|---------|-------------|----------------------|-------|
| Scheduled check-ins | ✅ | 🔧 Adapt | Background execution on Android needs WorkManager/foreground service |
| Send Pulse now | ✅ | ✅ Ship | |
| Silent user message | ✅ | ✅ Ship | |
| Pulse conversation binding | ✅ | ✅ Ship | |
| Background loop | ✅ | 🔧 Adapt | Android battery/Doze constraints |

**Critical mobile decision:** Pulse background scheduling strategy (see [08-DECISIONS-AND-OPEN-QUESTIONS.md](./08-DECISIONS-AND-OPEN-QUESTIONS.md)).

---

## Recipes

| Feature | Desktop 1.0 | Mobile recommendation | Notes |
|---------|-------------|----------------------|-------|
| Recipe list in composer | ✅ | 🔧 Adapt | Footer chip layout |
| Recipe run | ✅ | ✅ Ship | |
| `recipes.json` storage | ✅ | ✅ Ship | |

---

## Settings

| Tab / section | Desktop 1.0 | Mobile recommendation | Notes |
|---------------|-------------|----------------------|-------|
| Companion tab | ✅ | ✅ Ship | |
| Provider tab | ✅ | ✅ Ship | |
| Tools tab | ✅ | 🔧 Adapt | Hide desktop-only toggles |
| General tab | ✅ | 🔧 Adapt | Remove Windows-specific items |
| API key entry | ✅ | ✅ Ship | Secure input field |
| Model refresh lists | ✅ | ✅ Ship | |
| Temperature / max tokens | ✅ | ✅ Ship | |
| Data directory reveal | ✅ | 🔧 Adapt | Show path; no "reveal in Explorer" |
| Factory reset / wipe | ✅ | ✅ Ship | |
| Open beta feedback | ✅ | ✅ Ship | Opens browser to GitHub Issues |

---

## Updates and distribution

| Feature | Desktop 1.0 | Mobile recommendation | Notes |
|---------|-------------|----------------------|-------|
| GitHub Tauri updater | ✅ (NSIS) | ❌ Exclude | Not applicable to Play Store |
| Microsoft Store updater | ✅ (MSIX) | ❌ Exclude | Windows only |
| Google Play updates | — | 🔧 Adapt | New — Play In-App Updates or store-only |
| `app_distribution_info` | ✅ | 🔧 Adapt | Add `google_play` channel |
| Portable USB mode | ✅ | ❌ Exclude | Desktop concept |
| `PERSISTENT_SAGE_DATA_DIR` | ✅ | ⏸️ Defer | Custom data dir picker — backlog on desktop too |

---

## Desktop-only features (exclude from mobile v1)

| Feature | Reason |
|---------|--------|
| Splash screen window | Two-window desktop pattern |
| Settings panel layout modes (hidden/compact/full) | Desktop column layout |
| `fetch_browser` (headless Chrome) | No Chrome binary on Android |
| `browser_detect_chromium` | Desktop only |
| Microsoft Store update UI | Windows only |
| Portable mode (`PERSISTENT_SAGE_PORTABLE`) | USB exe layout |
| NSIS installer branding | Windows packaging |
| Ollama local provider | No on-device LLM server |

---

## Suggested mobile v1 scope (starting point)

Use this as a draft for the project summary. Adjust based on team capacity.

### Must have (MVP)
- Chat with streaming
- Memory Anchor (briefing, anchors, recall)
- Provider configuration (OpenAI, Anthropic, Gemini, xAI, Ollama Cloud)
- Companion personality (single profile minimum; multi-profile preferred)
- Encrypted API keys
- Onboarding
- Dark theme
- Image attachments (camera/gallery)

### Should have
- Chat artifacts (HTML, charts, forms)
- Web agent tools (search, fetch, HTTP)
- Projects (chips + agent tools)
- Pulse (with foreground/scheduled strategy)
- What's New modal
- Wipe controls

### Could have (v1.1+)
- Workspace file tools
- Recipes
- Semantic embedding reindex UI
- Database query tool
- Multi-profile import (OpenClaw)
- Custom data directory

### Won't have (v1)
- Ollama local
- Headless browser fetch
- Desktop portable mode
- Windows Store updater
- Dedicated projects screen

---

## Related documents

- [08-DECISIONS-AND-OPEN-QUESTIONS.md](./08-DECISIONS-AND-OPEN-QUESTIONS.md) — decisions that affect this matrix
- [09-PRODUCTION-BRIEF.md](./09-PRODUCTION-BRIEF.md) — executive summary
- [01-PROJECT-OVERVIEW.md](./01-PROJECT-OVERVIEW.md) — product context
