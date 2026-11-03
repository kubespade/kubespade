#!/bin/bash
# Build desktop release artifacts for macOS, Windows, and Linux (all arches)
# and stage them in github-release/ for a GitHub Release drag-and-drop.
#
# Usage:
#   ./build-release.sh              # version 1.1.0 (default)
#   ./build-release.sh 1.2.0
#   ./build-release.sh v1.2.0       # leading v is OK (stripped for package.json)
#   ./build-release.sh --version v1.2.0
#
# Env:
#   ALLOW_UNSIGNED_RELEASE=1  skip Gatekeeper/SmartScreen hard failures (dev only)
#   MAC_RELEASE=1             set by ./build-release.sh — Developer ID + notarize in build-mac.sh
#   SKIP_MAC_SIGN=1           force ad-hoc Mac sign even in release builds
#   APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID — Mac notarization (.env.example)
#   CSC_LINK / CSC_KEY_PASSWORD — Windows Authenticode OV/EV (.env.example)
#   SKIP_MAC=1          skip all macOS
#   SKIP_MAC_ARM64=1    skip Apple Silicon DMG
#   SKIP_MAC_X64=1      skip Intel DMG
#   SKIP_WIN=1          skip all Windows
#   SKIP_WIN_ARM64=1    skip Windows on ARM (default on macOS/Linux — node-pty cannot cross-build)
#   FORCE_WIN_ARM64=1   try Windows arm64 anyway (needs a host that can compile node-pty)
#   SKIP_LINUX=1        skip all Linux
#   SKIP_LINUX_X64=1    skip Linux x64 / amd64 (default on macOS — node-pty is not ELF)
#   FORCE_LINUX_X64=1   try Linux x64 anyway (AI broken unless this is Linux x86_64)
#   SKIP_LINUX_ARM64=1  skip Linux arm64 (default on macOS / non-ARM Linux — node-pty)
#   FORCE_LINUX_ARM64=1 try Linux arm64 anyway
#
# macOS Intel (.dmg without -arm64) is built on Apple Silicon: Go + Electron
# --x64, then node-pty rebuilt for x86_64 so the AI tab works on Intel Macs.
# If that rebuild fails: softwareupdate --install-rosetta --agree-to-license
#
set -euo pipefail
shopt -s nullglob

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist-electron"
DEFAULT_VERSION="1.1.0"

# shellcheck source=build-common.sh
source "$ROOT/build-common.sh"
# shellcheck source=release-checks.sh
source "$ROOT/release-checks.sh"
# shellcheck source=stage-github-release.sh
source "$ROOT/stage-github-release.sh"
release_load_env "$ROOT"
release_preflight_go "$ROOT"

VERSION="${DEFAULT_VERSION}"
case "${1:-}" in
  "" ) ;;
  --version)
    VERSION="${2:?version required}"
    ;;
  -h|--help)
    sed -n '2,30p' "$0"
    exit 0
    ;;
  *)
    VERSION="$1"
    ;;
esac

# Accept GitHub-style tags: v1.2.0 → 1.2.0 (npm / electron-builder want no v).
VERSION="${VERSION#v}"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.]+)?$ ]]; then
  echo "error: version must look like 1.2.0 or v1.2.0 (got: ${1:-$VERSION})" >&2
  exit 1
fi

OUT="$ROOT/github-release"

# build-win/linux/mac inherit SKIP_STAGE=1 so they do not stage mid-build;
# we call stage_*_to_github_release ourselves with staging enabled.
stage_now() {
  local saved="${SKIP_STAGE-}"
  SKIP_STAGE=0
  "$@"
  SKIP_STAGE="$saved"
}

echo "=== KubeSpade desktop release ${VERSION} ==="
echo "    Staging dir: $OUT"
echo ""

set_pkg_version "$ROOT/electron/package.json" "$VERSION"
echo "    electron/package.json version → ${VERSION}"

rm -rf "$OUT"
mkdir -p "$OUT"

echo ""
echo "=== Shared frontend ==="
cd "$ROOT/frontend"
npm install
npm run build
rm -rf "$ROOT/backend/dist"
cp -r dist "$ROOT/backend/dist"

echo ""
echo "=== Electron deps ==="
cd "$ROOT/electron"
npm install

export SKIP_FRONTEND=1
export SKIP_DEPS=1
export SKIP_STAGE=1
export MAC_RELEASE=1

release_preflight_mac

if [[ "${SKIP_MAC:-}" != "1" ]]; then
  echo ""
  echo "======== macOS arm64 ========"
  if [[ "${SKIP_MAC_ARM64:-}" == "1" ]]; then
    echo "    SKIPPED (SKIP_MAC_ARM64=1)"
  else
    "$ROOT/build-mac.sh" arm64
    stage_now stage_mac_to_github_release arm64
    release_verify_mac_dmg "$OUT/KubeSpade-${VERSION}-arm64.dmg"
  fi

  echo ""
  echo "======== macOS x64 (Intel) ========"
  if [[ "${SKIP_MAC_X64:-}" == "1" ]]; then
    echo "    SKIPPED (SKIP_MAC_X64=1)"
  else
    echo "    Apple Silicon OK: Go + Electron --x64; node-pty rebuilt for x86_64."
    if [[ "$(uname -m)" == "arm64" ]]; then
      echo "    If node-gyp fails, install Rosetta then re-run:"
      echo "      softwareupdate --install-rosetta --agree-to-license"
    fi
    # Shared npm install / arm64 step leave a host-arch pty.node.
    FORCE_NODE_PTY_REBUILD=1 "$ROOT/build-mac.sh" x64
    stage_now stage_mac_to_github_release x64
    release_verify_mac_dmg "$OUT/KubeSpade-${VERSION}.dmg"
  fi
fi

release_preflight_win

if [[ "${SKIP_WIN:-}" != "1" ]]; then
  host="$(uname -s)"
  win_cross_skip() {
    [[ "${FORCE_WIN_CROSS:-}${FORCE_WIN_ARM64:-}" == *1* ]] && return 1
    [[ "$host" == "Darwin" || "$host" == "Linux" ]]
  }

  echo ""
  echo "======== Windows x64 ========"
  if [[ "${SKIP_WIN_X64:-}" == "1" ]] || win_cross_skip; then
    echo "    SKIPPED on ${host}: node-pty cannot cross-compile for Windows (no conpty.node)."
    echo "    Build on a Windows x64 machine, or FORCE_WIN_CROSS=1 to pack anyway (AI broken)."
  else
    "$ROOT/build-win.sh" x64
    stage_now stage_windows_to_github_release x64
    release_verify_win_exe "$OUT/KubeSpade-Setup-${VERSION}.exe"
    release_verify_win_exe "$OUT/KubeSpade-Portable-${VERSION}.exe"
  fi

  echo ""
  echo "======== Windows arm64 ========"
  # node-pty is a native addon — cannot cross-compile for Windows from macOS/Linux.
  if [[ "${SKIP_WIN_ARM64:-}" == "1" ]] || win_cross_skip; then
    echo "    SKIPPED on ${host}: node-pty cannot cross-compile for Windows arm64."
    echo "    Build on a Windows ARM machine, or FORCE_WIN_CROSS=1 to attempt anyway."
  else
    "$ROOT/build-win.sh" arm64
    stage_now stage_windows_to_github_release arm64
    release_verify_win_exe "$OUT/KubeSpade-Setup-${VERSION}-arm64.exe"
    [[ -f "$OUT/KubeSpade-Portable-${VERSION}-arm64.exe" ]] && \
      release_verify_win_exe "$OUT/KubeSpade-Portable-${VERSION}-arm64.exe"
  fi
fi

release_preflight_linux

if [[ "${SKIP_LINUX:-}" != "1" ]]; then
  host="$(uname -s)"
  host_m="$(uname -m)"

  echo ""
  echo "======== Linux x64 ========"
  # Mac-built amd64 .deb/AppImage pack Darwin node-pty — AI will not start.
  if [[ "${SKIP_LINUX_X64:-}" == "1" ]] \
    || { [[ "${FORCE_LINUX_X64:-}" != "1" ]] && ! { [[ "$host" == "Linux" ]] && [[ "$host_m" == "x86_64" || "$host_m" == "amd64" ]]; }; }; then
    echo "    SKIPPED on ${host}/${host_m}: node-pty cannot cross-compile for Linux x64."
    echo "    Build amd64 .deb/AppImage on Ubuntu x64, or FORCE_LINUX_X64=1 to pack anyway (AI broken)."
  else
    "$ROOT/build-linux.sh" x64
    stage_now stage_linux_to_github_release x64
    release_verify_linux_deb "$OUT/kubespade_${VERSION}_amd64.deb"
    release_verify_linux_appimage "$OUT/KubeSpade-${VERSION}.AppImage"
  fi

  echo ""
  echo "======== Linux arm64 ========"
  if [[ "${SKIP_LINUX_ARM64:-}" == "1" ]] \
    || { [[ "${FORCE_LINUX_ARM64:-}" != "1" ]] && ! { [[ "$host" == "Linux" ]] && [[ "$host_m" == "aarch64" || "$host_m" == "arm64" ]]; }; }; then
    echo "    SKIPPED on ${host}/${host_m}: node-pty cannot cross-compile for Linux arm64."
    echo "    Build on Linux ARM, or FORCE_LINUX_ARM64=1 to attempt anyway."
  else
    "$ROOT/build-linux.sh" arm64
    stage_now stage_linux_to_github_release arm64
    release_verify_linux_deb "$OUT/kubespade_${VERSION}_arm64.deb"
    release_verify_linux_appimage "$OUT/KubeSpade-${VERSION}-arm64.AppImage"
  fi
fi

echo ""
echo "=== SHA256SUMS.txt ==="
cd "$OUT"
rm -f SHA256SUMS.txt
for f in *; do
  [[ -f "$f" && "$f" != SHA256SUMS.txt ]] || continue
  shasum -a 256 "$f" >> SHA256SUMS.txt
done
if [[ -f SHA256SUMS.txt ]]; then
  sort -k2 -o SHA256SUMS.txt SHA256SUMS.txt
fi
echo "    $(wc -l < SHA256SUMS.txt | tr -d ' ') files"
cat SHA256SUMS.txt

echo ""
echo "=== Done ==="
echo "    Drag everything from:"
echo "      $OUT"
echo "    onto the GitHub Release ${VERSION} assets."
echo ""
ls -lh "$OUT"
echo ""
echo "    Next version:  ./build-release.sh 1.2.2"
