# Contributing to Nova

Thank you for helping test and improve Nova. The project is maintained by **[g00siferdev-py](https://github.com/g00siferdev-py)** on [github.com/g00siferdev-py/project-nova](https://github.com/g00siferdev-py/project-nova).

Nova **0.2.0-beta.1** is in **open beta**: core flows work, but APIs, settings, and UX may still change. Your reports and patches are especially valuable right now.

---

## Beta testing (no code required)

1. Follow **[docs/INSTALL.md](./docs/INSTALL.md)** and run `npm run tauri dev` (or a release build from `npm run tauri build`).
2. Exercise chat, **Settings** (Companion, Provider, Tools, General), optional **Pulse**, image attach, and agent tools if you use them.
3. If you migrate from **OpenClaw**, try the workflow in **[docs/USER-GUIDE.md § Migrating from OpenClaw](./docs/USER-GUIDE.md#11-migrating-from-openclaw)** and note what worked or failed.
4. Open a **[GitHub issue](https://github.com/g00siferdev-py/project-nova/issues)** with:
   - OS and Nova version (`0.2.0-beta.1` or git commit)
   - Provider and model
   - Steps to reproduce
   - Terminal or in-app error text (redact API keys)

---

## Code contributions

### Before you start

1. Read [docs/INSTALL.md](./docs/INSTALL.md) and get `npm run tauri dev` running.
2. Read [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) for the pre-push checklist.
3. Read [docs/DATA-AND-PRIVACY.md](./docs/DATA-AND-PRIVACY.md) — do not commit user databases, settings, or API keys.

### Pull request expectations

- Focused changes with a clear description
- `cargo check` and `cargo test` pass in `src-tauri/`
- `npm run build` passes
- User-visible changes noted in `CHANGELOG.md` under `[Unreleased]` (or the next beta section when cutting a release)
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

Use [GitHub Issues](https://github.com/g00siferdev-py/project-nova/issues) on **g00siferdev-py/project-nova** for bugs, migration feedback, and feature discussion.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
