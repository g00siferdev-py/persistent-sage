# Persistent Sage documentation

Persistent Sage is a **local-first desktop AI companion** (Tauri 2 + React + Rust). Everything in this folder is written for beta testers, contributors, and anyone performing a **fresh install** from source.

**Repository:** [g00siferdev-py/persistent-sage](https://github.com/g00siferdev-py/persistent-sage) · **Version:** 2.0.0

## Start here

| Document | Audience | Contents |
|----------|----------|----------|
| [**INSTALL.md**](./INSTALL.md) | Everyone installing Persistent Sage | Prerequisites, clone, build, first-run configuration, environment variables |
| [**INSTALL-WINDOWS.md**](./INSTALL-WINDOWS.md) | Windows testers | Installer, portable USB, troubleshooting |
| [**PUBLISH.md**](./PUBLISH.md) | Maintainers | Ship installers via GitHub Releases |
| [**BUILD-CI.md**](./BUILD-CI.md) | Maintainers | GitHub Actions Windows builds |
| [**MICROSOFT-STORE.md**](./MICROSOFT-STORE.md) | Maintainers | MSIX packaging path for Microsoft Store submission |
| [**DATA-AND-PRIVACY.md**](./DATA-AND-PRIVACY.md) | Security-conscious users | What stays on disk, what is encrypted, what is **not** encrypted |
| [**SIGNING-AND-UPDATES.md**](./SIGNING-AND-UPDATES.md) | Maintainers and testers | Tauri updater, release assets, SignPath readiness |
| [**USER-GUIDE.md**](./USER-GUIDE.md) | Daily users | UI layout, Companion + Coding mode, memory, settings, Pulse |
| [**CODING-MODE.md**](./CODING-MODE.md) | Developers & power users | Repos, IDE, terminal, coding agent tools, GitHub PAT |
| [**PRODUCT-KNOWLEDGE-BASE.md**](./PRODUCT-KNOWLEDGE-BASE.md) | Marketing & support agents | Full product KB: positioning, features, FAQ, troubleshooting, copy blocks |
| [**ARCHITECTURE.md**](./ARCHITECTURE.md) | Developers | Stack, data flow, key modules, IPC surface |
| [**DEVELOPMENT.md**](./DEVELOPMENT.md) | Contributors | Dev workflow, tests, pre-push checklist |
| [**BRANCHING.md**](./BRANCHING.md) | Contributors | `main` vs `opensage-experimental`, two-folder dev layout |

## Mobile (Android) — production documentation

Planning docs for the **Persistent Sage Android** application. Start at [**mobile/README.md**](./mobile/README.md).

| Document | Audience | Contents |
|----------|----------|----------|
| [**mobile/09-PRODUCTION-BRIEF.md**](./mobile/09-PRODUCTION-BRIEF.md) | Stakeholders | One-page executive summary |
| [**mobile/01-PROJECT-OVERVIEW.md**](./mobile/01-PROJECT-OVERVIEW.md) | Production team | Product vision, 1.0 features, user flows |
| [**mobile/02-ARCHITECTURE.md**](./mobile/02-ARCHITECTURE.md) | Engineers | System layers, data flow, Tauri mobile strategy |
| [**mobile/03-BACKEND-REFERENCE.md**](./mobile/03-BACKEND-REFERENCE.md) | Engineers | Rust modules, IPC commands, database, providers |
| [**mobile/04-FRONTEND-REFERENCE.md**](./mobile/04-FRONTEND-REFERENCE.md) | Engineers | React UI, hooks, mobile adaptation gaps |
| [**mobile/05-FEATURE-MATRIX.md**](./mobile/05-FEATURE-MATRIX.md) | Product / engineering | Feature parity: ship / adapt / defer / exclude |
| [**mobile/06-DATA-AND-PRIVACY.md**](./mobile/06-DATA-AND-PRIVACY.md) | Security / compliance | Storage, encryption, Play Store requirements |
| [**mobile/08-DECISIONS-AND-OPEN-QUESTIONS.md**](./mobile/08-DECISIONS-AND-OPEN-QUESTIONS.md) | Production team | Pre-development decisions checklist |

## Repository root files

| File | Purpose |
|------|---------|
| [README.md](../README.md) | Project overview and quick start |
| [PRIVACY.md](../PRIVACY.md) | Public privacy policy |
| [SECURITY.md](../SECURITY.md) | Vulnerability reporting and signing status |
| [CHANGELOG.md](../CHANGELOG.md) | Notable changes by release |
| [PERSISTENT-SAGE-STATUS.md](../PERSISTENT-SAGE-STATUS.md) | Engineering status and backlog |
| [LICENSE](../LICENSE) | MIT License |

## Important privacy note

After you build and run Persistent Sage, **all conversation data lives on your machine** under the application data directory. **API keys** are encrypted at rest. The **SQLite database** (`nova_memory.sqlite`) that stores chats, anchors, and metadata is **not encrypted**—see [PRIVACY.md](../PRIVACY.md) and [DATA-AND-PRIVACY.md](./DATA-AND-PRIVACY.md) for details and mitigations.

## Support matrix (open beta)

| Requirement | Version / notes |
|-------------|-----------------|
| Persistent Sage | **2.0.0** |
| Rust | **1.77+** (`rust-version` in `src-tauri/Cargo.toml`) |
| Node.js | **LTS** (18 or 20 recommended) |
| Desktop OS | Linux, macOS, Windows (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)) |
| Runtime | **`npm run tauri dev`** or a release bundle—not `npm run dev` alone |
| Browser (optional) | Chrome, Chromium, or Edge for `fetch_browser` |

## Feedback

Use **Settings → General → Open beta feedback** in the app, or open [GitHub Issues](https://github.com/g00siferdev-py/persistent-sage/issues). Feedback reports are public, so do not include API keys, private chats, Memory Anchors, or sensitive personal information.

---

*Documentation aligns with app **2.0.0**. Update these files when user-visible behavior changes.*
