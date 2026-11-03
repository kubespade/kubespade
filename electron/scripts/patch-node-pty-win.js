/**
 * Windows-only fixes for node-pty native build (AI terminal).
 *
 * 1. binding.gyp — drop SpectreMitigation (MSB8040 without multi-GB Spectre libs).
 * 2. binding.gyp — /Zc:gotoScope- for winpty.cc (MSVC C2362 goto/cleanup on ARM64).
 * 3. conpty.cc — SDK defines PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE but not PFN* typedefs
 *    (node-pty guard skipped the fallback typedefs → C2065).
 * 4. lib/*.js — load .node from app.asar.unpacked (Electron asarUnpack; relative require breaks).
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ptyRoot = path.join(__dirname, '..', 'node_modules', 'node-pty')
const ASAR_MARKER = 'patch-node-pty-win: asar native'

function patchFile(rel, mutator) {
  const target = path.join(ptyRoot, rel)
  if (!fs.existsSync(target)) return false
  const before = fs.readFileSync(target, 'utf8')
  if (before.includes(ASAR_MARKER)) return false
  const after = mutator(before)
  if (after === before) return false
  writeFile(target, after)
  return true
}

function patchAsarNativePaths() {
  if (!fs.existsSync(ptyRoot)) return

  const helper = `// ${ASAR_MARKER}
function _ptyNativeRequire(rel) {
  var dir = __dirname.replace('app.asar', 'app.asar.unpacked').replace('node_modules.asar', 'node_modules.asar.unpacked');
  return require(require('path').join(dir, rel));
}
`

  if (patchFile('lib/windowsPtyAgent.js', (s) => {
    if (!s.includes("require('../build/Release/conpty.node')")) return s
    s = s.replace('var winptyNative;', `${helper}var winptyNative;`)
    s = s.replace(/require\('\.\.\/build\/Release\/conpty\.node'\)/g, "_ptyNativeRequire('../build/Release/conpty.node')")
    s = s.replace(/require\('\.\.\/build\/Debug\/conpty\.node'\)/g, "_ptyNativeRequire('../build/Debug/conpty.node')")
    s = s.replace(/require\('\.\.\/build\/Release\/pty\.node'\)/g, "_ptyNativeRequire('../build/Release/pty.node')")
    s = s.replace(/require\('\.\.\/build\/Debug\/pty\.node'\)/g, "_ptyNativeRequire('../build/Debug/pty.node')")
    return s
  })) {
    console.log('patch-node-pty-win: windowsPtyAgent.js → app.asar.unpacked natives')
  }

  if (patchFile('lib/windowsConoutConnection.js', (s) => s.replace(
    "var scriptPath = __dirname.replace('node_modules.asar', 'node_modules.asar.unpacked');",
    `// ${ASAR_MARKER}\n        var scriptPath = __dirname.replace('app.asar', 'app.asar.unpacked').replace('node_modules.asar', 'node_modules.asar.unpacked');`,
  ))) {
    console.log('patch-node-pty-win: windowsConoutConnection.js → app.asar.unpacked worker')
  }

  if (patchFile('lib/conpty_console_list_agent.js', (s) => {
    if (!s.includes("require('../build/Release/conpty_console_list.node')")) return s
    const h = `var path = require('path');
// ${ASAR_MARKER}
function _ptyNativeRequire(rel) {
  var dir = __dirname.replace('app.asar', 'app.asar.unpacked').replace('node_modules.asar', 'node_modules.asar.unpacked');
  return require(path.join(dir, rel));
}
`
    s = h + s.replace(
      /var getConsoleProcessList;[\s\S]*?getConsoleProcessList = require\('\.\.\/build\/Debug\/conpty_console_list\.node'\)\.getConsoleProcessList;/,
      `var getConsoleProcessList;
try {
    getConsoleProcessList = _ptyNativeRequire('../build/Release/conpty_console_list.node').getConsoleProcessList;
}
catch (err) {
    getConsoleProcessList = _ptyNativeRequire('../build/Debug/conpty_console_list.node').getConsoleProcessList;
}`,
    )
    return s
  })) {
    console.log('patch-node-pty-win: conpty_console_list_agent.js → app.asar.unpacked')
  }
}

patchAsarNativePaths()

if (process.platform !== 'win32') {
  process.exit(0)
}

const bindingGyp = path.join(ptyRoot, 'binding.gyp')
const conptyCc = path.join(ptyRoot, 'src', 'win', 'conpty.cc')
const winptyCc = path.join(ptyRoot, 'src', 'win', 'winpty.cc')

const WINPTY_GOTO_CLEANUP = `delete filename;
    delete cmdline;
    delete cwd;
    return;`

function clearReadOnlyWin(target) {
  try {
    execSync(`attrib -R "${target}"`, { stdio: 'ignore' })
  } catch {
    /* ignore */
  }
}

function writeFile(target, contents) {
  clearReadOnlyWin(target)
  try {
    fs.writeFileSync(target, contents)
  } catch (err) {
    if (err && err.code === 'EPERM') {
      console.error(`error: cannot write ${target}: ${err.message}`)
      console.error('       Run: attrib -R C:\\...\\electron\\node_modules\\node-pty\\* /S /D')
      process.exit(1)
    }
    throw err
  }
}

if (!fs.existsSync(bindingGyp)) {
  process.exit(0)
}

let changed = false

let gyp = fs.readFileSync(bindingGyp, 'utf8')
const gypBefore = gyp
gyp = gyp.replace(
  /\s*'msvs_configuration_attributes':\s*\{\s*'SpectreMitigation':\s*'Spectre'\s*\},?\n/,
  '\n',
)
if (!gyp.includes('/Zc:gotoScope-')) {
  gyp = gyp.replace(
    "'/guard:cf',\n                '/ZH:SHA_256'",
    "'/guard:cf',\n                '/ZH:SHA_256',\n                '/Zc:gotoScope-'",
  )
}
if (gyp.includes("'target_name': 'pty'") && !/'target_name': 'pty'[\s\S]*?\/Zc:gotoScope-/.test(gyp)) {
  gyp = gyp.replace(
    /('target_name': 'pty',[\s\S]*?'msvs_disabled_warnings': \[ 4506, 4530 \],)/,
    "$1\n          'msvs_settings': {\n            'VCCLCompilerTool': {\n              'AdditionalOptions': ['/Zc:gotoScope-'],\n            },\n          },",
  )
}
if (gyp !== gypBefore) {
  writeFile(bindingGyp, gyp)
  changed = true
  console.log('patch-node-pty-win: updated node-pty/binding.gyp')
}

if (fs.existsSync(conptyCc)) {
  let cc = fs.readFileSync(conptyCc, 'utf8')
  const ccBefore = cc
  const oldGuard = `#ifndef PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
#define PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE \\
  ProcThreadAttributeValue(22, FALSE, TRUE, FALSE)

typedef VOID* HPCON;
typedef HRESULT (__stdcall *PFNCREATEPSEUDOCONSOLE)(COORD c, HANDLE hIn, HANDLE hOut, DWORD dwFlags, HPCON* phpcon);
typedef HRESULT (__stdcall *PFNRESIZEPSEUDOCONSOLE)(HPCON hpc, COORD newSize);
typedef HRESULT (__stdcall *PFNCLEARPSEUDOCONSOLE)(HPCON hpc);
typedef void (__stdcall *PFNCLOSEPSEUDOCONSOLE)(HPCON hpc);

#endif`
  const newGuard = `#ifndef PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
#define PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE \\
  ProcThreadAttributeValue(22, FALSE, TRUE, FALSE)
#endif

#ifndef HPCON
typedef VOID* HPCON;
#endif
#ifndef PFNCREATEPSEUDOCONSOLE
typedef HRESULT (__stdcall *PFNCREATEPSEUDOCONSOLE)(COORD c, HANDLE hIn, HANDLE hOut, DWORD dwFlags, HPCON* phpcon);
typedef HRESULT (__stdcall *PFNRESIZEPSEUDOCONSOLE)(HPCON hpc, COORD newSize);
typedef HRESULT (__stdcall *PFNCLEARPSEUDOCONSOLE)(HPCON hpc);
typedef void (__stdcall *PFNCLOSEPSEUDOCONSOLE)(HPCON hpc);
#endif`
  if (cc.includes(oldGuard)) {
    cc = cc.replace(oldGuard, newGuard)
  }
  if (cc !== ccBefore) {
    writeFile(conptyCc, cc)
    changed = true
    console.log('patch-node-pty-win: fixed conpty.cc SDK typedef guard')
  }
}

if (fs.existsSync(winptyCc)) {
  let wc = fs.readFileSync(winptyCc, 'utf8')
  const wcBefore = wc
  if (wc.includes('goto cleanup') && !wc.includes('patch-node-pty-win: winpty goto fix')) {
    wc = wc.replace(
      `    Nan::ThrowError(why.str().c_str());
    goto cleanup;
  }

  int cols =`,
      `    Nan::ThrowError(why.str().c_str());
    ${WINPTY_GOTO_CLEANUP}
  }

  int cols =`,
    )
    wc = wc.replace(/\s*goto cleanup;\n/g, `\n    ${WINPTY_GOTO_CLEANUP}\n`)
    wc = wc.replace('// patch-node-pty-win: winpty goto fix\n', '')
    wc = `// patch-node-pty-win: winpty goto fix\n${wc}`
  }
  if (wc !== wcBefore) {
    writeFile(winptyCc, wc)
    changed = true
    console.log('patch-node-pty-win: fixed winpty.cc goto/cleanup (MSVC C2362)')
  }
}

if (changed) {
  const buildDir = path.join(ptyRoot, 'build')
  clearReadOnlyWin(buildDir)
  fs.rmSync(buildDir, { recursive: true, force: true })
}
