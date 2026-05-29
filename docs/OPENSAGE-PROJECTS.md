# OpenSage collaborative projects (experimental)

Available on branch `opensage-experimental` when **Settings → Tools → Enable chat artifacts** is on.

## What this is

A **domain-agnostic** workflow for ongoing work with your agent:

- Monthly budgets, marketing plans, audits, trip planning, etc.
- Not a separate “budget app” — the same machinery for any project type.

## Flow

1. **Start** — Ask in chat (“help me build a monthly budget”) or use the **Start a project** recipe.
2. **Intake** — The agent should offer:
   - **Workspace files** — put documents in the agent workspace (`workspace/` under your data folder).
   - **Form artifact** — interactive fields in chat; submit with **Send to Sage**.
3. **Living document** — The agent saves the canonical report to  
   `workspace/projects/<id>/document.md` using `project_read` / `project_write` tools.
4. **Iterate** — Edit via form submissions, chat (“raise rent to $1200”), or workspace files; the agent revises the project file and can return html/markdown/vega artifacts.

## Artifacts

| Type | Role |
|------|------|
| `form` | Interactive intake or structured edits (user submits to chat) |
| `html` / `markdown` | Readable reports (prefer syncing truth to `document.md`) |
| `vegaLite` | Charts with inline data |

Optional `projectId` on any artifact links UI to a project slug.

## Data locations (OpenSage)

- Index: `workspace/projects/_index.json`
- Per project: `workspace/projects/<slug>/document.md`

## Tips for testing

1. Enable artifacts in Settings → Tools.
2. Run **Start a project** or ask for a budget/plan.
3. When you get a `form` artifact, fill it and click **Send to {your companion's name}** (brief **Submitted** flash; no raw JSON in chat).
4. Confirm `workspace/projects/` updates and an **html** report artifact after the agent replies.

Persistent Sage (`main`) does not include this system until merged intentionally.
