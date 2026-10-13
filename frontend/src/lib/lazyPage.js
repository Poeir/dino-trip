import { lazy } from 'react'

// React.lazy for route-level code splitting, hardened for deploys.
//
// A deploy replaces the content-hashed chunk files. A tab that was opened
// before it still asks for the old names; they no longer exist (and the SPA
// fallback answers with index.html), so the dynamic import rejects and the
// page would just go blank. Reload once to pick up the new build; the
// timestamp guard stops a genuinely broken chunk from looping forever.
const RELOAD_KEY = 'dino.chunkReloadAt'
const RELOAD_GUARD_MS = 10_000

export function lazyPage(load) {
  return lazy(() => load().catch((err) => {
    try {
      const last = Number(window.sessionStorage.getItem(RELOAD_KEY) || 0)
      if (Date.now() - last > RELOAD_GUARD_MS) {
        window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
        window.location.reload()
        return new Promise(() => {}) // stay on the loading fallback while the reload happens
      }
    } catch {
      // storage unavailable: fall through and surface the error
    }
    throw err
  }))
}
