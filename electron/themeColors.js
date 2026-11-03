'use strict'

/** Shared chrome colors — title bar and update popup stay in sync. */
const CHROME = {
  darkBg: '#0a0e14',
  darkFg: '#e8eef6',
  lightBg: '#e8edf4',
  lightFg: '#121821',
}

function chromeColors(dark) {
  return dark
    ? { color: CHROME.darkBg, symbolColor: CHROME.darkFg, backgroundColor: CHROME.darkBg }
    : { color: CHROME.lightBg, symbolColor: CHROME.lightFg, backgroundColor: CHROME.lightBg }
}

function windowBackground(dark) {
  return dark ? CHROME.darkBg : CHROME.lightBg
}

module.exports = { CHROME, chromeColors, windowBackground }
