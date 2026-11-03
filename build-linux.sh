#!/bin/bash
# Build Linux packages (AppImage + .deb)
# Runs on macOS (cross-compile x64) or natively on Ubuntu/Debian.
#
# Usage:
#   ./build-linux.sh                # host: arm64 on Linux ARM, else x64
#   ./build-linux.sh arm64          # aarch64 — must run on Linux ARM
#   ./build-linux.sh arm64 v1.2.0   # set version (leading v OK)
#   ./build-linux.sh x64 1.2.0
#
# After a successful build, copies .deb/AppImage into github-release/
# (append only: existing Windows/Mac/other-arch files are left in place).
# Does not clear that folder (only ./build-release.sh wipes it).
#
# Requires: Node.js, npm, Go, Python3 + Pillow (for icons)
# Output: dist-electron/*.AppImage  and  *.deb
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=build-common.sh
source "$ROOT/build-common.sh"
load_build_env "$ROOT"

# Same idea as Windows: pin arch on the electron-builder target
# (`AppImage:arm64`) so ARM hosts don't emit x64/unsuffixed names.
default_linux_arch() {
  if [[ "$(uname -s)" == "Linux" ]]; then
    case "$(uname -m)" in
      aarch64|arm64) echo arm64 ;;
      *) echo x64 ;;
    esac
  else
    echo x64
  fi
}

ARCH="${1:-}"
VERSION_ARG="${2:-}"
if [[ -z "$ARCH" ]]; then
  ARCH="$(default_linux_arch)"
fi

case "$ARCH" in
  x64|amd64) GOARCH=amd64; EB_ARCH=x64 ;;
  arm64|aarch64) GOARCH=arm64; EB_ARCH=arm64 ;;
  -h|--help)
    sed -n '2,16p' "$0"
    exit 0
    ;;
  *)
    echo "Usage: $0 [x64|arm64] [version]" >&2
    echo "  version optional, e.g. 1.2.0 or v1.2.0 (updates electron/package.json)" >&2
    echo "  omitted arch: arm64 on Linux ARM, otherwise x64" >&2
    exit 1
    ;;
esac

apply_pkg_version_arg "$VERSION_ARG"

# Native node-pty cannot be cross-compiled from macOS or a different Linux arch.
# A Mac-built amd64 .deb looks fine but AI fails (Mach-O pty.node, not ELF).
host="$(uname -s)"
host_m="$(uname -m)"
if [[ "$EB_ARCH" == "arm64" ]]; then
  if [[ "${FORCE_LINUX_ARM64:-}" != "1" ]] \
    && ! { [[ "$host" == "Linux" ]] && [[ "$host_m" == "aarch64" || "$host_m" == "arm64" ]]; }; then
    echo "error: Linux arm64 needs a Linux ARM host (node-pty / node-gyp cannot cross-compile)." >&2
    echo "       On Mac release builds this arch is skipped automatically." >&2
    echo "       Override (likely fails): FORCE_LINUX_ARM64=1 $0 arm64" >&2
    exit 1
  fi
elif [[ "$EB_ARCH" == "x64" ]]; then
  if [[ "${FORCE_LINUX_X64:-}" != "1" ]] \
    && ! { [[ "$host" == "Linux" ]] && [[ "$host_m" == "x86_64" || "$host_m" == "amd64" ]]; }; then
    echo "error: Linux x64 needs a Linux x86_64 host (node-pty cannot cross-compile)." >&2
    echo "       On Mac release builds amd64 .deb/AppImage are skipped (AI would be broken)." >&2
    echo "       Build on Ubuntu x64. Override (AI broken): FORCE_LINUX_X64=1 $0 x64" >&2
    exit 1
  fi
fi

# electron-builder reads package.json from cwd. Always use the copy already
# installed under electron/ — never npx (that may download a second tree).
run_electron_builder() {
  local eb="$ROOT/electron/node_modules/electron-builder/cli.js"
  if [[ ! -f "$eb" ]]; then
    echo "error: electron-builder missing: $eb" >&2
    echo "       Run: cd electron && npm install" >&2
    exit 1
  fi
  node "$eb" "$@"
}

ensure_linux_electron_native_deps() {
  [[ "$(uname -s)" == "Linux" ]] || return 0
  local pty="$ROOT/electron/node_modules/node-pty/build/Release/pty.node"
  local pty_build="$ROOT/electron/node_modules/node-pty/build"
  if [[ -f "$pty" && "${FORCE_NODE_PTY_REBUILD:-}" != "1" ]] \
    && linux_pty_node_ok "$pty"; then
    echo "    node-pty already OK for linux/${EB_ARCH}: $(file -b "$pty")"
    return 0
  fi
  # Stale Mach-O/PE from a Mac/Windows tree (Parallels copy) — wipe before rebuild.
  # electron-builder install-app-deps defaults --platform to darwin; must force linux.
  if [[ -f "$pty" ]]; then
    echo "    removing stale node-pty binary: $(file -b "$pty")"
  fi
  rm -rf "$pty_build"
  echo "    Rebuilding node-pty for Electron (linux/${EB_ARCH})..."
  (
    cd "$ROOT/electron"
    npm_config_arch="${EB_ARCH}" npm_config_target_arch="${EB_ARCH}" \
      run_electron_builder install-app-deps --platform=linux --arch="${EB_ARCH}"
  )
  if [[ ! -f "$pty" ]]; then
    echo "error: node-pty pty.node missing after rebuild: $pty" >&2
    ls -la "$(dirname "$pty")" 2>/dev/null >&2 || true
    echo "       Need build-essential / python3 on this Ubuntu host for node-gyp." >&2
    exit 1
  fi
  if ! linux_pty_node_ok "$pty"; then
    echo "error: node-pty is not a Linux ${EB_ARCH} ELF binary (AI terminal would fail):" >&2
    file "$pty" >&2
    echo "       install-app-deps must use --platform=linux (darwin is the default)." >&2
    echo "       If this path is a Mac share, copy the repo onto a native Linux disk and rebuild." >&2
    exit 1
  fi
  echo "    node-pty OK: $(file -b "$pty")"
}

# True if pty.node is ELF for this EB_ARCH (rejects Mach-O / PE from Mac/Windows copies).
linux_pty_node_ok() {
  local pty="$1"
  [[ -f "$pty" ]] || return 1
  local info
  info="$(file -b "$pty" 2>/dev/null || true)"
  echo "$info" | grep -qi 'ELF' || return 1
  echo "$info" | grep -qiE 'Mach-O|PE32|MS-DOS|DLL' && return 1
  if [[ "$EB_ARCH" == "arm64" ]]; then
    echo "$info" | grep -qiE 'aarch64|ARM aarch64|ARM64' || return 1
  else
    echo "$info" | grep -qiE 'x86-64|x86_64|Intel 80386|AMD64' || return 1
  fi
  return 0
}

verify_packaged_linux_pty() {
  local unpacked=""
  local cand
  for cand in \
    "$ROOT/dist-electron/linux-unpacked" \
    "$ROOT/dist-electron/linux-${EB_ARCH}-unpacked" \
    "$ROOT/dist-electron/linux-arm64-unpacked" \
    "$ROOT/dist-electron/linux-x64-unpacked"; do
    if [[ -d "$cand/resources/app.asar.unpacked/node_modules/node-pty" ]]; then
      unpacked="$cand"
      break
    fi
  done
  if [[ -z "$unpacked" ]]; then
    unpacked="$(find "$ROOT/dist-electron" -maxdepth 2 -type d -name 'linux*-unpacked' 2>/dev/null | head -1 || true)"
  fi
  local pty=""
  if [[ -n "$unpacked" ]]; then
    pty="$unpacked/resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node"
  fi
  if [[ -z "$pty" || ! -f "$pty" ]]; then
    pty="$(find "$ROOT/dist-electron" -path '*/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node' 2>/dev/null | head -1 || true)"
  fi
  if [[ -z "$pty" || ! -f "$pty" ]]; then
    echo "error: packaged Linux app missing node-pty pty.node under dist-electron/" >&2
    echo "       AI tab would show 'invalid ELF header' or fail to load." >&2
    exit 1
  fi
  if ! linux_pty_node_ok "$pty"; then
    echo "error: packaged pty.node is not Linux ${EB_ARCH} ELF — do not ship this build:" >&2
    file "$pty" >&2
    echo "       Typical cause: packaging on macOS or copying electron/node_modules from Mac." >&2
    echo "       Rebuild on Ubuntu ${EB_ARCH}: ./build-linux.sh ${EB_ARCH}" >&2
    exit 1
  fi
  echo "    packaged node-pty OK: $(file -b "$pty")"
}

# Mac / Parallels copies flatten npm .bin symlinks. `tsc` then looks for
# ../lib/tsc.js next to .bin/ instead of inside typescript/.
linux_node_modules_broken() {
  local dir="$1"
  local nm="$dir/node_modules"
  [[ -d "$nm" ]] || return 1
  if [[ -f "$dir/package.json" ]] && grep -q '"typescript"' "$dir/package.json"; then
    if [[ ! -f "$nm/typescript/lib/tsc.js" ]]; then
      return 0
    fi
    local tsc="$nm/.bin/tsc"
    if [[ -L "$tsc" && ! -e "$tsc" ]]; then
      return 0
    fi
    if [[ -f "$tsc" && ! -L "$tsc" ]]; then
      return 0
    fi
  fi
  if [[ -f "$dir/package.json" ]] && grep -q '"electron-builder"' "$dir/package.json"; then
    [[ -f "$nm/electron-builder/cli.js" ]] || return 0
    local eb="$nm/.bin/electron-builder"
    if [[ -L "$eb" && ! -e "$eb" ]]; then
      return 0
    fi
    if [[ -f "$eb" && ! -L "$eb" ]]; then
      return 0
    fi
  fi
  return 1
}

linux_npm_install() {
  local dir="$1"
  if [[ "${SKIP_DEPS:-}" == "1" ]]; then
    return 0
  fi
  if linux_node_modules_broken "$dir"; then
    echo "    Removing broken node_modules in ${dir#"$ROOT"/} (copied from Mac / no npm symlinks)..."
    rm -rf "$dir/node_modules"
  fi
  # Parallels Mac shares often cannot create npm .bin symlinks. Skip package
  # postinstall (it calls `electron-builder` via .bin) and run cli.js ourselves.
  if [[ "$(uname -s)" == "Linux" && "$dir" == "$ROOT/electron" ]]; then
    (cd "$dir" && npm install --ignore-scripts)
    (cd "$dir" && node scripts/patch-node-pty-win.js && node scripts/patch-portable-win.js)
    return 0
  fi
  (cd "$dir" && npm install)
}

warn_if_parallels_share() {
  [[ "$(uname -s)" == "Linux" ]] || return 0
  local fstype=""
  fstype="$(df -T "$ROOT" 2>/dev/null | awk 'NR==2 { print $2 }')" || true
  case "$fstype" in
    prl_fs|osxfs|fuse.vmhgfs*|fuse.osxfs|smbfs|cifs)
      echo "warning: repo is on a shared Mac folder ($fstype)." >&2
      echo "         Copy to a Linux disk first, e.g.  cp -a ~/Desktop/kubespade-desktop ~/kubespade-desktop" >&2
      echo "         then build from there. Shared folders break npm symlinks and node-gyp." >&2
      ;;
  esac
}

warn_if_parallels_share

if [[ "${SKIP_FRONTEND:-}" == "1" ]]; then
  echo "=== 1/4  Frontend skipped ==="
else
  echo "=== 1/4  Building frontend ==="
  linux_npm_install "$ROOT/frontend"
  cd "$ROOT/frontend"
  # Avoid .bin/tsc shims (broken when node_modules was copied from Mac).
  node ./node_modules/typescript/lib/tsc.js
  node ./node_modules/vite/bin/vite.js build
  rm -rf "$ROOT/backend/dist"
  cp -r dist "$ROOT/backend/dist"
fi

echo ""
echo "=== 2/4  Linux icons (NxN.png, transparent corners) ==="
ICONS="$ROOT/electron/build/icons"
# Always Mac/iOS art for Ubuntu/AppImage — Windows has its own icon-win.png.
SRC="$ROOT/icon-mac-ios.png"
if [[ ! -f "$SRC" ]]; then
  echo "    ERROR: missing $SRC" >&2
  exit 1
fi
echo "    using icon-mac-ios.png (native-res plate → per-size mask)"
mkdir -p "$ICONS"
# Same helpers as make-icon.sh / tools/build_icons.py (no 1024 upscale hop).
python3 - "$ROOT/tools/build_icons.py" "$SRC" "$ICONS" <<'PY'
import importlib.util
import sys
from pathlib import Path

script, src, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
spec = importlib.util.spec_from_file_location("build_icons", script)
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)
mod.emit_desktop_size_set(src, out, radius_frac=0.22)
for p in sorted(out.glob("*.png")):
    print(f"    {p.name}")
PY

echo ""
echo "=== 3/4  Backend ==="
build_backend linux "$GOARCH" k8s-client-backend

echo ""
echo "=== 4/4  Building Electron (Linux ${EB_ARCH}) ==="
linux_npm_install "$ROOT/electron"
cd "$ROOT/electron"
ensure_linux_electron_native_deps
cd "$ROOT/electron"

# Do not wipe dist-electron/ or github-release/: other arches (and Windows/Mac
# copies) stay. electron-builder overwrites only this arch's AppImage/deb.
export CSC_IDENTITY_AUTO_DISCOVERY=false

# Pin arch on each target (same pattern as Windows nsis:arm64 / portable:arm64).
run_electron_builder --linux "AppImage:${EB_ARCH}" "deb:${EB_ARCH}"

verify_packaged_linux_pty

# Append into github-release/ (does not wipe — only build-release.sh clears it).
# SKIP_STAGE=1 when called from build-release.sh (it stages itself).
# shellcheck source=stage-github-release.sh
source "$ROOT/stage-github-release.sh"
stage_linux_to_github_release "$EB_ARCH"

echo ""
echo "=== Done! ==="
echo "    Artifacts in: ${ROOT}/dist-electron/"
ls -lh "${ROOT}/dist-electron/"*.AppImage "${ROOT}/dist-electron/"*.deb 2>/dev/null \
  || ls -lh "${ROOT}/dist-electron/"
echo ""
echo "    Ubuntu:"
echo "      AppImage:  chmod +x *.AppImage && ./*.AppImage"
echo "      deb:       sudo apt install ./kubespade_*.deb"
echo "    If the dock still shows a generic icon after .deb install:"
echo "      sudo gtk-update-icon-cache /usr/share/icons/hicolor || true"
echo "      then log out/in or restart the shell"
echo "    Staged (no wipe): ${ROOT}/github-release/"
if [[ "$EB_ARCH" == "arm64" ]]; then
  echo "    GitHub names: kubespade_*_arm64.deb  KubeSpade-*-arm64.AppImage"
else
  echo "    GitHub names: kubespade_*_amd64.deb  KubeSpade-*.AppImage (x64, no arch suffix)"
fi
