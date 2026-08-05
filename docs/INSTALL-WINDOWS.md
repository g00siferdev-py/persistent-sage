# Installing Persistent Sage on Windows

Download the installer from the **Microsoft Store** or **[GitHub Releases](https://github.com/g00siferdev-py/persistent-sage/releases/latest)** (`Persistent.Sage_*_x64-setup.exe`). No Node or Rust required for pre-built installs.

Two supported ways to run Persistent Sage: **desktop install** (recommended) and **portable** (USB / flash drive).

---

## Option A — Windows installer (recommended)

### Install from Microsoft Store

1. Open the Microsoft Store and search for **Persistent Sage**, or use the listing URL from the project README when published.
2. Click **Get** / **Install**.
3. Open **Persistent Sage** from the Start Menu and complete the **setup wizard**.
4. Updates: **Settings → General → Updates → Check for updates** (uses Microsoft Store APIs). You can also use Store → **Library** → **Get updates**.

### Install from GitHub Releases

**Current release (3.0.0):** open **[Releases → Latest](https://github.com/g00siferdev-py/persistent-sage/releases/latest)** and download **`Persistent.Sage_*_x64-setup.exe`** or **`PersistentSagePortable.zip`**.

1. Download **`Persistent.Sage_*_x64-setup.exe`**.
2. Run the installer. If **SmartScreen** warns (unsigned direct-download build): **More info → Run anyway**.
3. Open **Persistent Sage** from the Start Menu and complete the **setup wizard**.
4. Updates: **Settings → General → Updates → Check for updates** (signed Tauri updater against GitHub Releases).

The installer will:

- Install Persistent Sage (you can change the install folder — pick a USB drive for portable-style layout)
- Download or embed **WebView2** if missing
- Add **Start Menu** shortcuts:
  - **Persistent Sage** — normal desktop use (data in `%LOCALAPPDATA%\Persistent Sage\Persistent Sage\data\` or the app data folder shown in Help)
  - **Start Persistent Sage (Portable)** — keeps `data\` next to `persistent-sage.exe` (USB-friendly)
- Write `README.txt` in the install folder

### Build from source (optional)

Maintainers and developers: **[docs/BUILD-CI.md](./BUILD-CI.md)** (GitHub Actions) or install Node, Rust, and [NSIS](https://nsis.sourceforge.io/), then:

```bat
npm install
npm run build:windows-installer
```

See **[docs/PUBLISH.md](./PUBLISH.md)** to publish builds for users and **[docs/SIGNING-AND-UPDATES.md](./SIGNING-AND-UPDATES.md)** for updater/signing status.

---

## Option B — Portable folder (no installer)

From **Releases**, download **`PersistentSagePortable.zip`**, or build locally (below).

```bat
npm run package:portable
```

Creates `dist\PersistentSagePortable\` with `persistent-sage.exe`, `Start-Persistent-Sage-Portable.bat`, and `README.txt`. Copy that folder to a USB drive.

**Always run `Start-Persistent-Sage-Portable.bat`** (not `persistent-sage.exe` alone) so chats stay on the stick.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `python` / `python3` not found | Use current `main` — `build:windows-installer` no longer needs Python. Run `git pull` then `npm install`. |
| `npm run tauri build` but no `bundle\` folder | Install **NSIS** and re-run. Check the log for `bundling` / `error`. |
| App won't start | Install [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) |
| SmartScreen warning (GitHub installer) | Unsigned direct-download build → **More info → Run anyway**. Store MSIX is Microsoft-signed. |
| Data not on USB | Use **Start Persistent Sage (Portable).bat**, not `persistent-sage.exe` only |
| Reset setup wizard | Settings → General → **Show setup wizard again** (if enabled) or delete `onboarding_completed` from `settings.json` |
| Donation links don't open | Update to 2.1.0+ (opens system browser via Tauri shell) |
| Updates button does nothing / wrong channel | Store MSIX uses Store APIs; GitHub NSIS/portable uses Tauri updater. Both use **Settings → General → Updates**. GitHub channel requires a published (non-prerelease) Release with `latest.json`. |

---

## Data locations

| How you start Persistent Sage | Data folder |
|--------------------|-------------|
| Start Menu **Persistent Sage** | `%LOCALAPPDATA%\Persistent Sage\Persistent Sage\data\` |
| **Start Persistent Sage (Portable).bat** | `<install folder>\data\` |

Use **Settings → General → Reveal data folder** to confirm.
