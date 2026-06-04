# Signing and Updates

Persistent Sage uses two separate trust mechanisms:

- **Tauri updater signatures** verify that an in-app update package was produced by the project maintainer.
- **Windows code signing** reduces operating-system warnings and identifies the publisher to Windows.

The updater signature is already configured for beta builds. Windows code signing is not yet active.

## Current Beta Status

Persistent Sage beta installers may still show Windows SmartScreen or unknown-publisher warnings. This is expected until the project has Windows code signing.

Only download installers from the official release page:

https://github.com/g00siferdev-py/persistent-sage/releases

## In-App Updates (direct download only)

The Tauri updater applies to **GitHub Releases installs** (NSIS installer and portable zip). It checks:

```text
https://github.com/g00siferdev-py/persistent-sage/releases/latest/download/latest.json
```

**Microsoft Store installs do not use this path.** Store builds omit the Tauri updater plugin and Settings → General → Updates directs users to the Microsoft Store (**Library → Get updates**). Submit new `.msix` packages through Partner Center to ship Store updates.

For GitHub `latest.json` to work, beta releases must be published as normal GitHub releases, not GitHub prereleases. The version number and release notes still identify the build as beta, for example `0.2.0-beta.8`.

Each updater-enabled release must include:

- `latest.json`
- `Persistent.Sage_<version>_x64-setup.exe`
- `Persistent.Sage_<version>_x64-setup.exe.sig`

## SignPath Readiness

Persistent Sage is preparing for SignPath Foundation / SignPath.io compatibility. Future official Windows builds may be signed through SignPath Foundation / SignPath.io if the project is accepted.

Current readiness items:

- Public repository: `g00siferdev-py/persistent-sage`
- Open-source license: MIT
- Public release process: GitHub Actions
- Public privacy policy: `PRIVACY.md`
- Security policy: `SECURITY.md`
- Reproducible build path: `.github/workflows/build-windows.yml`
- Public release notes and installer assets: GitHub Releases

Do not claim a build is SignPath-signed until the release artifact is actually signed and the release notes identify it as such.

## Microsoft Store

Store distribution uses MSIX packages built on `main` (see [MICROSOFT-STORE.md](./MICROSOFT-STORE.md)). Store users update through Partner Center submissions—not the GitHub Tauri updater. GitHub Releases remain the update path for direct-download (NSIS/portable) installs.
