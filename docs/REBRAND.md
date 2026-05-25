# Rebrand: Nova → Persistent Sage

The product name **Persistent Sage** replaces the codename **Nova** in all user-facing UI, installers, and documentation. The Git repository may stay `project-nova` on GitHub until you rename it in repository settings (optional; links keep working).

## Repo: rename or keep?

| Option | When to use |
|--------|-------------|
| **Keep `project-nova`** (recommended for now) | Preserves issues, Actions history, Releases URLs. Update README links when you rename later. |
| **Rename repo** to `persistent-sage` | GitHub → Settings → General → Repository name. Add a short note in README for old clones. |

No need for a second empty repository.

## What changed (0.2.0-beta.4)

- **Display name:** Persistent Sage (window title, installer, Start Menu).
- **Branding:** `public/persistent-sage-splash.png`, `persistent-sage-plate.png`, `persistent-sage-icon.png`; Tauri icons regenerated from `packaging/branding/SageIcon*.png`.
- **Tauri identifier:** `app.persistentsage.desktop` (new OS data location).
- **Data directory:** `%LOCALAPPDATA%\Persistent Sage\Persistent Sage\data\` (Windows), `~/.local/share/persistent-sage/data/` (Linux), etc.
- **Portable launcher:** `Start-Persistent-Sage-Portable.bat` (sets `PERSISTENT_SAGE_PORTABLE=1`; `NOVA_PORTABLE=1` still honored).

## What did *not* change (internal stability)

- SQLite file: `nova_memory.sqlite`
- Legacy env overrides: `NOVA_DATA_DIR`, `NOVA_PORTABLE` (new names are `PERSISTENT_SAGE_*`)
- `localStorage` key `persistent-sage-theme`
- GitHub remote URL until you rename the repo

## Migrating from Nova beta installs

Existing testers who used **Nova** builds have data under the old path, for example:

- Windows: `%LOCALAPPDATA%\Nova\Nova\data\`
- New installs: `%LOCALAPPDATA%\Persistent Sage\Persistent Sage\data\`

**Options:**

1. **Fresh start** — install Persistent Sage beta.4; re-enter API keys in setup wizard.
2. **Copy data** — quit the app, copy `nova_memory.sqlite`, `settings.json`, `personality.json`, and `workspace/` from the old folder into the new data directory, then start Persistent Sage.

Portable USB: copy the whole `data\` folder next to the new portable build.

## SignPath / web presence

SignPath and similar programs care about **project identity** (open source, website, name), not the git folder name. Use **Persistent Sage** on your site and in the application; link to this repo or a future `persistent-sage` repo.

## Release checklist after rebrand

1. Bump version in `package.json`, `tauri.conf.json`, `Cargo.toml`.
2. `npm run branding:icons` (after changing `SageIcon1024.png`).
3. Tag `v0.2.0-beta.4` → CI → publish GitHub Release.
4. Release notes: `docs/releases/v0.2.0-beta.4.md`.
