# Persistent Sage Privacy Policy

**Last updated:** May 26, 2026

Persistent Sage is a **local-first** desktop AI companion for Windows (and other platforms when built from source). This policy explains what information the app handles, why, where it is stored, who may receive it, and what you can do about it.

We wrote this in plain language to meet common app-store requirements, including the [Microsoft Store Policies](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies) (Section 10.5 — Privacy).

---

## Summary

- Persistent Sage **does not** run a cloud service that stores your chats, memories, personalities, or API keys.
- By default, your data stays **on the device** where you run the app.
- If you turn on a **cloud AI provider** or optional **network tools**, the content you send (messages, images, tool results) goes to those services under **their** privacy policies.
- Persistent Sage **does not** sell your data, show ads, or use the Windows advertising ID for tracking.

---

## What we collect

Persistent Sage is **not** a social network or account service. We **do not** ask for your name, email address, postal address, phone number, or payment information inside the app, and we **do not** operate user accounts on a Persistent Sage server.

The app **does** store and process the following **on your device** when you use it:

| Type of information | Examples | How it is collected |
|---------------------|----------|---------------------|
| **Chat content** | Messages you type, assistant replies | You create them in the app; saved to local SQLite (`nova_memory.sqlite`) |
| **Memory data** | Memory Anchors, projects, preferences | Generated or edited through chat and memory features |
| **Companion settings** | Personality names, tone, instructions | You configure them; saved in `personality.json` |
| **App settings** | Provider choice, model names, feature toggles | You change them in Settings; saved in `settings.json` |
| **API keys** | Keys for OpenAI, Anthropic, Gemini, xAI, Ollama Cloud, etc. | You paste them in Settings; encrypted at rest (see Security) |
| **Image attachments** | Photos you attach for vision models | You choose files; saved under `attachments/` |
| **Workspace files** (optional) | Files the agent reads or writes when tools are enabled | Created or accessed only if you enable workspace tools |
| **Technical data in logs** | Error text on your machine | May appear in local terminal output; not sent to Persistent Sage |

We **do not** intentionally collect:

- Precise **location** (GPS), contacts, calendar, microphone, or camera data (except images **you** explicitly attach to a message)
- **Payment** or billing information
- **Windows advertising ID** or other advertising identifiers for ad targeting
- **Analytics or telemetry** sent to a Persistent Sage-operated server (the app does not include third-party analytics SDKs for that purpose)

---

## Why we use this information

We use the information above only to **run the app for you**:

| Purpose | What this means |
|---------|-----------------|
| **Provide the service** | Save chats, memories, and settings so you can continue conversations and use companion personalities |
| **Connect to AI providers** | Send your messages (and images, when used) to the provider **you** selected so the model can reply |
| **Optional agent tools** | When enabled, contact websites or search services you allow (for example DuckDuckGo or URLs the model requests) |
| **Software updates** | Check GitHub Releases for signed update metadata and installer files when you use in-app update checks |
| **Improve reliability** | Keep settings and encrypted keys on disk so the app works after restart |

We **do not** use your data for **advertising**, **profiling for ads**, or **selling personal information** to data brokers.

---

## What may leave your device

Data leaves your device **only** when you configure features that need the network:

| Destination | What is sent | When |
|-------------|--------------|------|
| **AI providers you choose** (OpenAI, Anthropic, Google Gemini, xAI, Ollama Cloud, or another endpoint) | Chat messages, system context, tool outputs, and image attachments for vision models | When you send a message while that provider is selected |
| **Local Ollama** | Same content, but to your own machine (`http://127.0.0.1:11434` by default) | When you select local Ollama and your server is local |
| **Websites and search** (optional tools) | Requests derived from tool use (for example search queries or page fetches) | When agent web or browser tools are enabled |
| **GitHub Releases** | Standard HTTPS requests for update manifests and installers | When you check for updates |
| **GitHub Issues** (browser) | Whatever **you** type in a public issue | Only when you open the feedback link; not automatic |

**API keys** are decrypted **on your device** only long enough to call **your** configured provider. Persistent Sage does **not** send API keys to a Persistent Sage-operated server.

---

## Sharing with third parties

| Third party | Role | Your control |
|-------------|------|--------------|
| **AI providers** | Process prompts and return completions | Choose provider in Settings; use local/offline options if you prefer |
| **Sites contacted by tools** | Respond to fetches or searches initiated by enabled tools | Disable agent tools in Settings |
| **GitHub** | Hosts open-source releases and optional public issue reports | Do not open feedback links if you do not want public posts |

We **do not** share your data with third parties for **their independent advertising**.

### Windows advertising ID

Persistent Sage **does not** access or use the **Windows advertising ID** for advertising or cross-app tracking. The app does not display third-party ads.

---

## How you can access, change, or delete your data

Because data is stored **locally**, you control it directly:

| Action | How |
|--------|-----|
| **View or edit chats and memories** | Use the in-app chat and Memory Anchor features |
| **Change provider or keys** | Settings → Provider |
| **Turn off network tools** | Settings → Tools |
| **Delete memories** | Settings → General → **Wipe all memories** |
| **Delete memories and reset settings** | Settings → General → **Factory reset** |
| **Remove everything manually** | Quit the app, then delete your data folder (Settings → General → **Reveal data folder**) |
| **Choose where data lives** | Installer default location, `PERSISTENT_SAGE_DATA_DIR`, or portable mode |

There is **no** Persistent Sage cloud account to log into for export; copy `nova_memory.sqlite` and related files if you need a backup.

If you posted information on **GitHub Issues**, manage or delete it through GitHub’s site and your GitHub account.

---

## Security

We take reasonable steps to protect data on your device:

| Measure | Detail |
|---------|--------|
| **API key encryption** | Provider API keys are stored as **AES-256-GCM** ciphertext in `settings.json`, with key material derived using **Argon2id** and files under `.nova_crypto/` |
| **HTTPS** | Network calls to providers and update servers use HTTPS where supported |
| **Local-only by default** | Chats and memories are not uploaded to a Persistent Sage backend |

**Limitations you should know:**

- The chat database (`nova_memory.sqlite`) and attachment files are **not encrypted** by Persistent Sage. Anyone with access to your user account or a copy of the data folder can read them. Use full-disk encryption (for example BitLocker) if you need stronger protection.
- Persistent Sage is **open beta** software; security features may change. See `SECURITY.md` for how to report vulnerabilities.

---

## Children

Persistent Sage is not directed at children under 13 (or the minimum age required in your region). We do not knowingly collect personal information from children through a Persistent Sage-operated service.

---

## Changes to this policy

We may update this privacy policy when the app or legal requirements change. When we do:

- We will change the **“Last updated”** date at the top of this file.
- The current version will remain at:  
  `https://github.com/g00siferdev-py/persistent-sage/blob/main/PRIVACY.md`

Continued use of Persistent Sage after an update means you accept the revised policy. For significant changes, we may also note them in release notes on GitHub.

---

## Contact

**Privacy or data questions:** open a GitHub Issue (public) or follow the process in `SECURITY.md` for sensitive security reports.

- Issues: https://github.com/g00siferdev-py/persistent-sage/issues  
- Security: see [SECURITY.md](./SECURITY.md) in this repository  

**Publisher:** g00sifer Development Lab (Persistent Sage open-source project).

---

## Microsoft Store compliance

This privacy policy is provided to satisfy **Microsoft Store Policy Section 10.5 (Privacy)**. Persistent Sage:

- Describes what data is collected and how it is collected  
- Explains the purposes of collection and use  
- Discloses third-party sharing relevant to app functionality  
- States that the Windows advertising ID is not used for advertising  
- Describes user controls and security measures  
- Provides contact information and a process for policy updates  

If anything in this policy conflicts with how the app actually behaves, the **app’s behavior** and the technical details in [docs/DATA-AND-PRIVACY.md](./docs/DATA-AND-PRIVACY.md) govern. Please report discrepancies via GitHub Issues so we can correct the policy.

---

## Open beta notice

Persistent Sage is open beta software. Do not store highly sensitive, regulated, or high-risk information unless you accept the current local-storage model and optional cloud-provider risks described above.
