!include "common.nsh"
!include "extractAppPackage.nsh"
!include "LogicLib.nsh"

# KubeSpade portable launcher (replaces electron-builder stock portable.nsi).
# Stock template: extracts to %TEMP%, broken {endIf}, and arm64-only + useZip
# never copies APP_DIR_ARM64 (only entered when APP_DIR_64 is also defined).
CRCCheck off
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}

Function .onInit
  !ifndef SPLASH_IMAGE
    SetSilent silent
  !endif
  !insertmacro check64BitAndSetRegView
FunctionEnd

Function .onGUIInit
  InitPluginsDir
  !ifdef SPLASH_IMAGE
    File /oname=$PLUGINSDIR\splash.bmp "${SPLASH_IMAGE}"
    BgImage::SetBg $PLUGINSDIR\splash.bmp
    BgImage::Redraw
  !endif
FunctionEnd

!macro kubespade_portable_log LINE
  FileOpen $R9 "$TEMP\kubespade-portable-nsis.log" a
  FileSeek $R9 0 END
  FileWrite $R9 "${LINE}$\r$\n"
  FileClose $R9
!macroend

Section
  !ifdef SPLASH_IMAGE
    HideWindow
  !endif

  ReadEnvStr $0 LOCALAPPDATA
  ${If} $0 == ""
    StrCpy $INSTDIR "$TEMP\KubeSpadePortable"
  ${Else}
    StrCpy $INSTDIR "$0\KubeSpadePortable"
  ${EndIf}

  RMDir /r $INSTDIR
  CreateDirectory $INSTDIR
  SetOutPath $INSTDIR

  Delete "$TEMP\kubespade-portable-nsis.log"
  !insertmacro kubespade_portable_log "unpack=$INSTDIR"
  !insertmacro kubespade_portable_log "exedir=$EXEDIR"

  # Prefer File /r of the unpacked tree (useZip) — same bits as win-arm64-unpacked.
  # Fall back to 7z extractEmbeddedAppPackage. Nested !ifdef only (!else ifdef is invalid NSIS).
  !ifdef APP_DIR_ARM64
    ${If} ${IsNativeARM64}
      !insertmacro kubespade_portable_log "copy=APP_DIR_ARM64"
      File /r "${APP_DIR_ARM64}\*.*"
    ${Else}
      !ifdef APP_DIR_64
        !insertmacro kubespade_portable_log "copy=APP_DIR_64 (not native ARM64)"
        File /r "${APP_DIR_64}\*.*"
      !else
        MessageBox MB_OK|MB_ICONSTOP "This KubeSpade portable build is for Windows ARM64."
        Quit
      !endif
    ${EndIf}
  !else
    !ifdef APP_DIR_64
      !insertmacro kubespade_portable_log "copy=APP_DIR_64"
      File /r "${APP_DIR_64}\*.*"
    !else
      !ifdef APP_DIR_32
        !insertmacro kubespade_portable_log "copy=APP_DIR_32"
        File /r "${APP_DIR_32}\*.*"
      !else
        !insertmacro kubespade_portable_log "copy=extractEmbeddedAppPackage"
        !insertmacro extractEmbeddedAppPackage
      !endif
    !endif
  !endif

  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${Else}
    !insertmacro kubespade_portable_log "ERROR: missing $INSTDIR\${APP_EXECUTABLE_FILENAME}"
    MessageBox MB_OK|MB_ICONSTOP "Portable extract failed.$\n$INSTDIR\${APP_EXECUTABLE_FILENAME} is missing.$\n$\nSee %TEMP%\kubespade-portable-nsis.log"
    Quit
  ${EndIf}

  ${If} ${FileExists} "$INSTDIR\resources\app.asar"
  ${Else}
    !insertmacro kubespade_portable_log "ERROR: missing resources\app.asar"
    MessageBox MB_OK|MB_ICONSTOP "Portable extract incomplete (no app.asar).$\n$\nSee %TEMP%\kubespade-portable-nsis.log"
    Quit
  ${EndIf}

  ${If} ${FileExists} "$INSTDIR\resources\app.asar.unpacked\node_modules\node-pty\build\Release\conpty.node"
  ${ElseIf} ${FileExists} "$INSTDIR\resources\app.asar.unpacked\node_modules\node-pty\build\Release\pty.node"
  ${Else}
    !insertmacro kubespade_portable_log "WARN: missing node-pty .node in app.asar.unpacked"
  ${EndIf}

  ${If} ${FileExists} "$INSTDIR\resources\backend.exe"
  ${Else}
    !insertmacro kubespade_portable_log "WARN: missing resources\backend.exe"
  ${EndIf}

  !insertmacro kubespade_portable_log "launch=$INSTDIR\${APP_EXECUTABLE_FILENAME}"

  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${APP_FILENAME}").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("ELECTRON_ENABLE_LOGGING", "1").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("ELECTRON_LOG_FILE", "$TEMP\kubespade-electron.log").r0'

  !ifdef SPLASH_IMAGE
    BgImage::Destroy
  !endif

  # Quoted exe path required; do not pass GetAllParameters (can confuse Electron).
  ClearErrors
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"' $0
  !insertmacro kubespade_portable_log "exit=$0"

  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "KubeSpade exited with code $0.$\n$\nExtracted copy (not deleted):$\n$INSTDIR$\n$\nLogs:$\n%TEMP%\kubespade-portable-nsis.log$\n%TEMP%\kubespade-electron.log$\n%TEMP%\kubespade-startup.log"
  ${Else}
    SetOutPath $EXEDIR
    RMDir /r $INSTDIR
  ${EndIf}

  SetErrorLevel $0
SectionEnd
