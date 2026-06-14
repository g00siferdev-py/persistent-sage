# Persistent Sage Mobile — Production Documentation

**Audience:** Production team building the **Persistent Sage Android application**  
**Baseline:** Desktop **v2.0.0** (`main` @ tag `v2.0.0`)  
**Status:** Planning phase — no Android build exists yet  
**Repository:** [g00siferdev-py/persistent-sage](https://github.com/g00siferdev-py/persistent-sage)

---

## Purpose

This documentation set explains **Persistent Sage from top to bottom** so your production team can plan and build the Android mobile application. It is derived from the shipping **2.0.0** desktop codebase (Tauri 2 + React 19 + Rust). Desktop **2.0** adds **Coding mode** (repos, IDE, terminal); mobile planning docs treat that as **desktop-only** unless explicitly scoped for Android.

After your team agrees on scope and approach, you will produce a **project summary** to share before development begins. Use the documents below as the technical foundation for that summary.

---

## Recommended reading order

| # | Document | What you will learn |
|---|----------|---------------------|
| 1 | [**01-PROJECT-OVERVIEW.md**](./01-PROJECT-OVERVIEW.md) | Product vision, 1.0 feature set, user flows, desktop vs mobile |
| 2 | [**02-ARCHITECTURE.md**](./02-ARCHITECTURE.md) | System layers, data flow, what is reusable on Android, Tauri mobile hooks |
| 3 | [**03-BACKEND-REFERENCE.md**](./03-BACKEND-REFERENCE.md) | Rust modules, all IPC commands, database schema, settings, providers, agent tools |
| 4 | [**04-FRONTEND-REFERENCE.md**](./04-FRONTEND-REFERENCE.md) | React UI structure, hooks, types, IPC usage, mobile UI gaps |
| 5 | [**05-FEATURE-MATRIX.md**](./05-FEATURE-MATRIX.md) | Feature-by-feature parity: ship / adapt / defer / exclude on Android |
| 6 | [**06-DATA-AND-PRIVACY.md**](./06-DATA-AND-PRIVACY.md) | Local storage, encryption, Android storage and privacy requirements |
| 7 | [**07-BRANDING-AND-IDENTIFIERS.md**](./07-BRANDING-AND-IDENTIFIERS.md) | App IDs, package names, icons, version scheme |
| 8 | [**08-DECISIONS-AND-OPEN-QUESTIONS.md**](./08-DECISIONS-AND-OPEN-QUESTIONS.md) | Decisions the team must make before development |
| 9 | [**09-PRODUCTION-BRIEF.md**](./09-PRODUCTION-BRIEF.md) | One-page executive summary for stakeholders |

---

## Related desktop documentation

These existing docs describe the **shipping desktop product**. Mobile work should stay consistent with them unless a deliberate platform exception is documented.

| Document | Relevance to mobile |
|----------|---------------------|
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Desktop-centric architecture overview (complement with `02-ARCHITECTURE.md`) |
| [DATA-AND-PRIVACY.md](../DATA-AND-PRIVACY.md) | Privacy model that mobile must honor |
| [PRIVACY.md](../../PRIVACY.md) | Public privacy policy — Play Store listing will need an update |
| [PRODUCT-KNOWLEDGE-BASE.md](../PRODUCT-KNOWLEDGE-BASE.md) | Feature descriptions and FAQ (currently states "desktop only") |
| [USER-GUIDE.md](../USER-GUIDE.md) | End-user behavior reference for parity decisions |
| [packaging/BRAND-ASSETS.md](../../packaging/BRAND-ASSETS.md) | Canonical icon and splash sources |
| [CHANGELOG.md](../../CHANGELOG.md) | v1.0.0 release notes |
| [docs/releases/v1.0.0.md](../releases/v1.0.0.md) | GA release highlights |

---

## Key facts for mobile planning

| Fact | Detail |
|------|--------|
| **Current platform** | Desktop only (Windows NSIS/portable via GitHub; MSIX via Microsoft Store) |
| **Mobile scaffolding** | `nova_lib::run()` has `#[cfg_attr(mobile, tauri::mobile_entry_point)]`; Android launcher icons exist under `src-tauri/icons/android/` |
| **Not yet present** | No `tauri android init`, no `gen/android/`, no mobile CI, no Play Store docs |
| **Shared backend** | Entire Rust library (`nova_lib`) is intended to be the mobile backend via Tauri IPC |
| **Shared frontend** | React 19 + TypeScript UI — needs responsive/mobile navigation redesign |
| **App version** | `2.0.0` across `package.json`, `Cargo.toml`, `tauri.conf.json` |

---

## Glossary

| Term | Meaning |
|------|---------|
| **Memory Anchor** | Long-term memory system: SQLite conversations, messages, anchors, hybrid recall |
| **Companion / Personality** | User-defined AI persona stored in `personality.json` |
| **Pulse** | Scheduled background check-in that posts to an open chat thread |
| **Artifact** | Rich chat output: HTML report, chart, table, or interactive form |
| **Project** | Collaborative living document under `workspace/projects/` with agent tools |
| **Nova** | Legacy codename — still appears in filenames (`nova_memory.sqlite`, `.nova_crypto/`) |
| **IPC** | Tauri `invoke` commands between React frontend and Rust backend |

---

*Documentation generated from Persistent Sage v2.0.0 codebase. Update when mobile development begins or desktop APIs change.*
