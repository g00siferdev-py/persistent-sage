# Building Nova with GitHub Actions

Use GitHub Actions when a local machine cannot complete a Windows build (low RAM, missing NSIS, etc.). The workflow runs on a **windows-latest** runner with ~7 GB RAM and the Visual Studio toolchain preinstalled.

## One-time repo setup

1. Push this repository to GitHub.
2. Open **Settings → Actions → General → Workflow permissions**.
3. Select **Read and write permissions** (needed to attach installers to Releases when you push a `v*` tag).
4. Save.

## Run a build (no tag)

1. On GitHub, open **Actions**.
2. Choose **Build Windows** in the left sidebar.
3. Click **Run workflow**, pick the branch (usually `main`), then **Run workflow**.
4. When the job finishes (often 15–30 minutes the first time), open the run → **Artifacts** → download `nova-windows-<sha>`.

The zip contains:

| File | Use |
|------|-----|
| `Nova_*_x64-setup.exe` | Normal Windows install |
| `NovaPortable.zip` | Unzip to USB; run `Start-Nova-Portable.bat` |
| `nova.exe` | Raw binary (optional) |

## Release build (tag)

Create and push a version tag matching `package.json` / `tauri.conf.json`:

```bash
git tag v0.2.0-beta.3
git push origin v0.2.0-beta.3
```

The same workflow runs, uploads artifacts, and creates a **draft prerelease** on GitHub with the installer and portable zip attached. Publish the draft from **Releases** when ready.

## Local vs CI

| | Local Windows PC | GitHub Actions |
|--|------------------|----------------|
| RAM | You manage page file / `CARGO_BUILD_JOBS=1` | Runner handles it |
| NSIS | Must install manually | Bundled via Tauri on `windows-latest` |
| Output | `src-tauri\target\release\bundle\nsis\` | Download artifact or Release |
| Cost | Free | Free tier minutes on public repos |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Workflow not listed | Push `.github/workflows/build-windows.yml` to the default branch |
| `Resource not accessible by integration` | Enable **Read and write** workflow permissions (above) |
| Artifact missing `*-setup.exe` | Open the failed job log; search for `nsis` / `bundling` errors |
| MSI error about pre-release / `65535` | Windows CI builds **NSIS only** (`tauri.windows.conf.json`). Versions like `0.2.0-beta.3` are not valid for MSI/WiX. |
| Release not created | Only **tag** pushes (`v*`) create a Release; manual runs only upload Artifacts |

For installing on a test PC after download, see **[INSTALL-WINDOWS.md](./INSTALL-WINDOWS.md)**.
