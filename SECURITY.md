# Security Policy

## Supported Versions

Security fixes are applied to the **latest published release** (currently **3.0.0 beta** on GitHub; **2.0.0** remains GitHub “Latest” until Store GA).

| Version | Supported |
|---------|-----------|
| **3.0.x** (beta / latest dev) | Yes |
| **2.1.x** | Best effort |
| **2.0.x** | Best effort |
| Older releases | Not supported |

Report issues against the version you are running. Upgrading to the latest release is recommended.

---

## Reporting a Vulnerability

Please report security concerns privately when possible. If GitHub private vulnerability reporting is enabled for this repository, use that channel. Otherwise, open a GitHub Issue with minimal sensitive detail and request maintainer contact for private follow-up.

Repository: https://github.com/g00siferdev-py/persistent-sage

---

## Current Security Notes

- The local SQLite chat and memory database is **not encrypted** by the app.
- API keys and GitHub PATs are encrypted at rest, but are decrypted in process memory when used.
- Agent tools are opt-in and can contact external websites or local files depending on settings.
- **Microsoft Store** installs are distributed as MSIX (Microsoft re-signs during certification).
- **Direct-download** Windows installers may trigger SmartScreen warnings until Windows code signing is available.
- In-app updates (GitHub installs) are verified with Tauri updater signatures before installation.
- Optional donation links open **external** PayPal/Cash App pages in your browser; no payment data is collected inside the app.

---

## Code Signing

Persistent Sage is preparing for Windows code signing for direct-download installers. Future official Windows builds may be signed through SignPath Foundation / SignPath.io if the project is accepted. Release notes will identify when a build is code signed.

**Microsoft Store:** MSIX packages are submitted through Partner Center; Microsoft handles Store distribution signing.

**Direct download:** Verify installers from the official sources:

- GitHub Releases: https://github.com/g00siferdev-py/persistent-sage/releases  
- Microsoft Store listing (when published)
