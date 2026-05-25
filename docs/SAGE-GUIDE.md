# Persistent Sage Guide for Sage

This file is installed into the Persistent Sage workspace as `guide.md`. It is written for Sage, the shipped default companion and support bot, so he can answer user questions about the application accurately. Persistent Sage is the platform; Sage is one possible companion profile inside it.

## Product Overview

Persistent Sage is a local-first desktop AI companion built with Tauri 2, React, Vite, TypeScript, Rust, and SQLite. The app provides multi-thread chat, long-term Memory Anchors, optional agent tools, customizable companion personalities, Pulse check-ins, image attachments for compatible vision models, Windows installer builds, and portable USB-friendly packaging.

Persistent Sage is not a cloud service. Conversations, settings, personality profiles, attachments, and memory live on the user's machine unless the user explicitly chooses a cloud LLM provider. API traffic goes to the configured provider only when the user chats, extracts memory, embeds memory, or uses model-backed features.

## Sage's Support Role

Sage is both the default companion and the support bot for Persistent Sage. Other companions can exist in the same platform with their own profiles and memories. When users ask how the application works, Sage should help them by consulting this guide, explaining concepts plainly, and giving concrete steps.

Sage should:

- Be helpful, friendly, caring, and intelligent.
- Treat the user as a person, not a ticket.
- Explain risks and privacy tradeoffs clearly.
- Ask for OS, app version, provider, model, and exact error text when troubleshooting.
- Avoid pretending to know secrets, credentials, or file contents he cannot access.
- Use workspace tools only when enabled by the user.
- Offer safe steps before destructive actions.

## Major Concepts

### Chat Threads

Chats are stored as conversations in SQLite. Each thread has messages, title metadata, timestamps, and optional image attachment references. The sidebar lists threads for the active companion profile. If the sidebar list is cleared from view, the database is not deleted; the user can restore the visible list.

### Memory Anchors

Memory Anchors are compact long-term memory entries. They are separate from raw chat history and are used for recall. Anchors may represent durable facts, preferences, insights, or curated notes. Persistent Sage can retrieve anchors for briefings and for model tool calls.

Memory behavior:

- User and assistant messages are saved to SQLite.
- Optional LLM memory extraction can create durable anchors after user messages.
- Semantic recall can embed anchors in the background.
- `memory_search` lets capable models search long-term memory during chat.
- Users can wipe memories from Settings.

### Companion Personalities

The active companion profile supplies the system persona for chat. The default profile is Sage. Personality data lives in `personality.json` in the app data directory. Each profile has:

- profile name
- companion name
- core personality
- tone of voice
- background and role
- core values
- relationship style
- special instructions
- optional avatar description

If personality tools are enabled, the model can read or update the active personality profile. Sage may edit his personality only when the user requests it, permits it, or when it is clearly appropriate and transparent.

### Providers

Persistent Sage supports several provider backends:

- Placeholder: offline demo model; no real API calls.
- OpenAI: OpenAI Chat Completions compatible models.
- Anthropic: Claude Messages API.
- Ollama Local: local Ollama daemon at `http://127.0.0.1:11434` by default.
- Ollama Cloud: hosted Ollama models.
- Google Gemini: Google Generative Language API.
- xAI Grok: OpenAI-compatible xAI API.

The selected provider and model are stored in `settings.json`. API keys are encrypted at rest and are never stored in the git repository.

### Thinking Effort

The chat window includes a compact Thinking control with Low, Medium, and High. It is stored in settings and sent to providers that support reasoning or thinking controls:

- xAI/OpenAI-compatible reasoning models may receive `reasoning_effort`.
- Gemini may receive a thinking budget through generation config.
- Providers or models that do not support thinking may ignore it or reject unsupported parameters. If a model errors after changing thinking, advise the user to switch back to Medium or choose a model known to support thinking.

### Tools

Tools are optional and controlled in Settings:

- Web Search: lightweight HTTP/search helpers.
- Browser Fetch: headless Chrome/Chromium/Edge for JavaScript-heavy pages.
- Workspace tools: read/write/list files under the app workspace only.
- Database Query: controlled SQLite query tool for workspace or app data databases.
- Personality tools: read/update the active personality profile.
- Memory Search: recall Memory Anchors and related messages.

Tool access should be treated as powerful. Users must enable tools intentionally. Sage should explain what a tool will do before using it for sensitive operations.

## Data Locations

Persistent Sage stores data locally.

Default Windows desktop install:

```text
%LOCALAPPDATA%\Persistent Sage\Persistent Sage\data\
```

Portable mode:

```text
<install folder>\data\
```

Linux examples:

```text
~/.local/share/persistent-sage/data/
```

Important files:

- `nova_memory.sqlite`: conversations, messages, Memory Anchors, projects, preferences.
- `settings.json`: provider/model/settings and encrypted API key blobs.
- `.nova_crypto/ikm`: input keying material for settings encryption.
- `personality.json`: companion profiles.
- `workspace/`: sandboxed workspace files and this `guide.md`.
- `attachments/`: local image attachments.

The SQLite database is local but not encrypted. API keys are encrypted at rest.

## Environment Variables

Preferred current variables:

- `PERSISTENT_SAGE_DATA_DIR`: pin all app data to a specific directory.
- `PERSISTENT_SAGE_PORTABLE=1`: use `data/` next to the executable.
- `PERSISTENT_SAGE_CHROME_PATH`: path to Chrome/Chromium/Edge for Browser Fetch.
- `PERSISTENT_SAGE_CHROME_NO_SANDBOX=1`: useful in containers.
- `PERSISTENT_SAGE_CHROME_IGNORE_CERT_ERRORS=1`: development only.

Legacy variables still work:

- `NOVA_DATA_DIR`
- `NOVA_PORTABLE`
- `NOVA_CHROME_PATH`
- `NOVA_CHROME_NO_SANDBOX`
- `NOVA_CHROME_IGNORE_CERT_ERRORS`

## First-Run Setup

Fresh installs show an onboarding wizard. It helps the user:

1. Understand desktop vs portable data storage.
2. Pick an AI provider.
3. Save an API key if the provider requires one.
4. Open the app.

The wizard can be rerun from Settings.

If API keys do not work:

- Confirm the provider selected in Settings matches the saved key.
- Re-paste the key and save again.
- Check that the key belongs to the right service.
- Confirm the selected model is available to that account.
- For local Ollama, confirm Ollama is running and the model is pulled.

## Provider Troubleshooting

### Placeholder

The placeholder is offline and useful only for testing UI. It does not call a real model.

### OpenAI

Common fields:

- Base URL: `https://api.openai.com/v1`
- API key: OpenAI API key.
- Model examples: `gpt-4o`, `gpt-4o-mini`, `o3-mini`.

If it fails:

- Check API key.
- Check billing/access.
- Try `gpt-4o-mini`.
- Refresh models.

### Anthropic

Common fields:

- API key: Anthropic key.
- Model examples: Claude Sonnet/Haiku/Opus IDs.

If it fails:

- Confirm the model ID exists and is accessible.
- Refresh models.
- Check rate limits.

### Ollama Local

Default base URL:

```text
http://127.0.0.1:11434
```

Useful commands outside the app:

```bash
ollama list
ollama pull llama3.2
ollama serve
```

If it fails:

- Confirm Ollama is running.
- Confirm the model is installed.
- Check firewall/local port.

### Ollama Cloud

Requires an Ollama API key. Models may use names like `gpt-oss:120b-cloud` or `kimi-k2.5:cloud`.

### Google Gemini

Default base URL:

```text
https://generativelanguage.googleapis.com/v1beta
```

Common model examples:

- `gemini-2.5-flash`
- `gemini-2.5-pro`
- `gemini-2.0-flash`

If it fails:

- Confirm the key is from Google AI Studio or the expected Google API project.
- Confirm the Generative Language API is available for the account.
- Try `gemini-2.5-flash`.
- Refresh models.

### xAI Grok

Default base URL:

```text
https://api.x.ai/v1
```

Common model examples:

- `grok-4-fast-reasoning`
- `grok-4-fast-non-reasoning`
- `grok-3`
- `grok-3-mini`

xAI uses an OpenAI-compatible chat API path. If it fails:

- Confirm the xAI API key.
- Refresh models.
- Try a known Grok model.
- Reduce Thinking to Medium or Low if a model rejects reasoning settings.

## Windows Installer and Portable Builds

Windows users should download from GitHub Releases.

Installer:

- `Persistent Sage_*_x64-setup.exe`
- Adds Start Menu shortcuts.
- Stores data in AppData by default.
- May show SmartScreen because beta builds are unsigned.

Portable:

- `PersistentSagePortable.zip`
- Unzip and run `Start-Persistent-Sage-Portable.bat`.
- Do not run the raw executable directly if the user wants data on the USB drive.

## GitHub Releases and Updates

Beta builds are published through GitHub Releases. GitHub Actions builds the Windows NSIS installer and portable zip. Manual workflow artifacts expire and are not the public download page; Releases are the correct distribution channel.

For maintainers:

1. Bump versions.
2. Update changelog/release notes.
3. Push main.
4. Tag `vX.Y.Z`.
5. Let GitHub Actions build.
6. Publish the draft prerelease.

Persistent Sage can use the Tauri updater once a release includes `latest.json` and signed updater artifacts. This is separate from Windows Authenticode signing: updater signatures verify the package came from the maintainer, while Windows SmartScreen trust still requires future code signing.

## Privacy Notes

Sage should be clear:

- Persistent Sage stores chats locally.
- API keys are encrypted.
- The SQLite database is not encrypted.
- Cloud providers receive prompts, images, and relevant context when selected.
- Workspace and database tools can expose local files or data if enabled.
- Users should not paste secrets unless necessary.

## Common User Questions

### "Where are my chats?"

They are in `nova_memory.sqlite` under the app data directory. Use Settings → General → Reveal data folder.

### "Can I move to USB?"

Yes. Use the portable build or set `PERSISTENT_SAGE_PORTABLE=1`. Copy the `data/` folder carefully while the app is closed.

### "Can I reset everything?"

Settings includes memory wipe and factory reset. Warn the user before destructive actions. Back up `nova_memory.sqlite`, `settings.json`, and `personality.json` first if they may want to restore.

### "Why does Windows warn me?"

The beta installer is unsigned. SmartScreen may warn. The user can click More info → Run anyway. Code signing may be added later.

### "Why is Sage not remembering?"

Check:

- Memory extraction enabled.
- Semantic memory enabled if desired.
- Provider is real, not placeholder.
- Re-index memory embeddings after model/provider changes.
- The active companion profile matches the chat.

### "Why is the model not using tools?"

Check:

- Tools enabled in Settings.
- Provider supports tools.
- Model supports tools.
- No image attachment with a provider/model combination that disables tools for that turn.
- Workspace/database/personality sub-tools enabled as needed.

### "Why are API keys missing after reinstall?"

Keys are per-machine and stored under the app data directory. A fresh install or new data directory needs keys re-entered.

## Support Response Pattern

When helping a user troubleshoot, ask for:

1. OS and version.
2. Persistent Sage version.
3. Provider and model.
4. Whether it is installer or portable.
5. The exact error text.
6. Whether the issue happens in a new chat.
7. Whether Settings → General → Reveal data folder shows the expected location.

Give step-by-step fixes. Avoid asking users to delete data unless a backup is recommended first.
