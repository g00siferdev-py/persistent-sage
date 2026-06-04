# Microsoft Store MSIX Packaging

Persistent Sage's EXE/MSI Store submission was rejected because the installer and all contained PE files must be Authenticode signed by a certificate that chains to the Microsoft Trusted Root Program.

The preferred no-certificate path is MSIX. Microsoft re-signs Store-submitted MSIX packages during certification.

## Store Identity

These values come from Partner Center and must match `Package.appxmanifest`.

| Field | Value |
|-------|-------|
| `Package/Identity/Name` | `g00siferDevelopmentLab.PersistentSage` |
| `Package/Identity/Publisher` | `CN=68E2BD37-83E1-49F0-9D7C-8CE0D54A4A45` |
| `Package/Properties/PublisherDisplayName` | `g00sifer Development Lab` |

MSIX requires numeric package versions. The app release `0.2.0-beta.9` maps to MSIX version `0.2.9.0`.

## Prerequisites

Run these on Windows:

```powershell
winget install OpenJS.NodeJS --source winget
winget install Rustlang.Rustup --source winget
winget install microsoft.winappcli --source winget
```

Then install project dependencies:

```powershell
npm install
```

## Build MSIX

### GitHub Actions (recommended)

Use this path when a local Windows machine does not have enough RAM to build the app.

**Branch policy:** develop and release on `main` only. The `store-msix` branch is an automatic mirror of `main` (see `.github/workflows/sync-store-msix.yml`) so Store and GitHub-release builds always share the same commit.

1. Push to `main` (merge your PR, or push a patch branch into `main`).
2. **Build MSIX** runs on that push; **Sync store-msix branch** updates `store-msix` to the same commit.
3. Download the `persistent-sage-msix-<sha>` artifact when the workflow completes.
4. Upload `PersistentSage_0.2.9.0_x64.msix` to Partner Center.

You can also start a build manually from **Actions → Build MSIX → Run workflow** (uses the selected branch; prefer `main`).

### Local Windows build

From the repository root on `main` (or `store-msix` after sync — same tree):

```powershell
npm run msix:pack
```

The script:

1. Builds the React frontend.
2. Builds the Tauri backend without NSIS bundling.
3. Copies Store/MSIX assets from `src-tauri/icons/` into `Assets/`.
4. Stages `persistent-sage.exe` in `msix-dist/`.
5. Runs `winapp pack ./msix-dist` with an explicit MSIX output filename.

The generated `PersistentSage_0.2.9.0_x64.msix` should appear in the repository root.

## Local Test Install

For local testing, MSIX packages need a trusted development certificate.

```powershell
winapp cert generate --if-exists skip
winapp cert install .\devcert.pfx
npm run msix:pack
Add-AppxPackage .\PersistentSage_0.2.9.0_x64.msix
```

## Submit to Microsoft Store

Upload the generated `.msix` package in Partner Center instead of using the EXE/MSI package URL.

Keep the Store listing:

- Free open beta.
- Category: Productivity.
- Secondary category: Utilities & tools.
- Generative AI declaration: yes.
- Privacy URL: `https://github.com/g00siferdev-py/persistent-sage/blob/main/PRIVACY.md`.
- Support URL: `https://github.com/g00siferdev-py/persistent-sage/issues`.

## Microsoft Store updates

Store users receive updates **only through the Microsoft Store** (Partner Center submission → certification → Store rollout). Persistent Sage does **not** install Store updates from GitHub.

| Install source | How to update |
|----------------|---------------|
| **Microsoft Store** | Store app → **Library** → **Get updates** (or use **Open Microsoft Store updates** in Settings → General) |
| **GitHub NSIS / portable** | Settings → General → **Check for updates** (Tauri updater) or download from [Releases](https://github.com/g00siferdev-py/persistent-sage/releases) |

MSIX builds use `npm run msix:pack` with `tauri.store.conf.json` and the `store` Cargo feature so the GitHub updater is not bundled.

## Notes

- The normal GitHub Releases workflow still builds NSIS installers for non-Store beta users.
- Do not submit unsigned EXE/MSI packages to the Store unless code signing is added.
- If MSIX certification reports `runFullTrust` concerns, explain that Persistent Sage is a Tauri desktop application that runs as a full-trust packaged Win32 app and stores data locally.
