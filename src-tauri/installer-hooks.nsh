; "Open in Jonathan" shell verbs for folders, folder backgrounds, and drives.
; HKCU matches installer currentUser scope. %V = clicked path.
; NoWorkingDirectory keeps Explorer from overriding %V (System32 on Drive).

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInJonathan" "" "Open in Jonathan"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInJonathan" "Icon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInJonathan" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInJonathan\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInJonathan" "" "Open in Jonathan"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInJonathan" "Icon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInJonathan" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInJonathan\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInJonathan" "" "Open in Jonathan"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInJonathan" "Icon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInJonathan" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInJonathan\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%V"'

  ; Remove any stale local-AI bootstrap script left by older installs.
  Delete "$INSTDIR\setup-ollama.ps1"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInJonathan"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInJonathan"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInJonathan"
!macroend
