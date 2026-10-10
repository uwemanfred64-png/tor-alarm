; Beim Deinstallieren auch den Autostart-Eintrag entfernen, den die App selbst gesetzt hat.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "de.toralarm.app"
!macroend
