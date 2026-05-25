# Signing and Updates

Persistent Sage uses two separate trust mechanisms:

- **Tauri updater signatures** verify that an in-app update package was produced by the project maintainer.
- **Windows code signing** reduces operating-system warnings and identifies the publisher to Windows.

The updater signature is already configured for beta builds. Windows code signing is not yet active.

## Current Beta Status

Persistent Sage beta installers may still show Windows SmartScreen or unknown-publisher warnings. This is expected until the project has Windows code signing.

Only download installers from the official release page:

https://github.com/g00siferdev-py/persistent-sage/releases

## In-App Updates

The Tauri updater checks this public metadata endpoint:

```text
https://github.com/g00siferdev-py/persistent-sage/releases/latest/download/latest.json
```

For that endpoint to work, beta releases must be published as normal GitHub releases, not GitHub prereleases. The version number and release notes still identify the build as beta, for example `0.2.0-beta.7`.

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

## Microsoft Store Later

The no-cost open beta path is GitHub Releases for downloads, Tauri updater for patches, and GitHub Issues for feedback.

Microsoft Store distribution is a later milestone because it can require:

- A Microsoft Partner Center developer account.
- Store listing assets, screenshots, category, age rating, support, and privacy URLs.
- Certification review.
- A Store-appropriate installer/package strategy.
- For Tauri's official EXE/MSI Store path, an offline WebView2 installer mode, hosted installer URL, auto-update support, and code signing.

If Persistent Sage pursues Microsoft Store distribution later, start with the official Tauri EXE/MSI Store guidance before adding community MSIX tooling.
