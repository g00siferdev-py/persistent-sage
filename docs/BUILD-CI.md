# Building Persistent Sage with GitHub Actions

Use GitHub Actions when a local machine cannot complete a Windows build (low RAM, missing NSIS, etc.). The workflow runs on a **windows-latest** runner with ~7 GB RAM and the Visual Studio toolchain preinstalled.

## One-time repo setup

1. Push this repository to GitHub.
2. Open **Settings → Actions → General → Workflow permissions**.
3. Select **Read and write permissions** (needed to attach installers to Releases when you push a `v*` tag).
4. Add updater signing secrets under **Settings → Secrets and variables → Actions**:
   - `TAURI_SIGNING_PRIVATE_KEY`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (blank is okay for the current beta key)
5. Save.

## Run a build (no tag)

1. On GitHub, open **Actions**.
2. Choose **Build Windows** in the left sidebar.
3. Click **Run workflow**, pick the branch (usually `main`), then **Run workflow**.
4. When the job finishes (often 15–30 minutes the first time), open the run → **Artifacts** → download `persistent-sage-windows-<sha>`.

The zip contains:

| File | Use |
|------|-----|
| `Persistent.Sage_*_x64-setup.exe` | Normal Windows install |
| `Persistent.Sage_*_x64-setup.exe.sig` | Tauri updater signature |
| `PersistentSagePortable.zip` | Unzip to USB; run `Start-Persistent-Sage-Portable.bat` |
| `latest.json` | Tauri updater manifest for tag releases |
| `persistent-sage.exe` | Raw binary (optional) |

## Release build (tag)

Create and push a version tag matching `package.json` / `tauri.conf.json`:

```bash
git tag v0.2.0-beta.7
git push origin v0.2.0-beta.7
```

Use the next current version.

The same workflow runs, uploads artifacts, signs the NSIS installer for Tauri updater verification, generates `latest.json`, and creates a **draft release** on GitHub with the installer, signature, updater manifest, and portable zip attached. Publish the draft from **Releases** when ready.

Updater-enabled beta releases should not be marked as GitHub prereleases. GitHub's `releases/latest` endpoint excludes prereleases, and the app uses that endpoint for `latest.json`.

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
| Updater `.sig` missing | Confirm `TAURI_SIGNING_PRIVATE_KEY` is set in GitHub Actions secrets |
| Updater says it cannot fetch valid release JSON | Confirm the release is published, includes `latest.json`, and is not marked as a GitHub prerelease |
| MSI error about pre-release / `65535` | MSI is excluded from bundle targets (WiX rejects `beta.3`). CI runs `tauri build -- --bundles nsis`. Pull latest `main` and re-run. |
| Release not created | Only **tag** pushes (`v*`) create a Release; manual runs only upload Artifacts |

For installing on a test PC after download, see **[INSTALL-WINDOWS.md](./INSTALL-WINDOWS.md)**.

To ship builds to users, see **[PUBLISH.md](./PUBLISH.md)**.
