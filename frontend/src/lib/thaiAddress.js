import { useEffect, useSyncExternalStore } from 'react'

// The province > district > sub-district table is ~240KB of JSON, and only the
// sign-up form, the profile "info" tab and the admin address picker use it. It
// used to be imported statically, which put it in the download of every
// visitor. Now it is a separate chunk, fetched the first time a screen that
// needs it mounts.
const EMPTY = []
let table = null
let loading = null
const listeners = new Set()

export function loadThaiAddress() {
  if (!loading) {
    loading = import('../data/thaiAddress.json').then((m) => {
      table = m.default
      listeners.forEach((notify) => notify())
      return table
    })
    // A failed fetch (offline blip) must not be remembered forever.
    loading.catch(() => { loading = null })
  }
  return loading
}

const subscribe = (notify) => {
  listeners.add(notify)
  return () => listeners.delete(notify)
}
const getSnapshot = () => table ?? EMPTY

/**
 * Returns the table, or [] until it has loaded (then re-renders).
 * `load: false` only subscribes (the app-wide provider reads it for the sign-up
 * form's derived options but must not trigger the download on every page);
 * screens that actually show address pickers use the default and trigger it.
 */
export function useThaiAddress({ load = true } = {}) {
  const data = useSyncExternalStore(subscribe, getSnapshot)
  useEffect(() => {
    if (load && !table) loadThaiAddress().catch(() => {})
  }, [load])
  return data
}
