/**
 * electron-builder Windows NSIS/portable patches:
 * 1. Custom portable.nsi (LocalAppData unpack, ARM64 File /r).
 * 2. NSIS installer: File /r unpacked dir instead of Nsis7z (x86 7z plugin
 *    on Windows ARM64 often extracts pak/dat but not KubeSpade.exe / .dll).
 */
'use strict'

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const nm = path.join(root, 'node_modules', 'app-builder-lib')

function patchPortableNsi() {
  const src = path.join(root, 'build', 'portable.nsi')
  const dest = path.join(nm, 'templates', 'nsis', 'portable.nsi')
  if (!fs.existsSync(src)) {
    console.error('patch-portable-win: missing', src)
    process.exit(1)
  }
  if (!fs.existsSync(path.dirname(dest))) return
  fs.copyFileSync(src, dest)
  console.log('patch-portable-win: installed build/portable.nsi')
}

function patchNsisBuiltInCompressor() {
  const dest = path.join(nm, 'out', 'targets', 'nsis', 'NsisTarget.js')
  if (!fs.existsSync(dest)) return
  let js = fs.readFileSync(dest, 'utf8')
  const from = 'const USE_NSIS_BUILT_IN_COMPRESSOR = false;'
  const to = 'const USE_NSIS_BUILT_IN_COMPRESSOR = true; // kubespade: File /r, skip Nsis7z on WoA'
  if (!js.includes(from)) {
    if (js.includes('USE_NSIS_BUILT_IN_COMPRESSOR = true')) {
      return
    }
    console.warn('patch-portable-win: USE_NSIS_BUILT_IN_COMPRESSOR not found — skip')
    return
  }
  fs.writeFileSync(dest, js.replace(from, to))
  console.log('patch-portable-win: NSIS uses built-in File /r (not Nsis7z)')
}

try {
  patchPortableNsi()
  patchNsisBuiltInCompressor()
} catch (err) {
  console.error('patch-portable-win:', err.message)
  process.exit(1)
}
