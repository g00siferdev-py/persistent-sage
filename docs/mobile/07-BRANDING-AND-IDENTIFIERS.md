# 07 — Branding and Identifiers

Canonical branding, package identifiers, and assets for Persistent Sage mobile development.

**Related:** [packaging/BRAND-ASSETS.md](../../packaging/BRAND-ASSETS.md)

---

## Product identity

| Field | Desktop 1.0.0 value | Mobile (proposed — decide in planning) |
|-------|----------------------|----------------------------------------|
| **Display name** | Persistent Sage | Persistent Sage |
| **Short name** | — | Sage (launcher label option) |
| **Publisher** | g00sifer Development Lab | Same |
| **Tagline** | Local-first AI companion | Same |

---

## Package identifiers

### Desktop (existing — do not change)

| Platform | Identifier |
|----------|------------|
| Tauri | `app.persistentsage.desktop` |
| Microsoft Store (MSIX) | `g00siferDevelopmentLab.PersistentSage` |
| MSIX Publisher | `CN=68E2BD37-83E1-49F0-9D7C-8CE0D54A4A45` |
| npm package | `persistent-sage` |
| Rust crate | `persistent-sage` (lib: `nova_lib`) |
| Executable | `persistent-sage.exe` |

### Android (to be decided)

| Field | Recommendation | Status |
|-------|----------------|--------|
| **Application ID** | `app.persistentsage.mobile` | ⚠️ Proposed — confirm with team |
| **Tauri identifier** | `app.persistentsage.mobile` | ⚠️ Needs `tauri.android.conf.json` |
| **Play Store listing ID** | TBD | Not created |
| **Deep link scheme** | `persistentsage://` | Optional |

**Important:** Use a **different** identifier from desktop (`app.persistentsage.desktop`) so Store listings and installs are independent.

---

## Version scheme

| Context | Current value | Notes |
|---------|---------------|-------|
| App semver | `1.0.0` | `package.json`, `Cargo.toml`, `tauri.conf.json` |
| MSIX quad version | `1.0.0.0` | `Package.appxmanifest` |
| Git tag | `v1.0.0` | GitHub Releases |
| Play Store versionCode | — | Integer; independent of semver |
| Play Store versionName | — | Display string; recommend matching semver |

**Recommendation:** Mobile v1 can ship as `1.0.0` (versionName) with its own `versionCode` starting at `1`. Document that desktop and mobile versions are **aligned in semver** but **independent in store version codes**.

---

## Brand colors

| Use | Value |
|-----|-------|
| Primary dark background | `#050a14` |
| MSIX tile background | `#050a14` |
| Splash background | `#050a14` |
| UI palette | Slate/indigo (Tailwind) |

**Android launcher note:** Current adaptive icon background in `src-tauri/icons/android/values/ic_launcher_background.xml` is **`#fff` (white)** — not brand `#050a14`. **Update before Play Store submission.**

---

## Canonical asset sources

| Asset | Path | Dimensions / format |
|-------|------|---------------------|
| Master icon (square) | `packaging/branding/SageIcon256.png` | 256×256 PNG |
| Icon source (generation) | `packaging/branding/SageIcon1024.png` | 1024×1024 PNG |
| Splash image | `public/persistent-sage-splash.png` | Used in desktop splash |
| Sidebar plate | `public/persistent-sage-plate.png` | Sidebar branding |
| Favicon | `public/persistent-sage-icon.png` | Web/favicon |

### Regenerate all platform icons

```bash
npm run branding:icons
# Runs: npx tauri icon packaging/branding/SageIcon1024.png -o src-tauri/icons
```

This generates Windows `.ico`, macOS `.icns`, **Android mipmap set**, and iOS AppIcon set.

---

## Android icons (already present)

Generated assets under `src-tauri/icons/android/`:

| Asset | Status |
|-------|--------|
| `mipmap-mdpi/` through `mipmap-xxxhdpi/` | `ic_launcher.png`, `ic_launcher_foreground.png`, `ic_launcher_round.png` |
| `mipmap-anydpi-v26/ic_launcher.xml` | Adaptive icon definition |
| `values/ic_launcher_background.xml` | Background color — **needs brand update** |

---

## Play Store assets (not yet created)

| Asset | Spec | Status |
|-------|------|--------|
| App icon | 512×512 PNG | Generate from `SageIcon1024.png` |
| Feature graphic | 1024×500 PNG | ❌ Not created |
| Phone screenshots | Min 2; 16:9 or 9:16 | ❌ Not created |
| 7-inch tablet screenshots | Optional | ❌ |
| 10-inch tablet screenshots | Optional | ❌ |
| Promo video | Optional | ❌ |

---

## Legacy naming (internal code)

The rebrand from "Nova" to "Persistent Sage" is complete in user-facing strings. Legacy names persist in:

| Legacy name | Still used in |
|-------------|---------------|
| `nova_lib` | Rust library crate name |
| `nova_memory.sqlite` | Database filename |
| `.nova_crypto/` | Encryption directory |
| `nova.provider.active` | SQLite preference keys |
| `NOVA_DATA_DIR`, `NOVA_PORTABLE` | Legacy env vars (still honored) |
| `useNovaMemory` | Frontend hook name |
| `NovaState` | Rust app state struct |

**Mobile team:** No need to rename these for v1 — document as internal legacy names. User-facing strings should say "Persistent Sage" and "Memory Anchor."

---

## Repository and distribution URLs

| Resource | URL |
|----------|-----|
| GitHub repository | https://github.com/g00siferdev-py/persistent-sage |
| GitHub Releases | https://github.com/g00siferdev-py/persistent-sage/releases |
| Privacy policy | https://github.com/g00siferdev-py/persistent-sage/blob/main/PRIVACY.md |
| Support / Issues | https://github.com/g00siferdev-py/persistent-sage/issues |
| Microsoft Store | Listed as `g00siferDevelopmentLab.PersistentSage` |
| Google Play | **Not listed yet** |

---

## License

MIT License — Copyright (c) 2026 [g00siferdev-py](https://github.com/g00siferdev-py)

Same license applies to mobile builds.

---

## Related documents

- [09-PRODUCTION-BRIEF.md](./09-PRODUCTION-BRIEF.md) — executive summary
- [08-DECISIONS-AND-OPEN-QUESTIONS.md](./08-DECISIONS-AND-OPEN-QUESTIONS.md) — identifier decisions
- [packaging/BRAND-ASSETS.md](../../packaging/BRAND-ASSETS.md) — asset regeneration workflow
