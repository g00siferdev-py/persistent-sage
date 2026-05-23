# Nova brand assets (installer + splash)

Official art lives in `packaging/branding/` and is copied into the app at build time.

## Source files (canonical)

| File | Purpose |
|------|---------|
| `packaging/branding/NovaIcon256.png` | Square app icon (master) |
| `packaging/branding/NovaIcon1024.png` | Upscaled for `tauri icon` (generated) |
| `packaging/branding/NovaLogo.png` | Full logo + “AI companion” tagline |

## Generated / deployed

| File | Used for |
|------|----------|
| `public/nova-splash.png` | Startup splash window |
| `public/nova-logo.png` | Favicon, NSIS header, fallbacks |
| `packaging/windows/nsis-header.bmp` | Windows installer top strip (**150×57**) |
| `packaging/windows/nsis-sidebar.bmp` | Windows installer welcome (**164×314**) |
| `src-tauri/icons/*` | Exe, taskbar, Linux/macOS bundles (`npx tauri icon …`) |

After changing art in `packaging/branding/`:

```bash
# Refresh public copies + 1024 icon source
python3 -c "from PIL import Image; from pathlib import Path; r=Path('.'); s=Image.open(r/'packaging/branding/NovaIcon256.png').convert('RGBA'); s.resize((1024,1024), Image.Resampling.LANCZOS).save(r/'packaging/branding/NovaIcon1024.png'); s.resize((512,512), Image.Resampling.LANCZOS).save(r/'public/nova-logo.png'); Image.open(r/'packaging/branding/NovaLogo.png').save(r/'public/nova-splash.png')"
npx tauri icon packaging/branding/NovaIcon1024.png -o src-tauri/icons
npm run branding:nsis
npm run build
npm run tauri build
```

## Linux installers

`.deb` / AppImage use `src-tauri/icons/icon.png` — no NSIS sidebar. First-run branding is the in-app splash window.
