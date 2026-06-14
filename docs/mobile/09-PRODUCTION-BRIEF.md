# 09 — Production Brief

One-page executive summary for stakeholders and the production team planning **Persistent Sage for Android**.

**Baseline:** Desktop v2.0.0 (tag `v2.0.0`)  
**Date:** June 2026  
**Status:** Pre-development planning

---

## What we are building

**Persistent Sage for Android** — a mobile version of the existing desktop AI companion app. Same local-first privacy model, same Rust backend, same React UI (adapted for mobile navigation). Users configure their own LLM provider; all chat data stays on device.

---

## What already exists

| Asset | Status |
|-------|--------|
| Rust backend (`nova_lib`) | ✅ Complete — 20+ modules, 50+ IPC commands |
| React frontend | ✅ Complete — desktop layout only |
| SQLite schema (v7) | ✅ Complete with migrations |
| Provider integrations | ✅ OpenAI, Anthropic, Gemini, xAI, Ollama Cloud |
| Android launcher icons | ✅ Generated (background color needs fix) |
| Mobile entry point | ✅ `#[cfg_attr(mobile, tauri::mobile_entry_point)]` in `lib.rs` |
| Android build config | ❌ Not initialized (`tauri android init` not run) |
| Mobile CI | ❌ None |
| Play Store listing | ❌ None |

---

## Recommended approach

**Tauri 2 Android** in the existing monorepo (`persistent-sage`):

- Reuse `nova_lib` Rust backend via same Tauri IPC
- Adapt React UI from three-pane desktop to mobile navigation (drawer or tabs)
- Gate desktop-only features (headless Chrome, Store updater, splash window)
- Extend data directory resolution for Android internal storage
- Ship to Google Play Store as `app.persistentsage.mobile`

---

## Mobile v1 scope (draft)

### Include
- Chat with streaming + multi-thread conversations
- Memory Anchor (briefing, anchors, recall search)
- Cloud LLM providers (OpenAI, Anthropic, Gemini, xAI, Ollama Cloud)
- Companion personality (profiles, editor, import)
- Encrypted API keys
- Image attachments (camera/gallery)
- Onboarding + dark theme
- Chat artifacts (HTML, charts, forms)
- Web agent tools (search, fetch, HTTP)
- Factory reset / data wipe

### Exclude from v1
- Ollama local (no on-device LLM server)
- Headless browser fetch (`fetch_browser`)
- Desktop portable/USB mode
- Windows Store updater
- Microsoft Store / GitHub updater UI

### Decide before development
- Pulse background strategy on Android
- Navigation pattern (tabs vs drawer)
- Android Keystore for encryption keys
- Tablet support
- Projects and recipes priority

---

## Key technical facts

| Fact | Detail |
|------|--------|
| Stack | Tauri 2 + React 19 + Rust 1.77+ + SQLite |
| IPC commands | 50+ `invoke` calls — documented in [03-BACKEND-REFERENCE.md](./03-BACKEND-REFERENCE.md) |
| Database | `nova_memory.sqlite` schema v7 — 5 tables + FTS5 |
| Encryption | AES-256-GCM for API keys; DB not encrypted |
| Privacy | Local-first; no app-operated cloud; data sent only to user-configured LLM |
| Desktop identifier | `app.persistentsage.desktop` |
| Proposed Android ID | `app.persistentsage.mobile` |

---

## Effort drivers

| Area | Relative effort | Why |
|------|-----------------|-----|
| `tauri android init` + build pipeline | Medium | New platform setup, signing, CI |
| Mobile navigation redesign | **High** | Three-pane → single-pane; touches most components |
| Data dir on Android | Medium | New code path in `memory.rs` |
| Desktop feature gating | Medium | `#[cfg]`, hide UI toggles, stub IPC |
| Onboarding copy rewrite | Low | Android storage explanation |
| Artifact WebView testing | Medium | Sandbox iframes on Android WebView |
| Pulse background | Medium–High | Android Doze/WorkManager |
| Play Store submission | Medium | Assets, privacy policy, data safety form |

**Highest risk:** Mobile UX redesign of `ChatLayout` and `ConversationSidebar` — not a shrink-to-fit job.

---

## Dependencies and blockers

| Blocker | Resolution |
|---------|------------|
| No `gen/android/` project | Run `tauri android init` after decisions confirmed |
| `AppPlatform = "desktop"` only | Extend types for `"android"` |
| `keyring` crate on Android | Evaluate Keystore integration |
| Privacy policy is desktop-focused | Update `PRIVACY.md` before Play Store |
| Launcher icon white background | Regenerate with `#050a14` |

---

## Documentation set

| Doc | Purpose |
|-----|---------|
| [README.md](./README.md) | Index and reading order |
| [01-PROJECT-OVERVIEW.md](./01-PROJECT-OVERVIEW.md) | Product and user flows |
| [02-ARCHITECTURE.md](./02-ARCHITECTURE.md) | System layers and mobile strategy |
| [03-BACKEND-REFERENCE.md](./03-BACKEND-REFERENCE.md) | Rust modules and IPC |
| [04-FRONTEND-REFERENCE.md](./04-FRONTEND-REFERENCE.md) | React UI and mobile gaps |
| [05-FEATURE-MATRIX.md](./05-FEATURE-MATRIX.md) | Feature parity decisions |
| [06-DATA-AND-PRIVACY.md](./06-DATA-AND-PRIVACY.md) | Storage and Play Store compliance |
| [07-BRANDING-AND-IDENTIFIERS.md](./07-BRANDING-AND-IDENTIFIERS.md) | IDs and assets |
| [08-DECISIONS-AND-OPEN-QUESTIONS.md](./08-DECISIONS-AND-OPEN-QUESTIONS.md) | Pre-development decisions |

---

## Next steps

1. **Production team reviews** this documentation set
2. **Resolve decisions** in [08-DECISIONS-AND-OPEN-QUESTIONS.md](./08-DECISIONS-AND-OPEN-QUESTIONS.md)
3. **Produce project summary** (scope, timeline, team, risks) — share before development
4. **Spike:** `tauri android init` on a feature branch to validate build pipeline
5. **Begin development** after project summary approval

---

## Contact and repository

- **Repository:** https://github.com/g00siferdev-py/persistent-sage
- **Desktop release:** v2.0.0 (Microsoft Store + GitHub) — includes Coding mode
- **Maintainer:** g00siferdev-py
- **License:** MIT

---

*This brief is a planning artifact. Update when decisions are confirmed and development begins.*
