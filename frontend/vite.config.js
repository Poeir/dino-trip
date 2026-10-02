import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
})
