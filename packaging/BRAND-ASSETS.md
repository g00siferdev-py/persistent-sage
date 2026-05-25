# Persistent Sage brand assets (installer + splash)

Official art lives in `packaging/branding/`; deployed runtime art lives in `public/`.

## Source files (canonical)

| File | Purpose |
|------|---------|
| `packaging/branding/SageIcon256.png` | Square app icon (master) |
| `packaging/branding/SageIcon1024.png` | Upscaled for `tauri icon` (generated) |
| `public/persistent-sage-splash.png` | Startup splash window |
| `public/persistent-sage-plate.png` | Sidebar plate above **New chat** |
| `public/persistent-sage-icon.png` | Favicon / installer header source |

## Generated / deployed

| File | Used for |
|------|----------|
| `packaging/windows/nsis-header.bmp` | Windows installer top strip (**150×57**) |
| `packaging/windows/nsis-sidebar.bmp` | Windows installer welcome (**164×314**) |
| `src-tauri/icons/*` | Exe, taskbar, Linux/macOS bundles (`npx tauri icon …`) |

After changing art in `packaging/branding/`:

```bash
npm run branding:icons
npm run branding:nsis
npm run build
npm run tauri build
```

## Linux installers

`.deb` / AppImage use `src-tauri/icons/icon.png` — no NSIS sidebar. First-run branding is the in-app splash window.
