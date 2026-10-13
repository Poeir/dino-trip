import { useEffect } from 'react'

// Per-page <title>, description, canonical and share-card tags for the SPA.
// index.html carries the site-wide defaults; a page that calls useSeo()
// overrides them while it's mounted and the defaults are restored on unmount.
//
// This is what browsers and JS-capable crawlers see. Crawlers that don't run
// JavaScript (LINE/Facebook link previews, most bots) are served a
// server-rendered page instead -- see backend/src/lib/seo.js and the bot
// matcher in deploy/caddy/Caddyfile. Keep the title/description formats in sync.

export const SITE_NAME = 'Dino เที่ยวขอนแก่น'
const MAX_DESCRIPTION = 155

// [attribute, value] of every <meta> a page may override.
const TAGS = [
  ['name', 'description'],
  ['property', 'og:title'],
  ['property', 'og:description'],
  ['property', 'og:url'],
  ['property', 'og:image'],
  ['name', 'twitter:title'],
  ['name', 'twitter:description'],
  ['name', 'twitter:image'],
  ['name', 'robots'],
]

export function truncate(text, max = MAX_DESCRIPTION) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

let defaults = null // what index.html shipped with, captured before the first override

function readMeta(attr, key) {
  return document.head.querySelector(`meta[${attr}="${key}"]`)?.getAttribute('content') ?? null
}

function writeMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`)
  if (content == null) { el?.remove(); return }
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function setCanonical(href) {
  let el = document.head.querySelector('link[rel="canonical"]')
  if (!href) { el?.remove(); return }
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

function snapshotDefaults() {
  if (defaults) return
  defaults = {
    title: document.title,
    canonical: document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    meta: Object.fromEntries(TAGS.map(([attr, key]) => [`${attr}:${key}`, readMeta(attr, key)])),
  }
}

function restoreDefaults() {
  if (!defaults) return
  document.title = defaults.title
  setCanonical(defaults.canonical)
  for (const [attr, key] of TAGS) writeMeta(attr, key, defaults.meta[`${attr}:${key}`])
}

/**
 * useSeo({ title, description, image, path, noindex })
 * `title` is the page-specific part ("วัดหนองแวง"); the site name is appended.
 * Without a title (e.g. data still loading) the hook does nothing.
 */
export function useSeo({ title, description, image, path, noindex } = {}) {
  useEffect(() => {
    if (!title) return undefined
    snapshotDefaults()

    const origin = window.location.origin
    const url = `${origin}${path ?? window.location.pathname}`
    const fullTitle = `${title} | ${SITE_NAME}`
    const desc = description ? truncate(description) : null
    const imageUrl = image ? (/^https?:\/\//i.test(image) ? image : `${origin}${image}`) : null

    document.title = fullTitle
    setCanonical(url)
    writeMeta('property', 'og:title', fullTitle)
    writeMeta('name', 'twitter:title', fullTitle)
    writeMeta('property', 'og:url', url)
    if (desc) {
      writeMeta('name', 'description', desc)
      writeMeta('property', 'og:description', desc)
      writeMeta('name', 'twitter:description', desc)
    }
    if (imageUrl) {
      writeMeta('property', 'og:image', imageUrl)
      writeMeta('name', 'twitter:image', imageUrl)
    }
    if (noindex) writeMeta('name', 'robots', 'noindex, nofollow')

    return restoreDefaults
  }, [title, description, image, path, noindex])
}
