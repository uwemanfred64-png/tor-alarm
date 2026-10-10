; Autostart-Eintrag der App (den setzt Tor-Alarm selbst über app.setLoginItemSettings).

; Vor dem Update merken, ob Autostart an war – der Deinstaller der alten Version (1.0) löscht
; den Eintrag sonst, bevor die neue Version installiert ist.
!macro customInit
  Var /GLOBAL taRun
  ReadRegStr $taRun HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "de.toralarm.app"
!macroend

; Nach dem Installieren wiederherstellen (im Format, das die App selbst schreibt)
!macro customInstall
  ${if} $taRun != ""
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "de.toralarm.app" '"$appExe" --autostart'
  ${endIf}
!macroend

; Beim echten Deinstallieren entfernen – bei einem Update nicht
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "de.toralarm.app"
  ${endIf}
!macroend
