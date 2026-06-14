# 08 — Decisions and Open Questions

Decisions the production team must make **before development begins**. Use this list when drafting the project summary.

Each item includes context, options, and a recommendation where applicable.

---

## 1. Technical approach

### Q1.1: Mobile framework

| Option | Pros | Cons |
|--------|------|------|
| **A. Tauri 2 Android** (recommended) | Maximum reuse of Rust + React; same IPC; icons already generated | Tauri mobile ecosystem less mature than desktop; some desktop APIs need gating |
| B. Native Kotlin + Rust FFI | Full native Android UX control | Reimplement all IPC; highest effort |
| C. React Native + Rust core | Large RN talent pool | Rewrite entire UI; bridge complexity |

**Recommendation:** Option A unless a specific blocking issue is identified during spike.

**Decision needed:** ☐ Tauri 2 Android confirmed as approach

---

### Q1.2: Minimum Android version

| Option | Market reach | Considerations |
|--------|-------------|----------------|
| API 24 (Android 7.0) | ~99%+ | Tauri 2 default minimum |
| API 26 (Android 8.0) | ~98% | Background execution improvements |
| API 29 (Android 10) | ~95% | Scoped storage default |

**Decision needed:** ☐ Target API level: ___

---

## 2. Feature scope (mobile v1)

### Q2.1: MVP feature set

Review [05-FEATURE-MATRIX.md](./05-FEATURE-MATRIX.md) and confirm:

| Feature area | Include in v1? |
|--------------|----------------|
| Core chat + streaming | ☐ |
| Memory Anchor | ☐ |
| Multi-provider (cloud only) | ☐ |
| Companion personality | ☐ |
| Image attachments | ☐ |
| Chat artifacts | ☐ |
| Web agent tools | ☐ |
| Projects | ☐ |
| Pulse | ☐ |
| Recipes | ☐ |
| Workspace file tools | ☐ |

**Decision needed:** ☐ Signed-off feature scope document

---

### Q2.2: Excluded features acknowledgment

Confirm explicit exclusion for v1:

- ☐ Ollama local provider
- ☐ `fetch_browser` (headless Chrome)
- ☐ Desktop portable mode
- ☐ Windows/Microsoft Store updater UI
- ☐ Database query agent tool

---

## 3. Navigation and UX

### Q3.1: Mobile information architecture

| Option | Pattern |
|--------|---------|
| A. Bottom tabs | Chat, Threads, Memory, Settings |
| B. Drawer + single pane | Hamburger opens threads/memory; chat is home |
| C. Hybrid | Bottom tabs for Chat/Settings; drawer for threads |

**Decision needed:** ☐ Navigation pattern selected

---

### Q3.2: Tablet support

| Option | Implication |
|--------|-------------|
| A. Phone only (v1) | Simpler; single layout |
| B. Phone + tablet responsive | May reuse some desktop multi-pane patterns on wide screens |

**Decision needed:** ☐ Tablet support in v1: Yes / No / Responsive only

---

## 4. Data and security

### Q4.1: Encryption key storage on Android

| Option | Security | Compatibility |
|--------|----------|---------------|
| A. Keep `.nova_crypto/ikm` file | Lower — file in app-private dir | Cross-platform settings export possible |
| B. Android Keystore for IKM | Higher — hardware-backed when available | Settings file not portable without export flow |
| C. Hybrid — Keystore primary, file fallback | Balanced | Migration complexity |

**Recommendation:** Option B for Play Store trust; plan export/import separately.

**Decision needed:** ☐ Key storage approach

---

### Q4.2: Android backup policy

| Option | Effect |
|--------|--------|
| A. Disable all backup | Safest for chat data |
| B. Backup non-sensitive only | Exclude DB, crypto, settings |

**Recommendation:** Option A or B with explicit exclusion rules.

**Decision needed:** ☐ Backup policy

---

### Q4.3: Data directory on Android

| Option | Use case |
|--------|----------|
| A. App-private internal only (v1) | Simplest; matches most apps |
| B. + SAF export/import (v1) | User can backup to Downloads/Drive |
| C. + Custom data dir picker | Matches desktop `PERSISTENT_SAGE_DATA_DIR` |

**Recommendation:** A for v1; B for v1.1.

**Decision needed:** ☐ Data directory strategy

---

## 5. Background execution (Pulse)

### Q5.1: Pulse on Android

| Option | UX | Complexity |
|--------|-----|------------|
| A. Foreground service + notification | Reliable; visible to user | Medium — notification permission |
| B. WorkManager periodic task | Battery-friendly; inexact timing | Medium — may miss exact intervals |
| C. Exclude Pulse from mobile v1 | Simplest | Loses feature parity |
| D. In-app only (no background) | Pulse runs only when app is open | Low effort; reduced value |

**Decision needed:** ☐ Pulse strategy

---

## 6. Distribution

### Q6.1: Distribution channel

| Option | Notes |
|--------|-------|
| A. Google Play Store | Primary recommendation; requires developer account ($25 one-time) |
| B. Sideload APK | Beta testing; no review |
| C. F-Droid | Open source distribution; no Google account needed |
| D. Play + sideload beta | Play for production; APK for internal testers |

**Decision needed:** ☐ Distribution channel(s)

---

### Q6.2: Update mechanism

| Option | Notes |
|--------|-------|
| A. Play Store only | Standard; no in-app updater code |
| B. Play In-App Updates API | Prompt user to update from within app |
| C. Self-hosted APK updates | Not recommended for Play Store builds |

**Decision needed:** ☐ Update mechanism

---

### Q6.3: Pricing model

| Option | Notes |
|--------|-------|
| A. Free (same as desktop) | Current model |
| B. Free with IAP | Future monetization |
| C. Paid app | Different from desktop |

**Decision needed:** ☐ Pricing model

---

## 7. Identifiers and branding

| Decision | Proposed value | Confirmed? |
|----------|----------------|------------|
| Android application ID | `app.persistentsage.mobile` | ☐ |
| Play Store listing name | Persistent Sage | ☐ |
| Mobile versionName for v1 | `1.0.0` | ☐ |
| Launcher icon background color | `#050a14` (fix from white) | ☐ |
| Privacy policy update for Android | Required | ☐ |

---

## 8. Team and process

### Q8.1: Repository strategy

| Option | Notes |
|--------|-------|
| A. Same monorepo (`persistent-sage`) | Mobile config alongside desktop; shared `src/` and `src-tauri/` |
| B. Separate mobile repo | Fork or split; harder to keep IPC in sync |

**Recommendation:** Option A — Tauri mobile is designed for monorepo.

**Decision needed:** ☐ Repository strategy

---

### Q8.2: Branch strategy

| Option | Notes |
|--------|-------|
| A. Feature branch `mobile/android` off `main` | Clean separation during development |
| B. Direct commits to `main` | Simpler but risks desktop regression |

**Recommendation:** Option A until mobile builds are stable.

**Decision needed:** ☐ Branch strategy

---

### Q8.3: CI/CD

| Item | Decision needed |
|------|-----------------|
| GitHub Actions for APK/AAB build | ☐ |
| Play Store internal testing track | ☐ |
| Automated signing (keystore in CI secrets) | ☐ |
| Instrumented / unit tests | ☐ |

---

## 9. Testing strategy

| Area | Questions |
|------|-----------|
| Provider integration | Test with real API keys or mocks? |
| WebView artifacts | Device matrix for HTML/chart/form rendering? |
| Memory / SQLite | Migration tests from desktop DB? |
| Battery | Pulse and background extraction impact? |
| Network | Offline behavior with placeholder provider? |
| Permissions | Camera/gallery/notification flows? |

**Decision needed:** ☐ Test plan outline

---

## 10. Legal and compliance

| Item | Status | Action |
|------|--------|--------|
| Privacy policy covers Android | ❌ | Update `PRIVACY.md` |
| Play Store data safety form | ❌ | Complete before submission |
| Generative AI disclosure | Partial (MS Store) | Extend to Play Console |
| Content rating (IARC) | ❌ | Complete questionnaire |
| Open-source license compliance | ✅ MIT | Verify dependency licenses in APK |
| LLM provider ToS | N/A | User brings own API keys — document in onboarding |

---

## Decision log template

Use this table in the project summary:

| ID | Decision | Choice | Date | Owner |
|----|----------|--------|------|-------|
| D1 | Mobile framework | | | |
| D2 | Target API level | | | |
| D3 | MVP feature scope | | | |
| D4 | Navigation pattern | | | |
| D5 | Keystore strategy | | | |
| D6 | Pulse strategy | | | |
| D7 | Distribution channel | | | |
| D8 | Application ID | | | |
| D9 | Branch strategy | | | |

---

## Related documents

- [05-FEATURE-MATRIX.md](./05-FEATURE-MATRIX.md) — feature scope input
- [09-PRODUCTION-BRIEF.md](./09-PRODUCTION-BRIEF.md) — summary template
- [06-DATA-AND-PRIVACY.md](./06-DATA-AND-PRIVACY.md) — privacy decisions
