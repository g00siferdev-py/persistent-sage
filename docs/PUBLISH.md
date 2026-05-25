# Publishing Persistent Sage for beta testers

How to ship a **Windows installer** to users without asking them to compile from source.

## What users can download today

| Channel | Public? | Good for users? |
|---------|---------|-----------------|
| **GitHub Releases** (published) | **Yes** — anyone with the link | **Yes** — use this |
| **Actions → Artifacts** | Public repo: yes, but hidden and **expires in 30 days** | Maintainers / smoke tests only |
| **Clone + build from source** | Yes (public repo) | Developers only |

**Artifacts from a manual workflow run are not a product download page.** Publish a **Release** when you want testers to install Persistent Sage.

---

## Recommended: publish a GitHub Release

### Option A — Tag + CI (automated draft)

1. Confirm version in `package.json` and `src-tauri/tauri.conf.json` (e.g. `0.2.0-beta.4`).
2. Update **[CHANGELOG.md](../CHANGELOG.md)** for that version.
3. Commit and push `main`.
4. Create and push a tag (must start with `v`):

   ```bash
   git tag v0.2.0-beta.4
   git push origin v0.2.0-beta.4
   ```

5. Wait for **Actions → Build Windows** to finish (triggered by the tag).
6. Open **Releases** — you should see a **draft prerelease** with:
   - `Persistent Sage_*_x64-setup.exe`
   - `Persistent Sage_*_x64-setup.exe.sig`
   - `PersistentSagePortable.zip`
   - `latest.json` (Tauri updater manifest)
7. Edit the release notes (copy from CHANGELOG), then click **Publish release**.

**Share with testers:**

```text
https://github.com/g00siferdev-py/persistent-sage/releases/latest
```

On a prerelease, use the specific tag URL until you promote a non-prerelease “latest”.

**Repo settings (once):** **Settings → Actions → General → Workflow permissions → Read and write permissions** (so the workflow can attach files to the Release).

---

### Option B — Manual upload (no tag / you already have a green CI run)

1. Download **Artifacts** from a successful **Build Windows** run.
2. **Releases → Draft a new release**
3. **Choose a tag:** create `v0.2.0-beta.4` on `main`.
4. Title: `Persistent Sage 0.2.0-beta.4`
5. Check **Set as a pre-release**
6. Attach:
   - `Persistent Sage_*_x64-setup.exe`
   - `Persistent Sage_*_x64-setup.exe.sig`
   - `PersistentSagePortable.zip` (optional, for USB testers)
   - `latest.json` (required for in-app updates)
7. Paste release notes from CHANGELOG → **Publish release**.

---

## What to tell Windows users

Send them:

1. **Releases** link (above)
2. Download **`Persistent Sage_*_x64-setup.exe`**
3. Run installer (SmartScreen: **More info → Run anyway** if unsigned)
4. Open Persistent Sage from Start Menu; complete the **setup wizard**
5. **[INSTALL-WINDOWS.md](./INSTALL-WINDOWS.md)** for portable USB and troubleshooting
6. **[USER-GUIDE.md](./USER-GUIDE.md)** for daily use
7. Issues: https://github.com/g00siferdev-py/persistent-sage/issues

**USB / portable:** download `PersistentSagePortable.zip`, unzip, run **`Start-Persistent-Sage-Portable.bat`** (not `persistent-sage.exe` alone).

---

## README and docs checklist

After publishing:

- [ ] **[README.md](../README.md)** — beta section links to Releases (not only source build)
- [ ] **Release notes** — match CHANGELOG for that version
- [ ] **Issue template / beta callout** — ask for OS, Persistent Sage version, provider

---

## Future releases

1. Bump version in `package.json`, `src-tauri/tauri.conf.json`, `Cargo.toml` / lock if needed.
2. CHANGELOG entry.
3. Push `main`, then tag `v0.2.0-beta.4` (or next version).
4. Publish the draft Release when CI completes.

To rebuild without a new tag: **Actions → Build Windows → Run workflow**, download artifact, attach to a **new** Release or replace assets on an unpublished draft (avoid replacing files on a release users already downloaded without noting it in release notes).

---

## In-app updater

Persistent Sage uses the Tauri updater. This is separate from Windows code signing: update artifacts are verified with a Tauri updater key, while SmartScreen warnings still require a future Windows signing certificate.

One-time maintainer setup:

1. Keep the generated private key file secret: `persistent-sage-updater.key` (ignored by git).
2. In GitHub repo settings, add these Actions secrets:
   - `TAURI_SIGNING_PRIVATE_KEY` — contents of `persistent-sage-updater.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — blank is okay for the current no-password beta key
3. Confirm the public key in `src-tauri/tauri.conf.json` matches the key pair.

On every tag build, CI signs the NSIS installer, generates `dist/latest.json`, and attaches both to the GitHub Release. Published releases make this endpoint available to installed apps:

```text
https://github.com/g00siferdev-py/persistent-sage/releases/latest/download/latest.json
```

Users can then run **Settings → General → Updates → Check for updates**.

---

## Not covered yet

- **macOS / Linux** pre-built installers (no CI workflow yet — source build only)
- **Code signing** (SmartScreen warnings on Windows until you sign the exe)
