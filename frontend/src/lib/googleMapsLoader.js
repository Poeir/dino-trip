// Loads the Google Maps JavaScript API script once and shares the same
// promise across every DayRouteMap/LocationPicker instance on the page (each
// mounts its own map, but the <script> tag itself must only be injected once
// or Google Maps logs a "already included" warning and can misbehave).
//
// Always requests the `places` library alongside core Maps -- LocationPicker
// needs it for address/venue Autocomplete and DayRouteMap doesn't mind the
// extra library being present. Requires "Places API" enabled on the same GCP
// project as VITE_GOOGLE_MAPS_API_KEY (see frontend/.env.example).
let loaderPromise = null

export function loadGoogleMaps(apiKey) {
  if (window.google && window.google.maps) return Promise.resolve(window.google.maps)
  if (loaderPromise) return loaderPromise

  loaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`
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
