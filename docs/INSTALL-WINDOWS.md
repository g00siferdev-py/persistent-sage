# Installing Nova on Windows (beta)

Two supported ways to run Nova: **desktop install** (recommended) and **portable** (USB / flash drive).

---

## Option A — Windows installer (recommended for beta testers)

### Prerequisites on the build machine

1. [Node.js LTS](https://nodejs.org/)
2. [Rust](https://rustup.rs/)
3. [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/) (Visual Studio Build Tools with **Desktop development with C++**)
4. **[NSIS 3](https://nsis.sourceforge.io/Download)** — required for `*-setup.exe`. Add `makensis` to your PATH.

### Build the installer

From the repository root:

```bat
npm install
npm run build:windows-installer
```

Installer banner images (`packaging\windows\*.bmp`) are already in the repo. Regenerate only after changing logos:

```bat
npm run branding:nsis
```

Output (when bundling succeeds):

```text
src-tauri\target\release\bundle\nsis\Nova_*_x64-setup.exe
```

The installer will:

- Install Nova (you can change the install folder — pick a USB drive for portable-style layout)
- Download or embed **WebView2** if missing
- Add **Start Menu** shortcuts:
  - **Nova** — normal desktop use (data in `%LOCALAPPDATA%\Nova\Nova\data\`)
  - **Start Nova (Portable)** — keeps `data\` next to `nova.exe` (USB-friendly)
- Write `README.txt` in the install folder

### First launch

Open **Nova** from the Start Menu. A short **setup wizard** helps you pick a provider and API key.

---

## Option B — Portable folder (no installer)

After `npm run tauri build`:

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
