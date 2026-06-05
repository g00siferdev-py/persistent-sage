# Persistent Sage collaborative projects

Available when **Settings → Tools → Enable chat artifacts** is on (default in 1.0).

## What this is

A **domain-agnostic** workflow for ongoing work with your agent:

- Monthly budgets, marketing plans, audits, trip planning, etc.
- Not a separate “budget app” — the same machinery for any project type.

## Flow

1. **Start** — Ask in chat (“help me build a monthly budget”) or use the **Start a project** recipe.
2. **Intake** — The agent should offer:
   - **(A)** files in the workspace folder, or
   - **(B)** a **form** artifact to collect details.
3. **Living document** — Canonical content lives in `workspace/projects/{id}/document.md` via `project_write`.
4. **Deliverables** — HTML artifacts for polished reports; charts and tables render in chat.

## Data locations

| Path | Purpose |
|------|---------|
| `{data_dir}/workspace/projects/` | Project folders and `document.md` files |
| `{data_dir}/recipes.json` | Saved one-click workflows |
| Global memory anchors `[project:slug]` | Shared across companion profiles |

See [USER-GUIDE.md](./USER-GUIDE.md) and [ARCHITECTURE.md](./ARCHITECTURE.md) for the full stack.
