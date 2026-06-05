# Branch and clone layout

Persistent Sage and OpenSage share one GitHub repository but use **separate branches** and (recommended) **separate local folders** so release builds do not pick up experimental work by accident.

## Branches

| Branch | Purpose |
|--------|---------|
| **`main`** | **Persistent Sage** — beta releases, Windows installer CI, Microsoft Store MSIX (`store-msix` mirrors this). |
| **`opensage-experimental`** | Feature integration branch (historical). **1.0** features (artifacts, projects) ship on **`main`**. |
| **`store-msix`** | Auto-synced from `main`; do not develop here. |

## Recommended local folders (Windows)

| Folder | Stay on branch | Run dev |
|--------|----------------|---------|
| `C:\Projects\persistent-sage` | `main` | `npm run tauri dev` → Persistent Sage |
| `C:\Projects\opensage` | `opensage-experimental` | `npm run tauri dev` → OpenSage |

Second clone setup:

```powershell
git clone https://github.com/g00siferdev-py/persistent-sage.git C:\Projects\opensage
cd C:\Projects\opensage
git checkout opensage-experimental
npm install
```

**Rule:** Do not `git checkout` the other product branch inside the “stable” folder. Use the other directory instead.

## What `npm run tauri dev` builds

It compiles **only the files in the current folder**, on **whatever branch that folder is checked out to**. There is no automatic routing to “the right” branch.

## Protect `main` on GitHub

1. Repository → **Settings** → **Branches** → **Add branch protection rule**
2. Branch name pattern: `main`
3. Enable **Require a pull request before merging** (and optionally block direct pushes)
4. Do not merge `opensage-experimental` into `main` except via an explicit release PR after review

## Data directories

| Product | Default Windows data (typical) |
|---------|--------------------------------|
| Persistent Sage | `%APPDATA%\Persistent Sage\` |
| OpenSage | `%APPDATA%\OpenSage\` |

API keys and chats are not shared between the two app identifiers unless you point both at the same path with `PERSISTENT_SAGE_DATA_DIR`.
