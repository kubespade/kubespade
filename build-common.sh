#!/bin/bash
# Shared helpers for build-mac/win/linux/release. Source after ROOT=… is set.
#
# shellcheck disable=SC2034

get_pkg_version() {
  local file="${1:?package.json path}"
  node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).version)" "$file"
}

# Write package.json "version". Optional 2nd arg = version (default: $VERSION).
set_pkg_version() {
  local file="${1:?package.json path}"
  local ver="${2:-${VERSION:?VERSION unset}}"
  local win_hint=0
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*) win_hint=1 ;;
  esac
  [[ "${OS:-}" == "Windows_NT" ]] && win_hint=1
  node - "$file" "$ver" "$win_hint" <<'JS'
const fs = require('fs')
const [path, ver, winHint] = process.argv.slice(2)
try {
  const data = JSON.parse(fs.readFileSync(path, 'utf8'))
  data.version = ver
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
} catch (err) {
  console.error(`error: cannot write ${path}: ${err.message}`)
  if (winHint === '1') {
    console.error('       On Windows try: attrib -R electron\\package.json')
    console.error('       Close editors locking the file, then re-run.')
  }
  process.exit(1)
}
JS
}

# Load $ROOT/.env if present (same semantics as release_load_env).
load_build_env() {
  local root="${1:-${ROOT:?ROOT unset}}"
  if [[ -f "$root/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$root/.env"
    set +a
  fi
}

# Apply VERSION_ARG to electron/package.json when set (leading v stripped by caller).
apply_pkg_version_arg() {
  local version_arg="${1:-}"
  local pkg="${ROOT:?}/electron/package.json"
  if [[ -z "$version_arg" ]]; then
    return 0
  fi
  local ver="${version_arg#v}"
  if [[ ! "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.]+)?$ ]]; then
    echo "error: version must look like 1.2.0 or v1.2.0 (got: $version_arg)" >&2
    exit 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "error: node not found (needed to set package.json version)" >&2
    exit 1
  fi
  local cur
  cur="$(get_pkg_version "$pkg")"
  if [[ "$cur" == "$ver" ]]; then
    echo "    electron/package.json version already ${ver}"
  else
    set_pkg_version "$pkg" "$ver"
    echo "    electron/package.json version → ${ver}"
  fi
  VERSION="$ver"
}

# Standard frontend → backend/dist copy (mac/win). Linux may use its own install path.
build_frontend() {
  if [[ "${SKIP_FRONTEND:-}" == "1" ]]; then
    echo "=== Building frontend skipped ==="
    return 0
  fi
  echo "=== Building frontend ==="
  cd "${ROOT:?}/frontend"
  if [[ "${SKIP_DEPS:-}" != "1" ]]; then
    npm install
  fi
  npm run build
  rm -rf "$ROOT/backend/dist"
  cp -r dist "$ROOT/backend/dist"
}

# Cross/native Go backend. Args: GOOS GOARCH output-name (relative to backend/).
build_backend() {
  local goos="${1:?GOOS}"
  local goarch="${2:?GOARCH}"
  local out="${3:?output binary name}"
  echo "=== Building backend (Go → ${goos}/${goarch}) ==="
  cd "${ROOT:?}/backend"
  echo "    Syncing dependencies…"
  go mod tidy
  echo "    Building ${goos}/${goarch}…"
  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
    go build -buildvcs=false -ldflags="-s -w" -o "$out" .
  echo "    → ${ROOT}/backend/${out}"
  ls -lh "${ROOT}/backend/${out}" || true
  file "${ROOT}/backend/${out}" 2>/dev/null || true
}
