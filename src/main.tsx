import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import App from './App'
import './app.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const wasControlled = Boolean(navigator.serviceWorker.controller)
    const reloadGuard = 'scpo-connect-update-reload'
    sessionStorage.removeItem(reloadGuard)
    if (wasControlled) navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (sessionStorage.getItem(reloadGuard)) return
      sessionStorage.setItem(reloadGuard, '1')
      window.location.reload()
    }, { once: true })
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((registration) => {
      void registration.update()
      const announceUpdate = () => window.dispatchEvent(new CustomEvent('scpo-app-update-ready'))
      if (registration.waiting) announceUpdate()
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) announceUpdate()
        })
      })
      const updateTimer = window.setInterval(() => {
        if (document.visibilityState === 'visible' && navigator.onLine) void registration.update().catch(() => undefined)
      }, 60_000)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) void registration.update().catch(() => undefined)
      })
      window.addEventListener('online', () => void registration.update().catch(() => undefined))
      window.addEventListener('pagehide', () => window.clearInterval(updateTimer), { once: true })
      window.addEventListener('scpo-app-update-activate', () => {
        if (!registration.waiting) return
        registration.waiting.postMessage({ type: 'SKIP_WAITING' })
      })
    }).catch(() => undefined)
  })
}
