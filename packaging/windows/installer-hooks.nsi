; Persistent Sage NSIS hooks — merged by Tauri bundler (see tauri.windows.conf.json).

!macro NSIS_HOOK_POSTINSTALL
  FileOpen $0 "$INSTDIR\Start Persistent Sage (Portable).bat" w
  FileWrite $0 "@echo off$\r$\n"
  FileWrite $0 "set PERSISTENT_SAGE_PORTABLE=1$\r$\n"
  FileWrite $0 "set NOVA_PORTABLE=1$\r$\n"
  FileWrite $0 "cd /d $\"%~dp0$\"$\r$\n"
  FileWrite $0 "start $\"$\" $\"$INSTDIR\persistent-sage.exe$\"$\r$\n"
  FileClose $0
  CreateShortCut "$SMPROGRAMS\Persistent Sage\Start Persistent Sage (Portable).lnk" "$INSTDIR\Start Persistent Sage (Portable).bat" "" "$INSTDIR\persistent-sage.exe" 0
  FileOpen $0 "$INSTDIR\README.txt" w
  FileWrite $0 "Persistent Sage — quick start$\r$\n$\r$\n"
  FileWrite $0 "Desktop: Start Menu shortcut (data in AppData).$\r$\n"
  FileWrite $0 "USB: Always use 'Start Persistent Sage (Portable).bat' so data stays in this folder.$\r$\n"
  FileClose $0
!macroend
