#!/bin/bash
# Shared helpers: copy dist artifacts into github-release/ without wiping it.
# Sourced by build-win.sh / build-linux.sh. build-release.sh owns the wipe.
#
# Expects ROOT to be set to kubespade-desktop/.
# Optional: SKIP_STAGE=1 to no-op (when build-release stages itself).

stage_release_init() {
  STAGE_DIST="${ROOT}/dist-electron"
  STAGE_OUT="${ROOT}/github-release"
  STAGE_VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).version)" "${ROOT}/electron/package.json")"
}

# mtime epoch — GNU stat (Linux/Git Bash) vs BSD stat (macOS). Do not use BSD -f first on
# GNU: -f '%m' is mount point, not mtime, and breaks (( arithmetic )) under set -u.
stage_release_mtime() {
  local f="$1"
  if stat --version >/dev/null 2>&1; then
    stat -c '%Y' "$f" 2>/dev/null
  else
    stat -f '%m' "$f" 2>/dev/null
  fi
}

stage_release_newest() {
  local f newest="" newest_t=0 t
  shopt -s nullglob
  for f in "$@"; do
    [[ -f "$f" ]] || continue
    t=$(stage_release_mtime "$f" || echo 0)
    if (( t >= newest_t )); then
      newest=$f
      newest_t=$t
    fi
  done
  shopt -u nullglob
  [[ -n "$newest" ]] || return 1
  printf '%s' "$newest"
}

stage_release_copy() {
  local dest_name="$1"
  shift
  local src
  if ! src=$(stage_release_newest "$@"); then
    echo "    ERROR: no artifact for $dest_name (looked for: $*)" >&2
    return 1
  fi
  mkdir -p "$STAGE_OUT"
  cp -f "$src" "$STAGE_OUT/$dest_name"
  echo "    + $dest_name  ←  $(basename "$src")"
}

# Rewrite checksums from whatever is already in github-release/ (does not
# delete Setup/dmg/deb/AppImage). Other platform files keep their sums.
stage_release_sha256() {
  mkdir -p "$STAGE_OUT"
  (
    cd "$STAGE_OUT"
    local tmp=".SHA256SUMS.txt.tmp"
    local f
    rm -f "$tmp"
    for f in *; do
      [[ -f "$f" && "$f" != SHA256SUMS.txt && "$f" != "$tmp" ]] || continue
      shasum -a 256 "$f" >> "$tmp"
    done
    if [[ -f "$tmp" ]]; then
      sort -k2 -o "$tmp" "$tmp"
      mv -f "$tmp" SHA256SUMS.txt
      echo "    SHA256SUMS.txt updated ($(wc -l < SHA256SUMS.txt | tr -d ' ') files)"
    fi
  )
}

# Stage macOS DMG for the current arch (arm64|x64). Does not wipe STAGE_OUT.
# GitHub names: arm64 has -arm64; Intel DMG is unsuffixed.
stage_mac_to_github_release() {
  local arch="${1:?arch}"
  [[ "${SKIP_STAGE:-}" == "1" ]] && return 0
  stage_release_init
  local ver="$STAGE_VERSION"
  local dist="$STAGE_DIST"
  echo ""
  echo "=== Staging → github-release/ (keep existing) ==="
  echo "    version ${ver}, arch ${arch} (mac)"
  shopt -s nullglob
  if [[ "$arch" == "arm64" ]]; then
    stage_release_copy "KubeSpade-${ver}-arm64.dmg" \
      "$dist/KubeSpade-${ver}-arm64.dmg" \
      "$dist"/*-arm64.dmg
  else
    stage_release_copy "KubeSpade-${ver}.dmg" \
      "$dist/KubeSpade-${ver}.dmg" \
      "$dist/KubeSpade-${ver}-x64.dmg"
  fi
  shopt -u nullglob
  stage_release_sha256
  echo "    → $STAGE_OUT"
}

# Stage Windows artifacts for the current arch (x64|arm64). Does not wipe STAGE_OUT.
stage_windows_to_github_release() {
  local arch="${1:?arch}"
  [[ "${SKIP_STAGE:-}" == "1" ]] && return 0
  stage_release_init
  local ver="$STAGE_VERSION"
  local dist="$STAGE_DIST"
  echo ""
  echo "=== Staging → github-release/ (keep existing) ==="
  echo "    version ${ver}, arch ${arch}"
  shopt -s nullglob
  if [[ "$arch" == "arm64" ]]; then
    stage_release_copy "KubeSpade-Setup-${ver}-arm64.exe" \
      "$dist/KubeSpade Setup ${ver}.exe" \
      "$dist"/KubeSpade*Setup*.exe
    stage_release_copy "KubeSpade-Portable-${ver}-arm64.exe" \
      "$dist/KubeSpade-Portable-${ver}-arm64.exe" \
      "$dist"/KubeSpade-Portable-*-arm64.exe \
      "$dist/KubeSpade ${ver}.exe" \
      "$dist"/KubeSpade*Portable*.exe || echo "    WARN: no portable arm64 staged"
  else
    stage_release_copy "KubeSpade-Setup-${ver}.exe" \
      "$dist/KubeSpade Setup ${ver}.exe" \
      "$dist"/KubeSpade*Setup*.exe
    stage_release_copy "KubeSpade-Portable-${ver}.exe" \
      "$dist/KubeSpade ${ver}.exe" \
      "$dist"/KubeSpade*Portable*.exe \
      "$dist/KubeSpade ${ver}.exe"
  fi
  shopt -u nullglob
  stage_release_sha256
  echo "    → $STAGE_OUT"
}

# Stage Linux artifacts for the current arch (x64|arm64). Does not wipe STAGE_OUT.
# GitHub names: x64 AppImage unsuffixed; arm64 always -arm64 / _arm64.
stage_linux_to_github_release() {
  local arch="${1:?arch}"
  [[ "${SKIP_STAGE:-}" == "1" ]] && return 0
  stage_release_init
  local ver="$STAGE_VERSION"
  local dist="$STAGE_DIST"
  echo ""
  echo "=== Staging → github-release/ (keep existing) ==="
  echo "    version ${ver}, arch ${arch}"
  shopt -s nullglob
  if [[ "$arch" == "arm64" ]]; then
    stage_release_copy "kubespade_${ver}_arm64.deb" \
      "$dist/kubespade_${ver}_arm64.deb" \
      "$dist"/kubespade_*_arm64.deb \
      "$dist"/kubespade_*_aarch64.deb
    stage_release_copy "KubeSpade-${ver}-arm64.AppImage" \
      "$dist/KubeSpade-${ver}-arm64.AppImage" \
      "$dist"/KubeSpade-*-arm64.AppImage \
      "$dist"/*-arm64.AppImage \
      "$dist"/*-aarch64.AppImage
  else
    stage_release_copy "kubespade_${ver}_amd64.deb" \
      "$dist/kubespade_${ver}_amd64.deb" \
      "$dist"/kubespade_*_amd64.deb \
      "$dist"/kubespade_*_x64.deb
    stage_release_copy "KubeSpade-${ver}.AppImage" \
      "$dist/KubeSpade-${ver}-x64.AppImage" \
      "$dist/KubeSpade-${ver}-x86_64.AppImage" \
      "$dist/KubeSpade-${ver}.AppImage" \
      "$dist"/KubeSpade-*-x64.AppImage \
      "$dist"/KubeSpade-*-x86_64.AppImage
  fi
  shopt -u nullglob
  stage_release_sha256
  echo "    → $STAGE_OUT"
}
