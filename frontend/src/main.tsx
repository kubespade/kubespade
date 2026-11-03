import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initPersistentStore } from './lib/persistentStore'
import { applyUiTheme, readStoredUiTheme } from './lib/uiTheme'
import './App.css'

// Apply theme before first paint (same as iPad).
applyUiTheme(readStoredUiTheme())

void initPersistentStore().finally(() => {
  // Re-apply after prefs hydrate in case disk has a newer theme.
  applyUiTheme(readStoredUiTheme())
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
