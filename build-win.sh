#!/bin/bash
# Build Windows installer (.exe NSIS) + portable .exe
# Must run on Windows (Git Bash / MSYS) matching the target arch.
# macOS can cross-compile the Go backend, but not node-pty — a Mac-packaged
# Portable/Setup is missing conpty.node and the AI tab will not start.
#
# Usage:
#   ./build-win.sh                  # x64, version from electron/package.json
#   ./build-win.sh arm64            # Windows on ARM
#   ./build-win.sh arm64 v1.2.0     # set version (leading v OK)
#   ./build-win.sh x64 1.2.0
#
# After a successful build, copies Setup/Portable into github-release/
# without clearing that folder (only ./build-release.sh wipes it).
#
# Code signing:
#   - Uses self-signed cert in certs/windows-codesign.pfx (created once, reused)
#   - Or set CSC_LINK + CSC_KEY_PASSWORD yourself (real OV/EV .pfx)
#   - SKIP_WIN_SIGN=1 to build unsigned
#
# Requires: Node.js, npm, Go; openssl for self-signed cert
# On Windows (native build, especially arm64): Python 3 + VS 2022 Build Tools
#   (C++ workload) — node-pty is rebuilt via node-gyp during npm install.
#   Optional: AUTO_INSTALL_PYTHON=1 to winget-install Python 3.12 before build.
# Optional on macOS: brew install osslsigncode (needed to actually sign)
# Output: dist-electron/*.exe
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=build-common.sh
source "$ROOT/build-common.sh"
load_build_env "$ROOT"
ARCH="${1:-x64}"
VERSION_ARG="${2:-}"

CERT_DIR="${ROOT}/certs"
PFX="${CERT_DIR}/windows-codesign.pfx"
PFX_PASS_FILE="${CERT_DIR}/windows-codesign.password"
# Local-dev only — not a secret for public trust; keeps rebuilds deterministic.
DEFAULT_PFX_PASS="kubespade-local-dev"

case "$ARCH" in
  x64|amd64) GOARCH=amd64; EB_ARCH=x64 ;;
  arm64)     GOARCH=arm64; EB_ARCH=arm64 ;;
  -h|--help)
    sed -n '2,20p' "$0"
    exit 0
    ;;
  *)
    echo "Usage: $0 [x64|arm64] [version]" >&2
    echo "  version optional, e.g. 1.2.0 or v1.2.0 (updates electron/package.json)" >&2
    exit 1
    ;;
esac

apply_pkg_version_arg "$VERSION_ARG"

is_windows_host() {
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
  esac
  [[ "${OS:-}" == "Windows_NT" ]]
}

# Native node-pty (conpty.node / pty.node) cannot be cross-compiled from macOS/Linux.
# A Mac-packaged Windows x64 Portable looks fine but AI fails: Cannot find module conpty.node.
if ! is_windows_host && [[ "${FORCE_WIN_CROSS:-}${FORCE_WIN_ARM64:-}" != *1* ]]; then
  echo "error: Windows ${EB_ARCH} needs a Windows ${EB_ARCH} host (node-pty / node-gyp cannot cross-compile)." >&2
  echo "       Mac/Linux packages omit conpty.node — the in-app AI tab will not start." >&2
  echo "       Build on Windows ${EB_ARCH}. Override (AI broken): FORCE_WIN_CROSS=1 $0 ${ARCH}" >&2
  exit 1
fi

find_vswhere() {
  local c
  for c in \
    "/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe" \
    "/c/Program Files/Microsoft Visual Studio/Installer/vswhere.exe"; do
    if [[ -f "$c" ]]; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

# Pick a Visual Studio node-gyp can use. Do not force 2022 unless it is installed —
# forcing 2022 when only VS 2025 (18) exists yields "Could not find any Visual Studio".
find_vs_cpp_install() {
  local vswhere="$1" version_range="$2" req inst
  for req in \
    Microsoft.VisualStudio.Component.VC.Tools.ARM64 \
    Microsoft.VisualStudio.Component.VC.Tools.x86.x64 \
    Microsoft.VisualStudio.Workload.VCTools; do
    inst="$("$vswhere" -version "$version_range" -latest -products \* \
      -requires "$req" -property installationPath 2>/dev/null || true)"
    if [[ -n "$inst" ]]; then
      echo "$inst"
      return 0
    fi
  done
  # WoA often has ARM64-only toolsets — accept latest Build Tools / VS in range.
  inst="$("$vswhere" -version "$version_range" -latest -products \* \
    -property installationPath 2>/dev/null || true)"
  if [[ -n "$inst" ]]; then
    echo "$inst"
    return 0
  fi
  return 1
}

configure_win_msvs_for_node_gyp() {
  local vswhere inst
  vswhere="$(find_vswhere)" || return 1

  # VS 2022 (17.x)
  inst="$(find_vs_cpp_install "$vswhere" "[17,18)" || true)"
  if [[ -n "$inst" ]]; then
    export GYP_MSVS_VERSION=2022
    echo "    node-gyp: Visual Studio 2022 (${inst})"
    return 0
  fi

  # VS 2025 / 18.x — auto-detect (needs MSVC v145 ARM64 tools if building on WoA).
  inst="$(find_vs_cpp_install "$vswhere" "[18,19)" || true)"
  if [[ -n "$inst" ]]; then
    unset GYP_MSVS_VERSION npm_config_msvs_version || true
    echo "    node-gyp: Visual Studio 2025 (${inst}) — auto-detect"
    return 0
  fi

  echo "    node-gyp: no Visual Studio with C++ tools found. Installations on this machine:"
  "$vswhere" -all -products \* -property displayName,installationPath,catalog_productLineVersion 2>/dev/null \
    | sed 's/^/      /' || true
  return 1
}

# node-gyp (node-pty) on Windows needs Python 3 + MSVC. Fail early with install hints.
ensure_win_node_gyp_prereqs() {
  is_windows_host || return 0

  local py=""
  if [[ -n "${PYTHON:-}" ]] && "$PYTHON" -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" 2>/dev/null; then
    py="$PYTHON"
  elif command -v python >/dev/null 2>&1 && python -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" 2>/dev/null; then
    py="$(command -v python)"
  elif command -v python3 >/dev/null 2>&1 && python3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" 2>/dev/null; then
    py="$(command -v python3)"
  elif command -v py >/dev/null 2>&1; then
    py="$(py -3 -c "import sys; print(sys.executable)" 2>/dev/null || true)"
  fi

  if [[ -z "$py" ]]; then
    if [[ "${AUTO_INSTALL_PYTHON:-}" == "1" ]] && command -v winget >/dev/null 2>&1; then
      echo "    Python not found — AUTO_INSTALL_PYTHON=1, installing via winget..."
      winget install -e --id Python.Python.3.12 \
        --accept-package-agreements --accept-source-agreements || true
      # Refresh PATH in this shell (winget adds Python to user PATH).
      export PATH="${LOCALAPPDATA}/Programs/Python/Python312:${LOCALAPPDATA}/Programs/Python/Python312/Scripts:${PATH}"
      if command -v python >/dev/null 2>&1; then
        py="$(command -v python)"
      elif command -v py >/dev/null 2>&1; then
        py="$(py -3 -c "import sys; print(sys.executable)" 2>/dev/null || true)"
      fi
    fi
  fi

  if [[ -z "$py" ]]; then
    echo "error: Python 3.8+ required on Windows to rebuild node-pty (AI terminal)." >&2
    echo "       Install (cmd.exe, then open a new terminal):" >&2
    echo "         winget install -e --id Python.Python.3.12" >&2
    echo "       Check \"Add python.exe to PATH\" in the installer." >&2
    echo "       Also install VS 2022 Build Tools with \"Desktop development with C++\":" >&2
    echo "         winget install -e --id Microsoft.VisualStudio.2022.BuildTools" >&2
    echo "       Or re-run with: AUTO_INSTALL_PYTHON=1 $0 ${ARCH}${VERSION_ARG:+ }${VERSION_ARG}" >&2
    echo "       If files are read-only after copy from Mac: cmd //c \"attrib -R * /S /D\"" >&2
    exit 1
  fi

  export PYTHON="$py"
  echo "    node-gyp: PYTHON=${PYTHON}"

  if ! configure_win_msvs_for_node_gyp; then
    echo "error: Visual Studio Build Tools with C++ workload required for node-pty." >&2
    echo "       winget alone often installs the shell without C++. In cmd.exe run:" >&2
    echo "         winget install -e --id Microsoft.VisualStudio.2022.BuildTools --override \"--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended\"" >&2
    echo "       Then open Visual Studio Installer → Modify → Individual components →" >&2
    echo "       \"MSVC v143 - VS 2022 C++ ARM64 build tools\" (required on Windows ARM)." >&2
    echo "       Open a new terminal and re-run." >&2
    exit 1
  fi

  if command -v where >/dev/null 2>&1; then
    if ! where cl >/dev/null 2>&1; then
      echo "    note: cl.exe not on PATH (normal in Git Bash — node-gyp locates MSBuild via vswhere)."
    fi
  fi
}

# electron-builder reads package.json from cwd. Always use the copy already
# installed under electron/ — never npx (that prompts and may download a
# second tree, then look for package.json in whatever directory we left).
run_electron_builder() {
  local eb="$ROOT/electron/node_modules/electron-builder/cli.js"
  if [[ ! -f "$eb" ]]; then
    echo "error: electron-builder missing: $eb" >&2
    echo "       Run: cd electron && npm install" >&2
    exit 1
  fi
  node "$eb" "$@"
}

# node-pty .node must exist before electron-builder or AI terminal breaks (asarUnpack).
# Subshell so we never leave the caller sitting in $ROOT (packager needs electron/).
ensure_win_electron_native_deps() {
  is_windows_host || return 0

  local conpty="$ROOT/electron/node_modules/node-pty/build/Release/conpty.node"
  echo "    Patching node-pty + portable NSIS..."
  (
    cd "$ROOT/electron"
    node scripts/patch-node-pty-win.js
    node scripts/patch-portable-win.js

    if [[ -f "$conpty" && "${FORCE_NODE_PTY_REBUILD:-}" != "1" ]]; then
      echo "    node-pty already built: $conpty"
      ls -lh "$conpty"
      exit 0
    fi

    echo "    Rebuilding node-pty for Electron (AI terminal)..."
    # install-app-deps.js is a no-op stub (never calls main()) — go through cli.js.
    run_electron_builder install-app-deps --arch="${EB_ARCH}"
  )

  if [[ ! -f "$conpty" ]]; then
    echo "error: node-pty conpty.node missing after rebuild:" >&2
    echo "       $conpty" >&2
    echo "       Need VS 2022 Build Tools with MSVC v143 ARM64 C++ on Windows ARM." >&2
    echo "       Do not use SKIP_DEPS=1 unless node-pty was built successfully once." >&2
    ls -la "$ROOT/electron/node_modules/node-pty/build/Release/" 2>/dev/null >&2 || true
    exit 1
  fi
}

verify_packaged_node_pty() {
  local subdir="win-unpacked"
  [[ "$EB_ARCH" == "arm64" ]] && subdir="win-arm64-unpacked"
  local release="$ROOT/dist-electron/${subdir}/resources/app.asar.unpacked/node_modules/node-pty/build/Release"
  local conpty="$release/conpty.node"
  local winpty="$release/pty.node"
  if [[ -f "$conpty" && -f "$winpty" ]]; then
    echo "    packaged AI natives OK:"
    ls -lh "$conpty" "$winpty"
    return 0
  fi
  echo "error: electron-builder output missing node-pty Windows natives:" >&2
  echo "       $release" >&2
  ls -la "$release" 2>/dev/null >&2 || true
  echo "       Build on Windows ${EB_ARCH} (not macOS). Mac packages have no conpty.node — AI will not start." >&2
  echo "       Re-run without SKIP_DEPS=1 or FORCE_NODE_PTY_REBUILD=1 ./build-win.sh ${ARCH}" >&2
  exit 1
}

ensure_self_signed_cert() {
  mkdir -p "${CERT_DIR}"
  chmod 700 "${CERT_DIR}" 2>/dev/null || true

  if [[ -f "${PFX}" ]]; then
    echo "    Reusing existing certificate: ${PFX}"
    if [[ ! -f "${PFX_PASS_FILE}" ]]; then
      # Older/manual pfx without password file — fall back to default and write it.
      printf '%s' "${DEFAULT_PFX_PASS}" > "${PFX_PASS_FILE}"
      chmod 600 "${PFX_PASS_FILE}" 2>/dev/null || true
      echo "    (no password file — wrote default to ${PFX_PASS_FILE}; override if your .pfx uses another password)"
    fi
    return 0
  fi

  if ! command -v openssl >/dev/null 2>&1; then
    echo "error: openssl not found; needed to create a self-signed code-signing cert" >&2
    exit 1
  fi

  echo "    Creating self-signed code-signing certificate (one-time)..."
  local key="${CERT_DIR}/windows-codesign.key"
  local crt="${CERT_DIR}/windows-codesign.crt"

  openssl req -x509 -newkey rsa:4096 -sha256 -days 825 \
    -keyout "${key}" -out "${crt}" -nodes \
    -subj "/CN=KubeSpade/O=KubeSpade/C=US" \
    >/dev/null 2>&1

  printf '%s' "${DEFAULT_PFX_PASS}" > "${PFX_PASS_FILE}"
  chmod 600 "${PFX_PASS_FILE}" "${key}" 2>/dev/null || true

  openssl pkcs12 -export -out "${PFX}" \
    -inkey "${key}" -in "${crt}" \
    -passout "file:${PFX_PASS_FILE}" \
    >/dev/null 2>&1

  chmod 600 "${PFX}" 2>/dev/null || true
  echo "    -> ${PFX}"
  echo "    Password file: ${PFX_PASS_FILE}"
}

setup_signing() {
  if [[ "${SKIP_WIN_SIGN:-}" == "1" ]]; then
    echo "    SKIP_WIN_SIGN=1 — building unsigned"
    export CSC_IDENTITY_AUTO_DISCOVERY=false
    unset CSC_LINK CSC_KEY_PASSWORD WIN_CSC_LINK WIN_CSC_KEY_PASSWORD || true
    return 0
  fi

  # Real cert from env wins over self-signed local file.
  if [[ -n "${CSC_LINK:-}" || -n "${WIN_CSC_LINK:-}" ]]; then
    echo "    Using certificate from CSC_LINK / WIN_CSC_LINK"
    if [[ -z "${CSC_KEY_PASSWORD:-}${WIN_CSC_KEY_PASSWORD:-}" ]]; then
      echo "error: CSC_LINK set but CSC_KEY_PASSWORD (or WIN_CSC_KEY_PASSWORD) is empty" >&2
      exit 1
    fi
    unset CSC_IDENTITY_AUTO_DISCOVERY || true
    return 0
  fi

  ensure_self_signed_cert
  export CSC_LINK="${PFX}"
  CSC_KEY_PASSWORD="$(cat "${PFX_PASS_FILE}")"
  export CSC_KEY_PASSWORD
  unset CSC_IDENTITY_AUTO_DISCOVERY || true

  if [[ "$(uname -s)" == "Darwin" ]] && ! command -v osslsigncode >/dev/null 2>&1; then
    echo "    warning: osslsigncode not found — signing on macOS may fail."
    echo "             Install: brew install osslsigncode"
  fi
}

echo "=== 1/4  Code signing certificate ==="
setup_signing

echo ""
echo "=== 2/4  Frontend ==="
build_frontend

echo ""
# CGO off for pure Go cross-compile from macOS/Linux.
# windowsHide on spawn hides the console; avoid -H windowsgui — GUI subsystem
# can drop/break stdout pipes to Electron on Windows ARM64.
echo "=== 3/4  Backend ==="
build_backend windows "$GOARCH" k8s-client-backend.exe

echo ""
echo "=== 4/4  Building Electron (Windows ${EB_ARCH}) ==="
ensure_win_node_gyp_prereqs
cd "$ROOT/electron"
if [[ "${SKIP_DEPS:-}" != "1" ]]; then
  npm install
fi
ensure_win_electron_native_deps
# Helper uses a subshell; stay in electron/ so packager finds package.json here.
cd "$ROOT/electron"

# Stale dual-arch output makes portable pick the wrong CPU arch on WoA.
if [[ "$EB_ARCH" == "arm64" ]]; then
  rm -rf "$ROOT/dist-electron/win-unpacked"
else
  rm -rf "$ROOT/dist-electron/win-arm64-unpacked"
fi

# Self-signed Authenticode + embedded ASAR integrity can prevent startup (no JS, no log).
EB_EXTRA=()
if [[ "${SKIP_WIN_SIGN:-}" == "1" || "${CSC_LINK:-}" == *"certs/windows-codesign.pfx" || -z "${CSC_LINK:-}${WIN_CSC_LINK:-}" ]]; then
  EB_EXTRA+=(--config.disableAsarIntegrity=true)
fi

# WoA: portable extracts to LocalAppData (patched portable.nsi — see patch-portable-win.js).
run_electron_builder --win "nsis:${EB_ARCH}" "portable:${EB_ARCH}" "${EB_EXTRA[@]}"

verify_packaged_node_pty

# Append into github-release/ (does not wipe — only build-release.sh clears it).
# SKIP_STAGE=1 when called from build-release.sh (it stages itself).
# shellcheck source=stage-github-release.sh
source "$ROOT/stage-github-release.sh"
stage_windows_to_github_release "$EB_ARCH"

echo ""
echo "=== Done! ==="
echo "    Artifacts in: ${ROOT}/dist-electron/"
ls -lh "${ROOT}/dist-electron/"*.exe 2>/dev/null || ls -lh "${ROOT}/dist-electron/"
echo ""
echo "    Notes:"
echo "    - NSIS installer:  KubeSpade Setup *.exe"
echo "    - Portable:        KubeSpade-Portable-*-${EB_ARCH}.exe"
if [[ "${SKIP_WIN_SIGN:-}" == "1" ]]; then
  echo "    - Unsigned (SKIP_WIN_SIGN=1) — SmartScreen will warn"
else
  echo "    - Signed with: ${CSC_LINK:-${WIN_CSC_LINK}}"
  if [[ "${CSC_LINK:-}" == *"certs/windows-codesign.pfx" ]]; then
    echo "    - Self-signed local cert (reused if present). SmartScreen may still warn."
    echo "    - For public downloads use a real OV/EV via CSC_LINK + CSC_KEY_PASSWORD"
  fi
  echo "    - Opt out of signing: SKIP_WIN_SIGN=1 ./build-win.sh"
fi
echo "    - Smoke-test on a real Windows machine before shipping"
echo "    - Staged (no wipe): ${ROOT}/github-release/"
