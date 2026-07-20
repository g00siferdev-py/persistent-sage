# Publishing Persistent Sage

How to ship **Windows installers** and **Microsoft Store MSIX** packages to users without asking them to compile from source.

## What users can download today

| Channel | Public? | Good for users? |
|---------|---------|-----------------|
| **Microsoft Store** | Yes (when listed) | **Yes** — recommended for most Windows users |
| **GitHub Releases** (published) | **Yes** — anyone with the link | **Yes** — direct download + Tauri updater |
| **Actions → Artifacts** | Public repo: yes, but hidden and **expires in 30 days** | Maintainers / smoke tests only |
| **Clone + build from source** | Yes (public repo) | Developers only |

**Artifacts from a manual workflow run are not a product download page.** Publish a **Release** (or Store submission) when you want users to install Persistent Sage.

---

## Recommended: publish a GitHub Release

### Option A — Tag + CI (automated draft)

1. Confirm version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `Package.appxmanifest` (e.g. `3.0.0` / `3.0.0.0`).
2. Update **[CHANGELOG.md](../CHANGELOG.md)** for that version.
3. Commit and push `main`.
4. Create and push a tag (must start with `v`):

   ```bash
   git tag v3.0.0-beta.1
   git push origin v3.0.0-beta.1
   ```

5. Wait for **Actions → Build Windows** to finish (triggered by the tag).
6. Open **Releases** — you should see a **draft release** with:
   - `Persistent.Sage_*_x64-setup.exe`
   - `Persistent.Sage_*_x64-setup.exe.sig`
   - `PersistentSagePortable.zip`
   - `latest.json` (Tauri updater manifest)
7. Edit the release notes (copy from CHANGELOG), then click **Publish release**.

**Beta builds:** mark GitHub releases as **Pre-release** so `releases/latest` stays on the prior GA until Store launch. Share the direct tag URL with testers (e.g. `.../releases/tag/v3.0.0-beta.1`).

**Share with users (GA / updater):**

```text
https://github.com/g00siferdev-py/persistent-sage/releases/latest
```

The Tauri updater uses GitHub's `releases/latest` endpoint, which excludes GitHub prereleases. Publish updater-enabled releases as **normal** GitHub releases (not marked prerelease).

**Repo settings (once):** **Settings → Actions → General → Workflow permissions → Read and write permissions** (so the workflow can attach files to the Release).

---

### Option B — Manual upload (no tag / you already have a green CI run)

1. Download **Artifacts** from a successful **Build Windows** run.
2. **Releases → Draft a new release**
3. **Choose a tag:** create `v3.0.0-beta.1` (or next version) on `main`.
4. Title: `Persistent Sage 3.0.0-beta.1 (beta testers)`
5. Leave **Set as a pre-release** unchecked for updater-enabled releases.
6. Attach:
   - `Persistent.Sage_*_x64-setup.exe`
   - `Persistent.Sage_*_x64-setup.exe.sig`
   - `PersistentSagePortable.zip` (optional, for USB users)
   - `latest.json` (required for in-app updates on GitHub installs)
7. Paste release notes from CHANGELOG → **Publish release**.

---

## Microsoft Store (MSIX)

Store distribution uses a separate CI workflow and config. See **[MICROSOFT-STORE.md](./MICROSOFT-STORE.md)**.

- MSIX builds omit the Tauri updater; Store users update via Partner Center → Store rollout.
- Submit `PersistentSage_<version>_x64.msix` from **Actions → Build MSIX** artifacts.

---

## What to tell Windows users

Send them:

1. **Microsoft Store** listing (when available) **or** **Releases** link (above)
2. Download **`Persistent.Sage_*_x64-setup.exe`** (GitHub path)
3. Run installer (SmartScreen: **More info → Run anyway** if unsigned direct download)
4. Open Persistent Sage from Start Menu; complete the **setup wizard**
5. **[INSTALL-WINDOWS.md](./INSTALL-WINDOWS.md)** for portable USB and troubleshooting
6. **[USER-GUIDE.md](./USER-GUIDE.md)** for daily use
7. Issues: https://github.com/g00siferdev-py/persistent-sage/issues

**USB / portable:** download `PersistentSagePortable.zip`, unzip, run **`Start-Persistent-Sage-Portable.bat`** (not `persistent-sage.exe` alone).

For feedback, ask users to use **Settings → General → Send feedback** or the GitHub Issue templates. Feedback is public, so users should not include private chats, Memory Anchors, API keys, or sensitive personal information.

---

## README and docs checklist

After publishing:

- [ ] **[README.md](../README.md)** — install links point to Store and/or Releases
- [ ] **Release notes** — match CHANGELOG for that version
- [ ] **`docs/releases/vX.Y.Z.md`** — user-facing highlights for major releases
- [ ] **Issue templates** — ask for OS, Persistent Sage version, provider, install source, and public-safe details

---

## Future releases

1. Bump version in `package.json`, `src-tauri/tauri.conf.json`, `Cargo.toml`, `Package.appxmanifest`.
2. CHANGELOG entry.
3. Push `main`, then tag `v2.1.1` (or next version).
4. Publish the draft Release when CI completes.
5. For Store: upload new MSIX via Partner Center after **Build MSIX** succeeds.

---

## Signing keys (Tauri updater)

Updater packages are signed with the project's Tauri signing key. GitHub Actions secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — blank is okay if the key has no password

See **[SIGNING-AND-UPDATES.md](./SIGNING-AND-UPDATES.md)** for Windows Authenticode status (separate from updater signatures).
