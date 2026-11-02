; The NitroSense-key watcher (HyperCore.exe --keyagent) keeps running after HYPERSPACE closes, which
; would lock HyperCore.exe during an update. Stop it first; it's started again at the end of the install.
!macro customInit
  nsExec::Exec 'taskkill /F /IM HyperCore.exe'
!macroend

; switched on (its "start at login" entry exists): bring the watcher straight back after an update
!macro customInstall
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "HYPERSPACE Key"
  ${if} $0 != ""
    Exec '$0'
  ${endIf}
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /IM HyperCore.exe'
!macroend

; an update runs the old uninstaller first: only a real uninstall forgets the watcher
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "HYPERSPACE Key"
  ${endIf}
!macroend
