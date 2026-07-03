# Contributing to Persistent Sage

Thank you for helping improve Persistent Sage. The project is maintained by **[g00siferdev-py](https://github.com/g00siferdev-py)** on [github.com/g00siferdev-py/persistent-sage](https://github.com/g00siferdev-py/persistent-sage).

**Current release:** **2.1.0** — Companion mode, Coding mode, Microsoft Store MSIX path, and GitHub direct-download installers.

---

## Testing and feedback (no code required)

1. Install from the **[Microsoft Store](https://apps.microsoft.com)** (when listed), **[GitHub Releases](https://github.com/g00siferdev-py/persistent-sage/releases)**, or build from source per **[docs/INSTALL.md](./docs/INSTALL.md)**.
2. Exercise **Companion** and **Coding** modes, **Settings**, optional **Pulse**, vision attachments, and agent tools if you use them.
3. Open a **[GitHub issue](https://github.com/g00siferdev-py/persistent-sage/issues)** or use **Settings → General → Send feedback** with:
   - OS and Persistent Sage version (header badge or Settings → About)
   - Provider and model
   - Install source (Store, GitHub installer, portable, source build)
   - Steps to reproduce
   - Error text (redact API keys)

Feedback is public on GitHub. Do not include private chats, Memory Anchors, API keys, or sensitive personal information.

---

## Code contributions

### Before you start

1. Read [docs/INSTALL.md](./docs/INSTALL.md) and get `npm run tauri dev` running.
2. Read [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) for the pre-push checklist.
3. Read [PRIVACY.md](./PRIVACY.md) and [docs/DATA-AND-PRIVACY.md](./docs/DATA-AND-PRIVACY.md) — do not commit user databases, settings, or API keys.

### Pull request expectations

- Focused changes with a clear description
- `cargo check` and `cargo test` pass in `src-tauri/`
- `npm run build` passes
- User-visible changes noted in `CHANGELOG.md` under `[Unreleased]` or the release section when cutting a version
- Documentation updated in `docs/` when behavior changes

### Code style

- Rust: `cargo fmt` before commit
- TypeScript: match existing patterns in `src/`
- New IPC commands: register in `lib.rs` and `permissions/nova-invoke-allowlist.toml`

### Suggested commit format

```text
feat(scope): short imperative summary

Optional body explaining why, not just what.
```

---

## Questions and discussion

Use [GitHub Issues](https://github.com/g00siferdev-py/persistent-sage/issues) for bugs, migration feedback, and feature discussion.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
