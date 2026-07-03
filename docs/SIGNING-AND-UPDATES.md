# Signing and Updates

Persistent Sage uses two separate trust mechanisms:

- **Tauri updater signatures** verify that an in-app update package was produced by the project maintainer (GitHub Releases installs only).
- **Windows code signing** reduces operating-system warnings and identifies the publisher to Windows (direct-download NSIS installers).

The updater signature is configured for GitHub Releases builds. Windows Authenticode signing for NSIS installers is not yet active. **Microsoft Store MSIX** packages are signed through Partner Center certification.

## Current status

| Install type | Updates | Signing notes |
|--------------|---------|---------------|
| **Microsoft Store** | Store → Library → Get updates | Microsoft handles Store distribution signing |
| **GitHub NSIS / portable** | Settings → General → Updates (Tauri updater) | May show SmartScreen until Authenticode signing is available |

Only download installers from official sources:

- GitHub Releases: https://github.com/g00siferdev-py/persistent-sage/releases  
- Microsoft Store listing (when published)

## In-App Updates (GitHub installs only)

The Tauri updater applies to **GitHub Releases installs** (NSIS installer and portable zip). It checks:

```text
https://github.com/g00siferdev-py/persistent-sage/releases/latest/download/latest.json
```

**Microsoft Store installs do not use this path.** Store builds omit the Tauri updater plugin and Settings → General → Updates directs users to the Microsoft Store (**Library → Get updates**). Submit new `.msix` packages through Partner Center to ship Store updates.

For GitHub `latest.json` to work, releases must be published as **normal** GitHub releases, not GitHub prereleases.

Each updater-enabled release must include:

- `latest.json`
- `Persistent.Sage_<version>_x64-setup.exe`
- `Persistent.Sage_<version>_x64-setup.exe.sig`

## SignPath Readiness

Persistent Sage is preparing for SignPath Foundation / SignPath.io compatibility. Future official Windows **direct-download** builds may be signed through SignPath Foundation / SignPath.io if the project is accepted.

Current readiness items:

- Public repository: `g00siferdev-py/persistent-sage`
- Open-source license: MIT
- Public release process: GitHub Actions
- Public privacy policy: `PRIVACY.md`
- Security policy: `SECURITY.md`
- Reproducible build path: `.github/workflows/build-windows.yml`
- Public release notes and installer assets: GitHub Releases

Do not claim a build is SignPath-signed until the release artifact is actually signed and the release notes identify it as such.
