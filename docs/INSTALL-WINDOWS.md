# Installing Nova on Windows (beta)

Download the installer from **[GitHub Releases](https://github.com/g00siferdev-py/project-nova/releases)** (`Nova_*_x64-setup.exe`). No Node or Rust required.

Two supported ways to run Nova: **desktop install** (recommended) and **portable** (USB / flash drive).

---

## Option A — Windows installer (recommended)

### Install from Releases

1. Open **[Releases](https://github.com/g00siferdev-py/project-nova/releases)** and pick the latest beta (e.g. `v0.2.0-beta.3`).
2. Download **`Nova_*_x64-setup.exe`**.
3. Run the installer. If **SmartScreen** warns (unsigned beta): **More info → Run anyway**.
4. Open **Nova** from the Start Menu and complete the **setup wizard**.

The installer will:

- Install Nova (you can change the install folder — pick a USB drive for portable-style layout)
- Download or embed **WebView2** if missing
- Add **Start Menu** shortcuts:
  - **Nova** — normal desktop use (data in `%LOCALAPPDATA%\Nova\Nova\data\`)
  - **Start Nova (Portable)** — keeps `data\` next to `nova.exe` (USB-friendly)
- Write `README.txt` in the install folder

### Build from source (optional)

Maintainers and developers: **[docs/BUILD-CI.md](./BUILD-CI.md)** (GitHub Actions) or install Node, Rust, and [NSIS](https://nsis.sourceforge.io/), then:

```bat
npm install
npm run build:windows-installer
```

See **[docs/PUBLISH.md](./PUBLISH.md)** to publish builds for users.

---

## Option B — Portable folder (no installer)

From **Releases**, download **`NovaPortable.zip`**, or build locally (below).

```bat
npm run package:portable
```

Creates `dist\NovaPortable\` with `nova.exe`, `Start-Nova-Portable.bat`, and `README.txt`. Copy that folder to a USB drive.

**Always run `Start-Nova-Portable.bat`** (not `nova.exe` alone) so chats stay on the stick.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `python` / `python3` not found | Use current `main` — `build:windows-installer` no longer needs Python. Run `git pull` then `npm install`. |
| `npm run tauri build` but no `bundle\` folder | Install **NSIS** and re-run. Check the log for `bundling` / `error`. |
| App won't start | Install [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) |
| SmartScreen warning | Unsigned beta build → **More info → Run anyway** |
| Data not on USB | Use **Start Nova (Portable).bat**, not `nova.exe` only |
| Reset setup wizard | Settings → General → **Show setup wizard again** (if enabled) or delete `onboarding_completed` from `settings.json` |

---

## Data locations

| How you start Nova | Data folder |
|--------------------|-------------|
| Start Menu **Nova** | `%LOCALAPPDATA%\Nova\Nova\data\` |
| **Start Nova (Portable).bat** | `<install folder>\data\` |

Use **Settings → General → Reveal data folder** to confirm.
