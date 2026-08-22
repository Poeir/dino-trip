// Loads the Google Maps JavaScript API script once and shares the same
// promise across every DayRouteMap instance on the page (each day card
// mounts its own map, but the <script> tag itself must only be injected
// once or Google Maps logs a "already included" warning and can misbehave).
let loaderPromise = null

export function loadGoogleMaps(apiKey) {
  if (window.google && window.google.maps) return Promise.resolve(window.google.maps)
  if (loaderPromise) return loaderPromise

  loaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`
    script.async = true
    script.onerror = () => {
      loaderPromise = null // let a later render retry instead of staying permanently broken
      reject(new Error('Google Maps script failed to load'))
    }
    script.onload = () => resolve(window.google.maps)
    document.head.appendChild(script)
  })
  return loaderPromise
}
