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

MSIX requires numeric package versions. The app release `0.2.0-beta.8` maps to MSIX version `0.2.8.0`.

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

1. Push the `store-msix` branch.
2. The **Build MSIX** workflow runs automatically after the push.
3. Download the `persistent-sage-msix-<sha>` artifact when the workflow completes.
4. Upload the generated `.msix` to Partner Center.

If the workflow is later merged into `main`, it can also be started manually from **Actions → Build MSIX → Run workflow**.

### Local Windows build

From the repository root on the `store-msix` branch:

```powershell
npm run msix:pack
```

The script:

1. Builds the React frontend.
2. Builds the Tauri backend without NSIS bundling.
3. Copies Store/MSIX assets from `src-tauri/icons/` into `Assets/`.
4. Stages `persistent-sage.exe` in `msix-dist/`.
5. Runs `winapp pack ./msix-dist`.

The generated `.msix` should appear in the repository root.

## Local Test Install

For local testing, MSIX packages need a trusted development certificate.

```powershell
winapp cert generate --if-exists skip
winapp cert install .\devcert.pfx
npm run msix:pack
Add-AppxPackage .\PersistentSage_0.2.8.0_x64.msix
```

If the generated package is not named `PersistentSage_0.2.8.0_x64.msix`, use the actual `.msix` filename printed by `winapp pack`.

## Submit to Microsoft Store

Upload the generated `.msix` package in Partner Center instead of using the EXE/MSI package URL.

Keep the Store listing:

- Free open beta.
- Category: Productivity.
- Secondary category: Utilities & tools.
- Generative AI declaration: yes.
- Privacy URL: `https://github.com/g00siferdev-py/persistent-sage/blob/main/PRIVACY.md`.
- Support URL: `https://github.com/g00siferdev-py/persistent-sage/issues`.

## Notes

- The normal GitHub Releases workflow still builds NSIS installers for non-Store beta users.
- Do not submit unsigned EXE/MSI packages to the Store unless code signing is added.
- If MSIX certification reports `runFullTrust` concerns, explain that Persistent Sage is a Tauri desktop application that runs as a full-trust packaged Win32 app and stores data locally.
