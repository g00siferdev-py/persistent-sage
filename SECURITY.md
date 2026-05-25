# Security Policy

## Supported Versions

Persistent Sage is currently in open beta. Security fixes are applied to the latest published beta release.

| Version | Supported |
|---------|-----------|
| Latest beta | Yes |
| Older beta builds | Best effort |

## Reporting a Vulnerability

Please report security concerns privately when possible. If GitHub private vulnerability reporting is enabled for this repository, use that channel. Otherwise, open a GitHub Issue with minimal sensitive detail and request maintainer contact for private follow-up.

Repository:

https://github.com/g00siferdev-py/persistent-sage

## Current Security Notes

- The local SQLite chat and memory database is not encrypted by the app.
- API keys are encrypted at rest, but are decrypted in process memory when used.
- Agent tools are opt-in and can contact external websites or local files depending on settings.
- Unsigned Windows beta installers may trigger SmartScreen warnings until code signing is available.
- In-app updates are verified with Tauri updater signatures before installation.

## Code Signing

Persistent Sage is preparing for Windows code signing. Future official Windows builds may be signed through SignPath Foundation / SignPath.io if the project is accepted. Release notes will identify when a build is code signed.

Until then, verify that downloads come from the official GitHub Releases page:

https://github.com/g00siferdev-py/persistent-sage/releases
