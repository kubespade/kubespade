'use strict'

const RELEASES_LIST = 'https://api.github.com/repos/kubespade/kubespade/releases?per_page=20'
const DOWNLOAD_PAGE = 'https://kubespade.com/download.html'
const FETCH_MS = 8000

function normalizeVersion(s) {
  return String(s || '').trim().replace(/^v/i, '')
}

function parseSemver(s) {
  const m = normalizeVersion(s).match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function isNewer(latest, current) {
  const a = parseSemver(latest)
  const b = parseSemver(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return false
}

function withTimeout(promise, ms) {
  let t
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error('update check timed out')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t))
}

/**
 * Asset name patterns per OS. Linux-only releases (e.g. 1.2.3) must not
 * trigger an update prompt on macOS / Windows.
 */
function platformAssetPatterns(platform = process.platform) {
  switch (platform) {
    case 'darwin':
      return [/\.dmg$/i]
    case 'win32':
      return [/\.exe$/i]
    case 'linux':
      return [/\.deb$/i, /\.AppImage$/i]
    default:
      return []
  }
}

function releaseHasPlatformAssets(release, platform = process.platform) {
  const assets = Array.isArray(release?.assets) ? release.assets : []
  const patterns = platformAssetPatterns(platform)
  if (patterns.length === 0) return false
  return assets.some(a => {
    const name = typeof a?.name === 'string' ? a.name : ''
    return patterns.some(re => re.test(name))
  })
}

/**
 * Newest published release that includes installers for this OS.
 * GitHub returns releases newest-first.
 */
function pickLatestReleaseForPlatform(releases, platform = process.platform) {
  if (!Array.isArray(releases)) return null
  for (const rel of releases) {
    if (!rel || rel.draft || rel.prerelease) continue
    if (!releaseHasPlatformAssets(rel, platform)) continue
    const version = normalizeVersion(rel.tag_name || rel.name)
    if (!parseSemver(version)) continue
    return { version, release: rel }
  }
  return null
}

/**
 * Compare the running app to the latest public GitHub release that ships
 * builds for this OS. Does not download or install.
 */
async function checkAppUpdate(currentVersion, platform = process.platform) {
  const current = normalizeVersion(currentVersion)
  const res = await withTimeout(
    fetch(RELEASES_LIST, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'KubeSpade-Desktop',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }),
    FETCH_MS,
  )
  if (!res.ok) {
    throw new Error(`GitHub ${res.status}`)
  }
  const releases = await res.json()
  const picked = pickLatestReleaseForPlatform(releases, platform)
  const latest = picked?.version || current
  const releaseUrl = picked?.release?.html_url
  const releaseNotes = typeof picked?.release?.body === 'string'
    ? picked.release.body.trim()
    : ''
  return {
    current,
    latest,
    updateAvailable: picked ? isNewer(latest, current) : false,
    releaseUrl: typeof releaseUrl === 'string' && releaseUrl
      ? releaseUrl
      : 'https://github.com/kubespade/kubespade/releases',
    downloadUrl: DOWNLOAD_PAGE,
    releaseNotes,
  }
}

module.exports = {
  checkAppUpdate,
  isNewer,
  normalizeVersion,
  pickLatestReleaseForPlatform,
  platformAssetPatterns,
  releaseHasPlatformAssets,
}
