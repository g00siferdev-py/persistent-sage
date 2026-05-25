# Persistent Sage Privacy Policy

Last updated: May 25, 2026

Persistent Sage is a local-first desktop AI companion. This policy explains what the app stores, what may leave your device, and what controls you have.

## Summary

Persistent Sage does not operate a cloud service for your conversations, memories, personalities, files, or API keys. By default, app data is stored on the device where you run Persistent Sage.

If you configure a cloud LLM provider, your chat messages and enabled tool outputs are sent to that provider so it can generate responses. Those third-party providers process data under their own terms and privacy policies.

## Data Stored On Your Device

Persistent Sage may store:

- Chat conversations, messages, and Memory Anchors in a local SQLite database named `nova_memory.sqlite`.
- Companion personalities in `personality.json`.
- Settings in `settings.json`.
- API keys encrypted at rest in `settings.json`, with local key material under `.nova_crypto/`.
- Image attachments under the local `attachments/` folder.
- Optional agent workspace files under the local `workspace/` folder.

The chat and memory database is not currently encrypted by Persistent Sage. Use full-disk encryption, OS account protections, or an encrypted external volume if your threat model requires stronger local protection.

## Data That May Leave Your Device

Data may leave your device only when you configure features that require network access:

- Chat messages are sent to the selected provider, such as OpenAI, Anthropic, Google Gemini, xAI, Ollama Cloud, or another configured endpoint.
- Image attachments are sent to the selected provider when you use a vision-capable model.
- Agent web tools may contact websites or search endpoints when you enable those tools.
- In-app update checks contact GitHub Releases to retrieve signed update metadata and installer packages.
- Open beta feedback buttons open GitHub Issues in your browser. Anything you submit there is public unless GitHub project settings change later.

Local Ollama usage can remain on your device when configured to use a local Ollama server.

## API Keys

API keys are encrypted at rest by Persistent Sage and are decrypted only when needed to contact your selected provider. Persistent Sage does not send API keys to a Persistent Sage-operated server.

## User Controls

You can:

- Choose which provider to use, including local/offline options.
- Disable agent tools.
- Wipe memories or run a factory reset from Settings.
- Delete the local data directory manually after quitting the app.
- Use `PERSISTENT_SAGE_DATA_DIR` or portable mode to place data on storage you control.
- Choose whether to submit feedback publicly through GitHub Issues. Persistent Sage does not automatically attach chats, Memory Anchors, logs, or API keys to feedback reports.

## Third-Party Services

Persistent Sage may interact with third-party services you choose or enable, including AI providers, websites contacted by tools, and GitHub Releases for updates. Review those services' privacy policies before sending sensitive data.

## Open Beta Notice

Persistent Sage is open beta software. Security, privacy, and data-management features may change as the project matures. Do not store sensitive, regulated, or high-risk information in Persistent Sage unless you have reviewed the current limitations and are comfortable with the local storage model.

## Contact

Report privacy or security concerns through GitHub Issues:

https://github.com/g00siferdev-py/persistent-sage/issues

For security-sensitive reports, see `SECURITY.md`.
