'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  isNewer,
  pickLatestReleaseForPlatform,
  releaseHasPlatformAssets,
} = require('./appUpdate')

test('isNewer compares semver', () => {
  assert.equal(isNewer('1.2.3', '1.2.2'), true)
  assert.equal(isNewer('1.2.2', '1.2.3'), false)
  assert.equal(isNewer('1.2.2', '1.2.2'), false)
})

test('releaseHasPlatformAssets matches OS installers', () => {
  const linuxOnly = {
    assets: [
      { name: 'kubespade_1.2.3_amd64.deb' },
      { name: 'KubeSpade-1.2.3.AppImage' },
      { name: 'SHA256SUMS.txt' },
    ],
  }
  const macWin = {
    assets: [
      { name: 'KubeSpade-1.2.2-arm64.dmg' },
      { name: 'KubeSpade-Setup-1.2.2.exe' },
    ],
  }
  assert.equal(releaseHasPlatformAssets(linuxOnly, 'linux'), true)
  assert.equal(releaseHasPlatformAssets(linuxOnly, 'darwin'), false)
  assert.equal(releaseHasPlatformAssets(linuxOnly, 'win32'), false)
  assert.equal(releaseHasPlatformAssets(macWin, 'darwin'), true)
  assert.equal(releaseHasPlatformAssets(macWin, 'win32'), true)
  assert.equal(releaseHasPlatformAssets(macWin, 'linux'), false)
})

test('pickLatestReleaseForPlatform skips Linux-only newest tag on macOS', () => {
  const releases = [
    {
      tag_name: 'v1.2.3',
      draft: false,
      prerelease: false,
      assets: [
        { name: 'kubespade_1.2.3_amd64.deb' },
        { name: 'KubeSpade-1.2.3.AppImage' },
      ],
    },
    {
      tag_name: 'v1.2.2',
      draft: false,
      prerelease: false,
      html_url: 'https://github.com/kubespade/kubespade/releases/tag/v1.2.2',
      assets: [
        { name: 'KubeSpade-1.2.2-arm64.dmg' },
        { name: 'KubeSpade-1.2.2.dmg' },
        { name: 'KubeSpade-Setup-1.2.2.exe' },
      ],
    },
  ]
  const mac = pickLatestReleaseForPlatform(releases, 'darwin')
  assert.equal(mac.version, '1.2.2')
  const win = pickLatestReleaseForPlatform(releases, 'win32')
  assert.equal(win.version, '1.2.2')
  const linux = pickLatestReleaseForPlatform(releases, 'linux')
  assert.equal(linux.version, '1.2.3')
})
