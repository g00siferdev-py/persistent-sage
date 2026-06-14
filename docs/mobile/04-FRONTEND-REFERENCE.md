# 04 — Frontend Reference

Reference for the React 19 + TypeScript frontend in Persistent Sage v1.0.0. The mobile Android app should reuse this codebase with a responsive navigation redesign.

---

## Entry points

| File | HTML | Purpose |
|------|------|---------|
| `src/main.tsx` | `index.html` | Primary app bootstrap |
| `src/splash-main.tsx` | `splashscreen.html` | Desktop splash window only |
| `src/App.tsx` | — | Root: renders `<ChatLayout />` |

**`main.tsx` flow:**
1. Import `global.css`
2. Call `initTheme()` (dark mode before paint)
3. Mount `<App />` under `StrictMode`

**Platform type (needs extension for mobile):**

```13:13:src/types/index.ts
export type AppPlatform = "desktop";
```

---

## Component tree

```
App
└── ChatLayout                          ← orchestrator
    ├── OnboardingWizard                (full-screen modal, z-200)
    ├── WhatsNewModal                   (full-screen modal, z-210)
    ├── ConversationSidebar             (left, fixed w-80)
    ├── [center]
    │   ├── backendHint banner
    │   └── ChatMain
    └── SettingsPanel                   (right, width by layout mode)
        └── CompanionPersonalitySection (Companion tab)
```

### ChatMain (`src/components/chat/ChatMain.tsx`)

| Area | Contents |
|------|----------|
| Header | Title, thinking-effort select, companion select, settings layout button |
| Message list | User/assistant bubbles, artifacts, streaming bubble |
| Footer | Project chips, recipe buttons, image attach, textarea, send |

### ConversationSidebar (`src/components/sidebar/ConversationSidebar.tsx`)

| Area | Contents |
|------|----------|
| Branding | Logo plate + companion name |
| Conversations | List, rename, delete, hide/restore |
| Memory Anchor | Startup briefing, extract anchors, anchor list, global recall search |

### SettingsPanel (`src/components/settings/SettingsPanel.tsx`)

| Tab | Key sections |
|-----|--------------|
| **Companion** | Profile editor, system prompt preview, import |
| **Provider** | Provider select, API keys, model lists, temperature, thinking |
| **Tools** | Web tools, browser fetch, workspace, personality edit, artifacts, DB |
| **General** | Pulse, memory, theme, updates, data paths, feedback, wipe |

### OnboardingWizard (`src/components/onboarding/OnboardingWizard.tsx`)

Steps: `welcome` → `storage` → `provider` → `apikey` → `done`

Copy is Windows-centric (AppData paths, portable `.bat`). **Must be rewritten for Android.**

---

## Hooks

### `useChat()` — `src/hooks/useChat.ts`

Central chat state. Direct Tauri `invoke` + event listeners (no React Query).

**State:**

| State | Purpose |
|-------|---------|
| `conversations`, `activeConversationId`, `messages` | Thread list + transcript |
| `briefing`, `anchors` | Sidebar memory context |
| `listLoading`, `threadLoading`, `sending`, `extractingAnchors` | Loading flags |
| `streamAssistant` | In-flight streaming bubble |
| `error` | User-visible errors |
| `activePersonalityId`, `personalityFile` | Companion scope |
| `visionSupported` | Image attach enabled |
| `recipes`, `projectList`, `activeProjectId` | Footer shortcuts |

**Key operations:**

| Operation | Backend |
|-----------|---------|
| Bootstrap | `personality_get`, `memory_set_active_personality`, `memory_list_conversations` |
| Load thread | `memory_get_recent`, `memory_startup_briefing`, `memory_list_anchors` |
| Send message | `chat_send_message` + stream events |
| Form submit | `project_format_form_submission` → silent `sendMessage` |
| Pulse refresh | event `pulse:tick` |

**Stream events listened:**

```typescript
// chat:stream-start — show thinking bubble
// chat:stream — append delta text
// chat:stream-error — show error
// pulse:tick — reload active thread
```

### `useNovaMemory()` — `src/hooks/useNovaMemory.ts`

Thin IPC wrapper module (not a React hook despite the name). Wraps all memory SQLite commands. Used by `useChat` and `ConversationSidebar`.

### `useTheme()` — `src/hooks/useTheme.ts`

- `useSyncExternalStore` watching `html.dark` class
- Persists to `localStorage` key `persistent-sage-theme`
- Default: **dark**

---

## TypeScript types

### Chat types — `src/types/chat.ts`

| Type | Description |
|------|-------------|
| `StoredConversation` | Thread row from SQLite |
| `StoredMessage` | DB message (includes `artifactJson`, image fields) |
| `StoredAnchor` | Memory anchor |
| `StoredProject` | Project row |
| `ChatMessage` | UI message with stable string `id` |
| `ChatSendResult` | `{ reply, toolCalls, providerId, modelId }` |
| `MemoryRecallBundle` | Hybrid recall result |
| `storedToChatMessage()` | Maps DB → UI; runs artifact preparation for assistant rows |

### Artifact types — `src/lib/artifacts.ts`

| Type | Description |
|------|-------------|
| `ChatArtifact` | `{ type, title, body, caption?, citations?, projectId? }` |
| `ArtifactCitation` | `{ path, lineStart?, lineEnd?, label? }` |
| `PreparedAssistantMessage` | Split display text + optional `artifactJson` |

**Artifact types handled in UI:** `html`, `vegaLite`/`chart`, `form`, `markdown`, unknown → `<pre>`.

### Form types — `src/lib/artifactForm.ts`

| Type | Description |
|------|-------------|
| `FormFieldKind` | text, textarea, number, checkbox, select, radio |
| `FormFieldDef` | Field schema with `label`, `name`, `required`, etc. |
| `FormArtifactBody` | `{ submitLabel?, fields[] }` |

### Settings types — inline in `SettingsPanel.tsx`

| Type | Key fields |
|------|------------|
| `SettingsView` | All settings + `has*ApiKey` booleans |
| `SettingsPatch` | Partial update for `settings_update` |
| `ProviderDescriptor` | `{ id, label, requiresApiKey }` |
| `AppDataPaths` | Data directory paths |
| `DistributionInfo` | Store vs direct download channel |

### Personality types — `src/lib/personalityPrompt.ts`

| Type | Description |
|------|-------------|
| `PersonalityProfile` | Companion persona fields |
| `PersonalityFile` | `{ version, profiles[], activeProfileId }` |

---

## All frontend `invoke` calls

48 unique command names. Grouped by usage location.

### Used in multiple places
- `settings_get` — ChatLayout, SettingsPanel, OnboardingWizard
- `settings_update` — ChatLayout, useChat, SettingsPanel, OnboardingWizard
- `settings_save_api_key` — SettingsPanel, OnboardingWizard
- `personality_get` — useChat, CompanionPersonalitySection

### Chat (useChat)
- `chat_send_message`
- `chat_vision_supported`
- `recipe_list`, `recipe_run`
- `project_list`, `project_format_form_submission`
- `open_path`

### Memory (useNovaMemory)
- All `memory_*` commands (see [03-BACKEND-REFERENCE.md](./03-BACKEND-REFERENCE.md))

### Settings only (SettingsPanel)
- `provider_list_available`, `provider_switch`
- `openai_list_models`, `anthropic_list_models`, `gemini_list_models`, `xai_list_models`
- `ollama_list_local_models`, `ollama_cloud_list_models`
- `app_version`, `app_data_paths`, `app_distribution_info`
- `check_store_updates`, `install_store_updates`
- `open_feedback_issue`, `reveal_data_directory`
- `pulse_run_now`
- `database_wipe_memories`, `database_wipe_all`
- `memory_reindex_embeddings`

### Onboarding only
- `app_data_paths`, `reveal_data_directory`
- `provider_list_available`

### File import (pickOpenclawFiles.ts)
- `read_text_files`
- `@tauri-apps/plugin-dialog` `open()` for native file picker

### Tauri API (non-invoke)
- `convertFileSrc` — message image display in ChatMain
- `@tauri-apps/plugin-dialog` — personality import file picker

---

## Settings-driven UI behavior

No separate feature-flag service. Behavior driven by `settings_get` fields:

| Setting | UI effect |
|---------|-----------|
| `onboardingCompleted` | Show/hide OnboardingWizard |
| `whatsNewSeenVersion` vs `app_version` | Show WhatsNewModal |
| `selectedProvider` + `has*ApiKey` | Backend hint banner |
| `thinkingEffort` | Header dropdown |
| `artifactsEnabled` | Tools tab toggle |
| `agentWebToolsEnabled` | Web tools section |
| `agentBrowserFetchEnabled` | Browser fetch toggle |
| `pulseEnabled` | Pulse settings section |
| `memorySemanticEnabled` | Embedding controls |

### Frontend-only preferences (localStorage)

| Key | Effect |
|-----|--------|
| `persistent-sage-theme` | Light/dark mode |
| `persistent-sage.settingsLayoutMode` | Settings panel: hidden/compact/full |
| `persistent-sage.settingsLayoutLastOpen` | Restore last open mode |

### Runtime checks

| Check | Effect |
|-------|--------|
| `chat_vision_supported` | Enable image attach button |
| `providerSupportsTools()` | Disable tool toggles for unsupported providers |
| `app_distribution_info.updatesViaMicrosoftStore` | Store vs GitHub update UI |
| `isNovaDesktop()` (`TAURI_ENV_PLATFORM`) | Native vs web file picker |

---

## Artifacts rendering pipeline

```
Rust stores artifactJson on message
  → storedToChatMessage()
  → prepareAssistantMessage() strips fenced blocks
  → ChatMain parses and renders by type
```

| Type | Renderer | Security |
|------|----------|----------|
| `form` | `<FormArtifact />` → silent send | N/A |
| `vegaLite`/`chart` | iframe `srcDoc` from SVG renderer | sandbox="", no external network |
| `html` | iframe `srcDoc` | strips `<script>`, inline handlers, remote URLs |
| other | `<pre>` JSON | N/A |
| citations | Pill buttons → `open_path` | Desktop file manager |

**Streaming UX:** While streaming, raw fenced blocks hidden with "Preparing report…" placeholder.

---

## Theme and styling

| Aspect | Implementation |
|--------|----------------|
| CSS framework | Tailwind CSS v4 via `@import "tailwindcss"` |
| Dark mode | `html.dark` class; `@custom-variant dark` |
| Icons | `lucide-react` |
| Layout | Full viewport: `h-full`, `overflow-hidden` on body |
| Responsive | Minimal — occasional `sm:` breakpoints only |
| Palette | Slate/indigo, gradient chat background, `#050a14` brand dark |

**No breakpoint-based layout switching** for sidebar/chat/settings. This is the primary mobile gap.

---

## Mobile UI adaptation requirements

### Navigation (critical)

| Desktop today | Mobile target |
|---------------|---------------|
| Fixed sidebar `w-80` always visible | Drawer or bottom tab; single pane at a time |
| Settings as right column (26–44rem) | Full-screen settings route or bottom sheet |
| Three simultaneous panes | Stack views: `chat` \| `threads` \| `settings` \| `memory` |
| No back navigation | Android system back button per pane |

**Suggested information architecture:**

```
[Threads] ←→ [Chat (primary)] ←→ [Settings]
     ↑              ↑
  hamburger    ⋮ menu (companion, thinking)
```

### Touch and composer

| Desktop | Mobile need |
|---------|-------------|
| Enter sends, Shift+Enter newline | Send button primary; optional Enter toggle |
| Dense header controls | Overflow menu or secondary screen |
| Fixed iframe heights (`h-80`) | Dynamic height; WebView-friendly sizing |
| Sidebar 40/60 split | Tabbed sub-panels or accordion |

### Platform API replacements

| Desktop API | Android replacement |
|-------------|---------------------|
| `open_path` | In-app viewer or `ACTION_VIEW` intent |
| `reveal_data_directory` | In-app data info screen |
| `convertFileSrc` | Verify Tauri mobile asset URL scheme |
| `@tauri-apps/plugin-dialog` | Android SAF picker + storage permissions |
| Store update UI | Google Play in-app update (TBD) |
| Onboarding AppData copy | Android scoped storage explanation |

### Components needing most work

| Component | Effort |
|-----------|--------|
| `ChatLayout.tsx` | High — navigation restructure |
| `ConversationSidebar.tsx` | High — drawer/mobile layout |
| `SettingsPanel.tsx` | Medium — full-screen mode |
| `ChatMain.tsx` | Medium — header collapse, composer UX |
| `OnboardingWizard.tsx` | Medium — Android-specific copy |
| `FormArtifact.tsx` | Low — likely works in WebView |
| Chart/HTML artifacts | Low-Medium — test WebView sandbox |

### Components likely reusable with minor changes

- `useChat.ts` / `useNovaMemory.ts` — backend logic unchanged
- `artifacts.ts`, `artifactForm.ts`, `chartArtifact.ts` — parsing logic
- `personalityPrompt.ts`, `personalityImport.ts` — data logic
- `WhatsNewModal.tsx` — overlay pattern works on mobile
- `CompanionPersonalitySection.tsx` — form fields adapt to narrow width

---

## File index

| Path | Role |
|------|------|
| `src/main.tsx` | Main entry |
| `src/App.tsx` | Root component |
| `src/components/layout/ChatLayout.tsx` | Shell orchestrator |
| `src/components/sidebar/ConversationSidebar.tsx` | Left pane / threads |
| `src/components/chat/ChatMain.tsx` | Chat UI |
| `src/components/chat/FormArtifact.tsx` | Form artifacts |
| `src/components/settings/SettingsPanel.tsx` | Settings |
| `src/components/onboarding/OnboardingWizard.tsx` | First-run |
| `src/hooks/useChat.ts` | Chat state + IPC |
| `src/hooks/useNovaMemory.ts` | Memory IPC wrappers |
| `src/hooks/useTheme.ts` | Theme hook |
| `src/types/chat.ts` | Chat/memory types |
| `src/lib/artifacts.ts` | Artifact parsing |
| `src/lib/tauri.ts` | Re-exports `invoke` |
| `src/styles/global.css` | Tailwind base |

---

## Related documents

- [03-BACKEND-REFERENCE.md](./03-BACKEND-REFERENCE.md) — IPC command details
- [05-FEATURE-MATRIX.md](./05-FEATURE-MATRIX.md) — what to include on Android
- [02-ARCHITECTURE.md](./02-ARCHITECTURE.md) — system layers
