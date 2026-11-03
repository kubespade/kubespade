'use strict'

const path = require('path')
const { signAsync } = require('@electron/osx-sign')

const app = process.argv[2]
const identity = process.argv[3]

if (!app || !identity) {
  console.error('usage: sign-mac-app.js <KubeSpade.app> <Developer ID identity>')
  process.exit(1)
}

const electronDir = path.join(__dirname, '..')

signAsync({
  app,
  identity,
  hardenedRuntime: true,
  entitlements: path.join(electronDir, 'entitlements.mac.plist'),
  entitlementsInherit: path.join(electronDir, 'entitlements.mac.inherit.plist'),
})
  .then(() => {
    console.log(`signed ${app}`)
  })
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
