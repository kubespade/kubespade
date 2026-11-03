#!/bin/bash
# Build script for macOS (.app + .dmg)
#
# Usage:
#   ./build-mac.sh                 # host arch — ad-hoc sign (local dev)
#   ./build-mac.sh arm64           # Apple Silicon
#   ./build-mac.sh x64             # Intel (Apple Silicon OK: Go + node-pty rebuilt for x86_64)
#   ./build-mac.sh arm64 v1.2.2    # set version for this build (leading v OK)
#   ./build-mac.sh v1.2.2          # host arch + version (dev/test convenience)
#
# Writes electron/package.json when a version is passed. Release versions
# belong in ./build-release.sh — this script is for local/dev builds.
#
# Developer ID + notarization run only when MAC_RELEASE=1 (set by ./build-release.sh).
# Override: SKIP_MAC_SIGN=1 forces ad-hoc even for release builds.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=build-common.sh
source "$ROOT/build-common.sh"
VOLNAME="KubeSpade"
DMG_ICNS="$ROOT/electron/build/dmg-icon.icns"

load_build_env "$ROOT"

MAC_SIGN_IDENTITY=""
MAC_NOTARIZE=0

setup_mac_signing() {
  MAC_SIGN_IDENTITY=""
  MAC_NOTARIZE=0

  if [[ "${SKIP_MAC_SIGN:-}" == "1" ]]; then
    echo "    SKIP_MAC_SIGN=1 — ad-hoc sign (Gatekeeper will block first open)"
    MAC_SIGN_IDENTITY="-"
    export CSC_IDENTITY_AUTO_DISCOVERY=false
    return 0
  fi

  if [[ "${MAC_RELEASE:-}" != "1" ]]; then
    echo "    Local build — ad-hoc sign (Developer ID + notarize: ./build-release.sh)"
    MAC_SIGN_IDENTITY="-"
    export CSC_IDENTITY_AUTO_DISCOVERY=false
    return 0
  fi

  echo "    Release build (MAC_RELEASE=1) — Developer ID + notarization"
  if [[ -n "${CSC_NAME:-}" ]]; then
    MAC_SIGN_IDENTITY="$CSC_NAME"
  elif [[ -n "${MAC_SIGN_IDENTITY:-}" && "${MAC_SIGN_IDENTITY}" != "-" ]]; then
    :
  else
    MAC_SIGN_IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null \
      | awk -F'"' '/Developer ID Application/ { print $2; exit }')"
  fi

  if [[ -n "$MAC_SIGN_IDENTITY" && "$MAC_SIGN_IDENTITY" != "-" ]]; then
    echo "    Mac signing: $MAC_SIGN_IDENTITY"
    export CSC_IDENTITY_AUTO_DISCOVERY=false
    local app_pw="${APPLE_APP_SPECIFIC_PASSWORD:-${APPLE_ID_PASSWORD:-}}"
    if [[ -n "${APPLE_ID:-}" && -n "$app_pw" && -n "${APPLE_TEAM_ID:-}" ]]; then
      MAC_NOTARIZE=1
      echo "    Notarization: enabled (team ${APPLE_TEAM_ID})"
    else
      echo "    WARN: Developer ID found but notarization creds missing."
      echo "          Set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID in .env"
      echo "          Signed-but-not-notarized builds may still be blocked by Gatekeeper."
    fi
    return 0
  fi

  echo "    No Developer ID certificate — ad-hoc sign only."
  echo "    Public downloads need Developer ID + notarization (see README / .env.example)."
  MAC_SIGN_IDENTITY="-"
  export CSC_IDENTITY_AUTO_DISCOVERY=false
}

sign_backend_binary() {
  local bin="$1"
  [[ -f "$bin" ]] || return 0
  if [[ "$MAC_SIGN_IDENTITY" == "-" ]]; then
    codesign --force --sign - "$bin"
  else
    codesign --force --options runtime --timestamp --sign "$MAC_SIGN_IDENTITY" "$bin"
  fi
}

sign_mac_app_bundle() {
  local app="$1"
  [[ -d "$app" ]] || return 0
  if [[ "$MAC_SIGN_IDENTITY" == "-" ]]; then
    echo "    Ad-hoc signing $app …"
    codesign --force --deep --sign - "$app"
    return 0
  fi

  local backend="$app/Contents/Resources/backend"
  if [[ -f "$backend" ]]; then
    echo "    Signing embedded backend …"
    codesign --force --options runtime --timestamp --sign "$MAC_SIGN_IDENTITY" "$backend"
  fi

  echo "    Signing $app (Developer ID + hardened runtime) …"
  node "$ROOT/electron/scripts/sign-mac-app.js" "$app" "$MAC_SIGN_IDENTITY"
}

notarize_mac_dmg() {
  local dmg="$1"
  [[ "$MAC_NOTARIZE" == "1" ]] || return 0
  [[ -f "$dmg" ]] || return 0

  local app_pw="${APPLE_APP_SPECIFIC_PASSWORD:-${APPLE_ID_PASSWORD:-}}"
  if [[ -z "${APPLE_ID:-}" || -z "$app_pw" || -z "${APPLE_TEAM_ID:-}" ]]; then
    echo "    ERROR: notarization enabled but APPLE_ID / password / APPLE_TEAM_ID missing" >&2
    exit 1
  fi

  echo "    Submitting DMG to Apple notarization (often 2–10 min) …"
  xcrun notarytool submit "$dmg" \
    --apple-id "$APPLE_ID" \
    --password "$app_pw" \
    --team-id "$APPLE_TEAM_ID" \
    --wait

  echo "    Stapling ticket to DMG …"
  xcrun stapler staple "$dmg"
  xcrun stapler validate "$dmg"

  echo "    Gatekeeper assessment …"
  # DMG container is often unsigned; notarization ticket + .app signature matter.
  # shellcheck source=release-checks.sh
  source "$ROOT/release-checks.sh"
  release_verify_mac_dmg "$dmg"
}

HOST_ARCH=$(uname -m)
ARCH_ARG="${1:-}"
VERSION_ARG="${2:-}"

# Allow `./build-mac.sh v1.2.2` (version only → host arch).
if [[ -z "$VERSION_ARG" && "$ARCH_ARG" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+ ]]; then
  VERSION_ARG="$ARCH_ARG"
  ARCH_ARG=""
fi

case "$ARCH_ARG" in
  "")
    if [[ "$HOST_ARCH" == "arm64" ]]; then
      GOARCH=arm64; EB_ARCH=arm64
    else
      GOARCH=amd64; EB_ARCH=x64
    fi
    ;;
  arm64|aarch64) GOARCH=arm64; EB_ARCH=arm64 ;;
  x64|amd64|intel) GOARCH=amd64; EB_ARCH=x64 ;;
  -h|--help)
    sed -n '2,16p' "$0"
    exit 0
    ;;
  *)
    echo "Usage: $0 [arm64|x64] [version]" >&2
    echo "  version optional, e.g. 1.2.2 or v1.2.2 (updates electron/package.json)" >&2
    echo "  or: $0 v1.2.2   # host arch + version" >&2
    exit 1
    ;;
esac

apply_pkg_version_arg "$VERSION_ARG"

echo "=== Building macOS ${EB_ARCH} (GOARCH=${GOARCH}) on host ${HOST_ARCH} ==="
echo ""
setup_mac_signing
echo ""

run_electron_builder() {
  local eb="$ROOT/electron/node_modules/electron-builder/cli.js"
  if [[ ! -f "$eb" ]]; then
    echo "error: electron-builder missing: $eb" >&2
    echo "       Run: cd electron && npm install" >&2
    exit 1
  fi
  node "$eb" "$@"
}

# Mach-O arch that must be inside node-pty for this Electron target.
mac_pty_macho() {
  if [[ "$EB_ARCH" == "x64" ]]; then echo x86_64; else echo arm64; fi
}

# npm install / postinstall builds host arch. Intel DMG from Apple Silicon
# needs a second rebuild or AI fails on Intel Macs (wrong pty.node).
ensure_mac_electron_native_deps() {
  local pty="$ROOT/electron/node_modules/node-pty/build/Release/pty.node"
  local want
  want="$(mac_pty_macho)"
  if [[ -f "$pty" && "${FORCE_NODE_PTY_REBUILD:-}" != "1" ]] && file "$pty" | grep -q "$want"; then
    echo "    node-pty already ${want}: $pty"
    file "$pty" || true
    return 0
  fi
  echo "    Rebuilding node-pty for Electron (darwin/${EB_ARCH})..."
  (
    cd "$ROOT/electron"
    npm_config_arch="${EB_ARCH}" npm_config_target_arch="${EB_ARCH}" \
      run_electron_builder install-app-deps --arch="${EB_ARCH}"
  )
  if [[ ! -f "$pty" ]]; then
    echo "error: node-pty pty.node missing after rebuild: $pty" >&2
    ls -la "$(dirname "$pty")" 2>/dev/null >&2 || true
    exit 1
  fi
  if ! file "$pty" | grep -q "$want"; then
    echo "error: node-pty is not ${want} (needed for macOS ${EB_ARCH} AI terminal):" >&2
    file "$pty" >&2
    if [[ "$HOST_ARCH" == "arm64" && "$EB_ARCH" == "x64" ]]; then
      echo "       Install Rosetta, then re-run:" >&2
      echo "         softwareupdate --install-rosetta --agree-to-license" >&2
    fi
    exit 1
  fi
  echo "    node-pty OK: $(file -b "$pty")"
}

verify_packaged_mac_pty() {
  local app="${1:-}"
  [[ -n "$app" && -d "$app" ]] || return 0
  local pty="$app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node"
  local want
  want="$(mac_pty_macho)"
  if [[ ! -f "$pty" ]]; then
    echo "error: packaged app missing node-pty: $pty" >&2
    exit 1
  fi
  if ! file "$pty" | grep -q "$want"; then
    echo "error: packaged node-pty is not ${want}:" >&2
    file "$pty" >&2
    exit 1
  fi
  echo "    packaged AI native OK: $(file -b "$pty")"
}

echo "=== 1/4  Frontend ==="
build_frontend

echo ""
echo "=== 2/4  Backend ==="
build_backend darwin "$GOARCH" k8s-client-backend

echo "    Signing backend binary…"
sign_backend_binary "$ROOT/backend/k8s-client-backend"

echo ""
echo "=== 3/4  Building Electron app (${EB_ARCH}) ==="
cd "$ROOT/electron"
if [[ "${SKIP_DEPS:-}" != "1" ]]; then
  npm install
fi
ensure_mac_electron_native_deps

# Disable certificate auto-discovery — sign manually below.
# CLI --arm64/--x64 overrides package.json mac.target arch list.
CSC_IDENTITY_AUTO_DISCOVERY=false run_electron_builder --mac --"${EB_ARCH}"

echo ""
echo "=== 4/4  Signing & removing quarantine ==="

# Prefer the arch-specific output (electron-builder leaves mac/ next to mac-arm64/).
if [[ "$EB_ARCH" == "arm64" ]]; then
  APP="$ROOT/dist-electron/mac-arm64/KubeSpade.app"
else
  APP="$ROOT/dist-electron/mac/KubeSpade.app"
fi
if [[ ! -d "$APP" ]]; then
  APP=$(find "$ROOT/dist-electron" -maxdepth 3 -name "*.app" -exec stat -f '%m %N' {} \; 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2-)
fi
if [[ -n "$APP" ]]; then
  verify_packaged_mac_pty "$APP"
  sign_mac_app_bundle "$APP"
  xattr -cr "$APP"
  echo "    OK"
fi

# Rebuild DMG from the signed .app and apply the transparent volume icon
# (electron-builder's DMG would contain the pre-sign app).
DMG=$(find "$ROOT/dist-electron" -maxdepth 2 -name "*.dmg" -exec stat -f '%m %N' {} \; 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2-)
if [[ -n "$DMG" && -n "$APP" ]]; then
  echo "    Repacking DMG with signed app + volume icon…"
  STAGE=$(mktemp -d)
  # macOS mktemp requires the X's at the end of the template; rw-XXXXXX.dmg is literal.
  RW_DMG=$(mktemp "$ROOT/dist-electron/rw.XXXXXX")
  mv "$RW_DMG" "$RW_DMG.dmg"
  RW_DMG="$RW_DMG.dmg"
  FINAL_TMP="${DMG%.dmg}-signed.dmg"

  if [[ ! -f "$DMG_ICNS" ]]; then
    echo "    ERROR: $DMG_ICNS missing — run ./make-icon.sh first" >&2
    exit 1
  fi

  # A stale volume of the same name would make hdiutil mount at
  # "/Volumes/<name> 1" and send the AppleScript below to the wrong disk.
  while [[ -d "/Volumes/$VOLNAME" ]]; do
    echo "    Ejecting stale /Volumes/$VOLNAME …"
    hdiutil detach "/Volumes/$VOLNAME" -force >/dev/null 2>&1 || break
  done

  cp -R "$APP" "$STAGE/"
  # electron-builder's Applications shortcut is lost when we repack — restore it.
  ln -s /Applications "$STAGE/Applications"

  hdiutil create -volname "$VOLNAME" \
    -srcfolder "$STAGE" \
    -ov -format UDRW \
    "$RW_DMG" >/dev/null

  ATTACH_OUT=$(hdiutil attach -readwrite -noverify -noautoopen "$RW_DMG")
  MOUNT=$(echo "$ATTACH_OUT" | grep -E '/Volumes/' | tail -1 | sed -E 's/.*(\/Volumes\/.*)$/\1/')
  if [[ -z "$MOUNT" || ! -d "$MOUNT" ]]; then
    echo "    ERROR: could not mount $RW_DMG" >&2
    hdiutil detach -force "$RW_DMG" 2>/dev/null || true
    rm -rf "$STAGE" "$RW_DMG"
    exit 1
  fi

  # Finder layout first: reopening the window makes Finder rewrite .DS_Store,
  # which can clobber attributes set beforehand.
  osascript <<OSA >/dev/null 2>&1 || echo "    WARN: Finder layout failed"
tell application "Finder"
  tell disk "$VOLNAME"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {200, 120, 740, 500}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 128
    set position of item "KubeSpade.app" of container window to {130, 220}
    set position of item "Applications" of container window to {410, 220}
    close
    open
    update without registering applications
    delay 1
  end tell
end tell
OSA

  # Volume icon: the .icns at the root plus the volume's custom-icon bit.
  cp "$DMG_ICNS" "$MOUNT/.VolumeIcon.icns"
  SetFile -c icnC "$MOUNT/.VolumeIcon.icns"
  SetFile -a C "$MOUNT"
  if [[ "$(GetFileInfo -aC "$MOUNT" 2>/dev/null)" != "1" ]]; then
    echo "    ERROR: custom-icon bit not set on $MOUNT — volume would show the generic disk icon" >&2
    hdiutil detach -force "$MOUNT" >/dev/null 2>&1 || true
    rm -rf "$STAGE" "$RW_DMG"
    exit 1
  fi

  sync
  hdiutil detach "$MOUNT" >/dev/null

  rm -f "$FINAL_TMP"
  hdiutil convert "$RW_DMG" -format UDZO -imagekey zlib-level=9 -o "$FINAL_TMP" >/dev/null
  mv "$FINAL_TMP" "$DMG"
  rm -f "$RW_DMG"
  rm -rf "$STAGE"
  xattr -cr "$DMG"

  # Brand the .dmg document itself (what Finder shows in Downloads). The icon
  # lives in the file's resource fork, so this has to follow `xattr -cr`, which
  # would otherwise strip it. Best-effort: needs Rez from full Xcode, and the
  # fork does not survive most upload pipelines.
  if command -v Rez >/dev/null 2>&1; then
    RSRC=$(mktemp -d)
    cp "$DMG_ICNS" "$RSRC/icon.icns"
    if sips -i "$RSRC/icon.icns" >/dev/null 2>&1 &&
       DeRez -only icns "$RSRC/icon.icns" > "$RSRC/icon.rsrc" 2>/dev/null &&
       Rez -append "$RSRC/icon.rsrc" -o "$DMG" 2>/dev/null; then
      SetFile -a C "$DMG"
      echo "    DMG file icon applied"
    else
      echo "    WARN: could not brand the .dmg file icon"
    fi
    rm -rf "$RSRC"
  fi

  # The bits above are easy to lose in the compression step — confirm on the
  # artefact that actually ships.
  VERIFY_OUT=$(hdiutil attach "$DMG" -noverify -noautoopen -nobrowse)
  VERIFY_MOUNT=$(echo "$VERIFY_OUT" | grep -E '/Volumes/' | tail -1 | sed -E 's/.*(\/Volumes\/.*)$/\1/')
  DMG_OK=1
  [[ -f "$VERIFY_MOUNT/.VolumeIcon.icns" ]] || { echo "    ERROR: .VolumeIcon.icns missing in final DMG" >&2; DMG_OK=0; }
  [[ -L "$VERIFY_MOUNT/Applications" ]] || { echo "    ERROR: Applications symlink missing in final DMG" >&2; DMG_OK=0; }
  [[ "$(GetFileInfo -aC "$VERIFY_MOUNT" 2>/dev/null)" == "1" ]] || { echo "    ERROR: custom-icon bit lost in final DMG" >&2; DMG_OK=0; }
  hdiutil detach "$VERIFY_MOUNT" >/dev/null
  [[ "$DMG_OK" == "1" ]] || exit 1
  echo "    OK (volume icon + Applications link verified)"
  notarize_mac_dmg "$DMG"
fi

# The .app icon on Tahoe comes from Contents/Resources/Assets.car; a missing one
# silently downgrades the Dock to the legacy .icns.
if [[ -n "$APP" ]]; then
  if [[ -f "$APP/Contents/Resources/Assets.car" ]] &&
     /usr/libexec/PlistBuddy -c "Print :CFBundleIconName" "$APP/Contents/Info.plist" >/dev/null 2>&1; then
    echo "    Icon: Assets.car + CFBundleIconName present"
  else
    echo "    WARN: Assets.car or CFBundleIconName missing — run ./make-icon.sh, then rebuild" >&2
  fi
fi

echo ""
echo "=== Done! (${EB_ARCH}) ==="
echo "    App: $APP"
echo "    DMG: $DMG"
if [[ "$MAC_SIGN_IDENTITY" == "-" ]]; then
  echo ""
  if [[ "${MAC_RELEASE:-}" == "1" ]]; then
    echo "    Gatekeeper: release build but ad-hoc (SKIP_MAC_SIGN=1 or no Developer ID)."
  else
    echo "    Gatekeeper: local ad-hoc build — right-click → Open, or use ./build-release.sh to ship."
  fi
elif [[ "$MAC_NOTARIZE" != "1" ]]; then
  echo ""
  echo "    Gatekeeper: signed but not notarized — add APPLE_* creds and rebuild."
fi
echo ""
echo "    Другая архитектура:"
echo "      ./build-mac.sh arm64   # Apple Silicon"
echo "      ./build-mac.sh x64     # Intel"
