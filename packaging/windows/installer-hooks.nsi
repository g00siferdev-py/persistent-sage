; Nova NSIS hooks — merged by Tauri bundler (see tauri.windows.conf.json).
; Creates a portable launcher beside nova.exe for USB / flash-drive use.

!macro NSIS_HOOK_POSTINSTALL
  ; Desktop shortcut from Tauri launches nova.exe (data in %LOCALAPPDATA%).
  ; Portable shortcut keeps chats on the install folder (USB-friendly).
  FileOpen $0 "$INSTDIR\Start Nova (Portable).bat" w
  FileWrite $0 "@echo off$\r$\nset NOVA_PORTABLE=1$\r$\ncd /d $\"%~dp0$\"$\r$\nstart $\"$\" $\"$INSTDIR\nova.exe$\"$\r$\n"
  FileClose $0

  CreateShortCut "$SMPROGRAMS\Nova\Start Nova (Portable).lnk" "$INSTDIR\Start Nova (Portable).bat" "" "$INSTDIR\nova.exe" 0

  FileOpen $0 "$INSTDIR\README.txt" w
  FileWrite $0 "Nova — quick start$\r$\n$\r$\n"
  FileWrite $0 "Desktop install (Start Menu):$\r$\n"
  FileWrite $0 "  Data is stored on this PC (AppData).$\r$\n$\r$\n"
  FileWrite $0 "USB / flash drive:$\r$\n"
  FileWrite $0 "  Always use 'Start Nova (Portable).bat' so data stays in this folder.$\r$\n"
  FileWrite $0 "  Copy the whole install folder to your USB drive.$\r$\n$\r$\n"
  FileWrite $0 "First launch: follow the setup wizard to choose an AI provider and API key.$\r$\n"
  FileClose $0
!macroend
