# Development guide

Instructions for contributors working on [g00siferdev-py/project-nova](https://github.com/g00siferdev-py/project-nova).

---

## Repository layout

```text
Nova/
├── src/                    # React frontend
│   ├── components/
│   ├── hooks/
│   ├── lib/
│   └── types/
├── src-tauri/              # Rust backend + Tauri config
│   ├── src/
│   ├── permissions/
│   └── tauri.conf.json
├── docs/                   # Documentation (this folder)
├── public/
├── README.md
├── CHANGELOG.md
└── package.json
```

---

## Daily workflow

```bash
# Terminal 1 — full app (required for chat/memory)
npm run tauri dev

# Verify Rust
cd src-tauri && cargo check && cargo test

# Verify frontend
cd .. && npm run build
```

**Do not** rely on `npm run dev` alone; it serves Vite without the Rust IPC layer.

---

## Rust conventions

- Format: `cargo fmt`
- Lint: `cargo clippy` (project may have existing warnings)
- New Tauri commands must be registered in `lib.rs` `generate_handler!` **and** `permissions/nova-invoke-allowlist.toml`
- Serde structs exposed to the frontend use `#[serde(rename_all = "camelCase")]`

---

## Frontend conventions

- TypeScript strict mode via `tsc`
- Path alias `@/` → `src/`
- Tailwind CSS v4 via `@tailwindcss/vite`
- Invoke backend with `@tauri-apps/api/core` `invoke`
- Listen for streaming with `@tauri-apps/api/event` (`chat:stream-start`, `chat:stream`, `chat:stream-error`, `pulse:tick`)

---

## Memory / migrations

- Bump `SCHEMA_VERSION` in `memory.rs` only when migrations cannot be idempotent
- Prefer idempotent `ALTER TABLE` helpers (see `migrate_message_image_columns`) for columns added after a version shipped
- Run migrations on **every** open, including when `user_version >= SCHEMA_VERSION`

---

## Pre-push checklist

1. `cd src-tauri && cargo check`
2. `cd src-tauri && cargo test`
3. `npm run build`
4. Smoke-test in `npm run tauri dev`:
   - New chat + send message
   - Settings provider switch
   - Optional: attach image with vision model
   - Optional: Pulse tick (if enabled)
5. **Never commit** API keys, `settings.json`, `personality.json`, or `nova_memory.sqlite` from your data dir
6. Update `CHANGELOG.md` and relevant `docs/` for user-visible changes

---

## Suggested commit format

```text
feat(scope): short imperative summary

Optional body explaining why, not just what.
```

Examples: `feat(chat): vision attachments for OpenAI and Ollama`, `docs: add install and privacy guides`, `fix(memory): run image column migration on v6 databases`.

---

## Release build

```bash
npm run tauri build
```

Artifacts: `src-tauri/target/release/bundle/`

---

## Related documents

- [INSTALL.md](./INSTALL.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [../NOVA-STATUS.md](../NOVA-STATUS.md) — Backlog and shipped features
