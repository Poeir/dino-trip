import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// One version for the whole system: the repo-root VERSION file. Docker builds
// pass it in as VITE_APP_VERSION (the build context there is only frontend/);
// a build with neither falls back to this package's own version.
function readVersion() {
  for (const read of [
    () => readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim(),
    () => JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version,
  ]) {
    try { return read() } catch { /* try the next source */ }
  }
  return 'dev'
}
const appVersion = process.env.VITE_APP_VERSION || readVersion()

// index.html carries absolute canonical / Open Graph URLs (link-preview
// crawlers don't resolve relative ones). Fill the %SITE_URL% token from
// VITE_SITE_URL at build time; unset (local dev) it becomes empty, i.e.
// same-origin relative URLs, which is fine there.
const siteUrl = (process.env.VITE_SITE_URL || '').replace(/\/+$/, '')
const siteUrlPlugin = {
  name: 'site-url-in-html',
  transformIndexHtml: { order: 'pre', handler: (html) => html.replaceAll('%SITE_URL%', siteUrl) },
}

export default defineConfig({
  plugins: [react(), siteUrlPlugin],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __GIT_SHA__: JSON.stringify(process.env.VITE_GIT_SHA || ''),
  },
  build: {
    rollupOptions: {
      output: {
        // React and the router change rarely; keeping them in their own file means
        // a deploy that only touches app code doesn't invalidate visitors' cached copy.
        manualChunks: { 'react-vendor': ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
})
