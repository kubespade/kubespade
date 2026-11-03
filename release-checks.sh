#!/bin/bash
# Shared release preflight + artifact checks for build-release.sh
#
# Set ALLOW_UNSIGNED_RELEASE=1 to skip hard failures (local/dev only).

release_load_env() {
  local root="$1"
  if [[ -f "$root/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$root/.env"
    set +a
  fi
}

# Go unit/static preflight (HY-1). Skippable with SKIP_GO_PREFLIGHT=1.
# CI already runs the same checks; this catches local release builds that skip CI.
release_preflight_go() {
  local root="$1"
  [[ "${SKIP_GO_PREFLIGHT:-}" == "1" ]] && {
    echo "    SKIPPED Go preflight (SKIP_GO_PREFLIGHT=1)"
    return 0
  }
  local backend="$root/backend"
  [[ -d "$backend" ]] || {
    echo "ERROR: backend/ missing under $root" >&2
    exit 1
  }

  echo "=== Go preflight (backend) ==="
  (
    cd "$backend"
    local fmt
    fmt="$(gofmt -l .)"
    if [[ -n "$fmt" ]]; then
      echo "ERROR: gofmt needed:" >&2
      echo "$fmt" >&2
      exit 1
    fi
    go vet ./...
    go test ./...
    if command -v staticcheck >/dev/null 2>&1; then
      staticcheck ./...
    else
      echo "    WARN: staticcheck not on PATH — skipped (CI still runs it)"
    fi
  ) || exit 1
  echo "    ✓ Go preflight OK"
}

release_mac_developer_id() {
  if [[ -n "${CSC_NAME:-}" ]]; then
    printf '%s' "$CSC_NAME"
    return 0
  fi
  security find-identity -v -p codesigning 2>/dev/null \
    | awk -F'"' '/Developer ID Application/ { print $2; exit }'
}

release_preflight_mac() {
  [[ "${SKIP_MAC:-}" == "1" ]] && return 0
  [[ "${SKIP_MAC_SIGN:-}" == "1" ]] && return 0
  [[ "${ALLOW_UNSIGNED_RELEASE:-}" == "1" ]] && return 0

  local id
  id="$(release_mac_developer_id)"
  if [[ -z "$id" ]]; then
    echo "ERROR: Mac release needs Developer ID Application in Keychain." >&2
    echo "       Gatekeeper blocks ad-hoc DMGs (right-click → Open workaround only)." >&2
    echo "       See kubespade-desktop/.env.example — or ALLOW_UNSIGNED_RELEASE=1 for dev." >&2
    exit 1
  fi

  local app_pw="${APPLE_APP_SPECIFIC_PASSWORD:-${APPLE_ID_PASSWORD:-}}"
  if [[ -z "${APPLE_ID:-}" || -z "$app_pw" || -z "${APPLE_TEAM_ID:-}" ]]; then
    echo "ERROR: Mac notarization creds missing." >&2
    echo "       Set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID in .env" >&2
    exit 1
  fi

  echo "    Mac release preflight OK (Developer ID + notarization creds)"
}

release_verify_mac_dmg() {
  local dmg="$1"
  [[ -f "$dmg" ]] || return 0

  if ! xcrun stapler validate "$dmg" >/dev/null 2>&1; then
    echo "    ✗ Notarization ticket missing: $(basename "$dmg")" >&2
    echo "      DMG is ad-hoc signed or not notarized — public downloads will be blocked." >&2
    if [[ "${ALLOW_UNSIGNED_RELEASE:-}" == "1" ]]; then
      echo "      ALLOW_UNSIGNED_RELEASE=1 — continuing anyway." >&2
      return 0
    fi
    exit 1
  fi

  local attach_out mount app ok=1
  attach_out=$(hdiutil attach "$dmg" -nobrowse -noverify -noautoopen 2>&1) || true
  mount=$(echo "$attach_out" | grep -E '/Volumes/' | tail -1 | sed -E 's/.*(\/Volumes\/.*)$/\1/')
  app=""
  if [[ -n "$mount" && -d "$mount" ]]; then
    app=$(find "$mount" -maxdepth 1 -name '*.app' -print -quit 2>/dev/null)
  fi

  if [[ -n "$app" && -d "$app" ]]; then
    if spctl -a -vv "$app" >/dev/null 2>&1; then
      echo "    ✓ Gatekeeper: $(basename "$dmg") ($(basename "$app") inside)"
    else
      echo "    ✗ Gatekeeper FAILED: $(basename "$app") inside $(basename "$dmg")" >&2
      ok=0
    fi
  else
    echo "    ✓ Notarized: $(basename "$dmg") (stapler OK; could not mount to verify .app)"
  fi

  [[ -n "$mount" && -d "$mount" ]] && hdiutil detach "$mount" -quiet 2>/dev/null || true

  if [[ "$ok" == "0" ]]; then
    if [[ "${ALLOW_UNSIGNED_RELEASE:-}" == "1" ]]; then
      echo "      ALLOW_UNSIGNED_RELEASE=1 — continuing anyway." >&2
      return 0
    fi
    exit 1
  fi
}

release_win_uses_public_cert() {
  [[ "${SKIP_WIN_SIGN:-}" == "1" ]] && return 1
  local link="${CSC_LINK:-${WIN_CSC_LINK:-}}"
  [[ -n "$link" && "$link" != *"certs/windows-codesign.pfx"* ]]
}

release_preflight_win() {
  [[ "${SKIP_WIN:-}" == "1" ]] && return 0
  [[ "${ALLOW_UNSIGNED_RELEASE:-}" == "1" ]] && return 0

  local host
  host="$(uname -s)"
  if [[ "$host" == "Darwin" || "$host" == "Linux" ]]; then
    if [[ "${FORCE_WIN_CROSS:-}${FORCE_WIN_ARM64:-}" != *1* ]]; then
      return 0
    fi
  fi

  if [[ "${SKIP_WIN_X64:-}" == "1" && "${SKIP_WIN_ARM64:-}" == "1" ]]; then
    return 0
  fi

  if release_win_uses_public_cert; then
    echo "    Windows release preflight OK (CSC_LINK / WIN_CSC_LINK)"
    return 0
  fi

  echo "ERROR: Windows release is unsigned or self-signed." >&2
  echo "       SmartScreen will warn on public downloads (like macOS Gatekeeper)." >&2
  echo "       Set CSC_LINK + CSC_KEY_PASSWORD to an OV/EV Authenticode .pfx," >&2
  echo "       or ALLOW_UNSIGNED_RELEASE=1 for local builds." >&2
  exit 1
}

release_find_signtool() {
  local c kit ver
  for kit in \
    "/c/Program Files (x86)/Windows Kits/10/bin" \
    "/c/Program Files/Windows Kits/10/bin"; do
    [[ -d "$kit" ]] || continue
    for ver in "$kit"/*; do
      [[ -d "$ver" ]] || continue
      for c in "$ver"/x64/signtool.exe "$ver"/arm64/signtool.exe "$ver"/x86/signtool.exe; do
        [[ -f "$c" ]] && { printf '%s' "$c"; return 0; }
      done
    done
  done
  return 1
}

release_verify_win_exe() {
  local exe="$1"
  [[ -f "$exe" ]] || return 0
  [[ "${SKIP_WIN_SIGN:-}" == "1" ]] && return 0

  if ! is_windows_host 2>/dev/null; then
    if release_win_uses_public_cert; then
      echo "    ✓ Windows signing config: public cert (verify on Windows host before ship)"
    elif [[ "${ALLOW_UNSIGNED_RELEASE:-}" == "1" ]]; then
      echo "    ⚠ Windows: self-signed/unsigned ($(basename "$exe"))"
    fi
    return 0
  fi

  local signtool
  signtool="$(release_find_signtool || true)"
  if [[ -z "$signtool" ]]; then
    echo "    WARN: signtool not found — skip Authenticode verify for $(basename "$exe")" >&2
    return 0
  fi

  if "$signtool" verify /pa "$exe" >/dev/null 2>&1; then
    echo "    ✓ Authenticode: $(basename "$exe")"
    return 0
  fi

  echo "    ✗ Authenticode FAILED: $(basename "$exe")" >&2
  if [[ "${ALLOW_UNSIGNED_RELEASE:-}" == "1" ]]; then
    echo "      ALLOW_UNSIGNED_RELEASE=1 — continuing anyway." >&2
    return 0
  fi
  exit 1
}

is_windows_host() {
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
  esac
  [[ "${OS:-}" == "Windows_NT" ]]
}

release_preflight_linux() {
  [[ "${SKIP_LINUX:-}" == "1" ]] && return 0
  echo "    Linux: no Gatekeeper/SmartScreen — ship .deb + AppImage from native Linux hosts."
}

release_verify_linux_appimage() {
  local appimage="$1"
  [[ -f "$appimage" ]] || return 0
  if [[ ! -x "$appimage" ]]; then
    echo "    fixing AppImage +x: $(basename "$appimage")"
    chmod +x "$appimage"
  fi
  echo "    ✓ AppImage executable: $(basename "$appimage")"
}

# Extract .deb and ensure packaged node-pty is a Linux ELF (not Mach-O from a Mac pack).
release_verify_linux_deb() {
  local deb="$1"
  [[ -f "$deb" ]] || return 0
  if command -v dpkg-deb >/dev/null 2>&1; then
    if ! dpkg-deb --info "$deb" >/dev/null 2>&1; then
      echo "    ✗ deb unreadable: $(basename "$deb")" >&2
      exit 1
    fi
    echo "    ✓ deb package: $(basename "$deb")"
  else
    echo "    ✓ deb staged: $(basename "$deb")"
  fi

  if ! command -v dpkg-deb >/dev/null 2>&1 || ! command -v file >/dev/null 2>&1; then
    echo "    WARN: skip node-pty ELF check (need dpkg-deb + file on this host)" >&2
    return 0
  fi

  local tmp pty info
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/kubespade-deb-XXXXXX")"
  if ! dpkg-deb -x "$deb" "$tmp" >/dev/null 2>&1; then
    rm -rf "$tmp"
    echo "    ✗ cannot extract deb for node-pty check: $(basename "$deb")" >&2
    exit 1
  fi
  pty="$(find "$tmp" -path '*/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node' 2>/dev/null | head -1 || true)"
  if [[ -z "$pty" || ! -f "$pty" ]]; then
    rm -rf "$tmp"
    echo "    ✗ deb missing node-pty pty.node — AI tab will fail: $(basename "$deb")" >&2
    exit 1
  fi
  info="$(file -b "$pty" 2>/dev/null || true)"
  if ! echo "$info" | grep -qi 'ELF'; then
    rm -rf "$tmp"
    echo "    ✗ deb ships non-ELF pty.node (invalid ELF header on Ubuntu): $(basename "$deb")" >&2
    echo "      $info" >&2
    echo "      Rebuild on Linux x64/arm64 matching the package — never package Linux from macOS." >&2
    exit 1
  fi
  if echo "$info" | grep -qiE 'Mach-O|PE32|MS-DOS'; then
    rm -rf "$tmp"
    echo "    ✗ deb ships wrong-OS pty.node: $(basename "$deb")" >&2
    echo "      $info" >&2
    exit 1
  fi
  echo "    ✓ deb node-pty ELF: $(basename "$deb") ($info)"
  rm -rf "$tmp"
}
