!macro customInstall
  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${Else}
    MessageBox MB_OK|MB_ICONSTOP "KubeSpade.exe was not found in:$\n$INSTDIR$\n$\nThe installer did not unpack the app binaries (common with the NSIS 7-Zip plugin on Windows ARM).$\n$\nWorkaround: copy folder$\n  dist-electron\win-arm64-unpacked$\nto a local NTFS disk (C:\) and run KubeSpade.exe.$\nOr use KubeSpade-Portable-*-arm64.exe from C:\ (not Desktop / Mac share).$\n$\nRebuild Setup after the File /r NSIS patch so a normal install works."
  ${EndIf}
!macroend
