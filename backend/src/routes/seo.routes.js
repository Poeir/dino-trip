import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { db } from '../lib/db.js'
import { rowToPlace, rowToEvent, eventTimeStatus } from '../lib/mappers.js'
import { attachUploadedPhotos } from './places.routes.js'
import { attachEventPhotos } from './events.routes.js'
import * as seo from '../lib/seo.js'

// Crawler-facing endpoints, mounted at the root (not under /api) in app.js:
//   GET /robots.txt, /sitemap.xml   -- plain files, routed here by Caddy
//   GET /api/seo/page/<site path>   -- a server-rendered page for one public
//     URL. Caddy rewrites a request here only when the User-Agent is a known
//     crawler / link-preview bot (see deploy/caddy/Caddyfile); people get the SPA.
export const seoRouter = Router()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const PLACE_COLUMNS = 'id, name, category, rating, review_count, price, address, district, hours, phone, website, maps_url, lat, lng, description, amenities, tags, img, images, is_active, updated_at'
const PLACE_LIST_COLUMNS = ['id', 'name', 'category', 'district', 'rating']
const EVENT_COLUMNS = 'id, name, category, date_range, venue_name, admission, organizer, suitable_for, description, status, event_start_date, event_end_date, img'
const EVENT_LIST_COLUMNS = ['id', 'name', 'date_range', 'venue_name', 'status', 'event_start_date', 'event_end_date']

// Tiny TTL cache so a crawler fetching every page doesn't hit the DB each
// time. Bounded: the keys are request paths, which a client controls.
const CACHE_MAX_ENTRIES = 200
const cache = new Map() // key -> { value, expiresAt }

async function cached(key, ttlMs, build) {
  const hit = cache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.value
  const value = await build()
  if (value == null) return value // misses (404s) aren't cached
  if (cache.size >= CACHE_MAX_ENTRIES && !cache.has(key)) {
    const now = Date.now()
    for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k)
    while (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value)
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs })
  return value
}

// Events worth listing/indexing: not cancelled and not already over.
const isLive = (row) => {
  const status = eventTimeStatus(row)
  return status !== 'cancelled' && status !== 'ended'
}

async function loadPlace(id) {
  const row = await db('places').select(PLACE_COLUMNS.split(',').map((c) => c.trim())).where('id', id).first()
  if (!row || row.is_active === false) return null
  const [withPhotos] = await attachUploadedPhotos([row])
  return rowToPlace(withPhotos)
}

async function loadEvent(id) {
  const row = await db('events').select(EVENT_COLUMNS.split(',').map((c) => c.trim())).where('id', id).first()
  if (!row || row.status === 'cancelled') return null
  const [withPhotos] = await attachEventPhotos([row])
  return rowToEvent(withPhotos)
}

const topPlaces = (limit) => db('places').select(PLACE_LIST_COLUMNS).where('is_active', true).orderByRaw('rating desc nulls last').limit(limit)

async function liveEvents(limit) {
  const rows = await db('events').select(EVENT_LIST_COLUMNS).whereNot('status', 'cancelled').orderBy('event_start_date', 'asc')
  return rows.filter(isLive).slice(0, limit).map(rowToEvent)
}

// path: the site URL the bot asked for, e.g. "/places/<uuid>". Returns HTML,
// or null when there's nothing public at that URL.
async function buildPage(path, origin) {
  if (path === '/') return seo.homePage(await topPlaces(12), await liveEvents(6), origin)
  if (path === '/places') return seo.placesListPage(await topPlaces(300), origin)
  if (path === '/events') return seo.eventsListPage(await liveEvents(300), origin)
  if (path === '/trip') return seo.tripPage(origin)

  const place = path.match(/^\/places\/([^/]+)$/)
  if (place) {
    if (!UUID.test(place[1])) return null
    const p = await loadPlace(place[1])
    return p ? seo.placePage(p, origin) : null
  }
  const event = path.match(/^\/events\/([^/]+)$/)
  if (event) {
    if (!UUID.test(event[1])) return null
    const e = await loadEvent(event[1])
    return e ? seo.eventPage(e, origin) : null
  }
  return null
}

seoRouter.get('/robots.txt', (req, res) => {
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(seo.robotsTxt(seo.siteOrigin()))
})

seoRouter.get('/sitemap.xml', asyncHandler(async (req, res) => {
  const origin = seo.siteOrigin()
  const xml = await cached('sitemap', 10 * 60 * 1000, async () => {
    const [places, events] = await Promise.all([
      db('places').select('id', 'updated_at').where('is_active', true),
      db('events').select('id', 'status', 'event_start_date', 'event_end_date', 'updated_at').whereNot('status', 'cancelled'),
    ])
    return seo.sitemapXml([
      { path: '/', changefreq: 'daily', priority: 1.0 },
      { path: '/places', changefreq: 'daily', priority: 0.9 },
      { path: '/events', changefreq: 'daily', priority: 0.9 },
      { path: '/trip', changefreq: 'monthly', priority: 0.6 },
      ...places.map((p) => ({ path: `/places/${p.id}`, lastmod: p.updated_at, changefreq: 'weekly', priority: 0.8 })),
      ...events.filter(isLive).map((e) => ({ path: `/events/${e.id}`, lastmod: e.updated_at, changefreq: 'daily', priority: 0.7 })),
    ], origin)
  })
  res.type('application/xml').set('Cache-Control', 'public, max-age=600').send(xml)
}))

seoRouter.get('/api/seo/page/*', asyncHandler(async (req, res) => {
  const origin = seo.siteOrigin()
  const path = `/${String(req.params[0] || '').replace(/\/+$/, '')}`
  const html = await cached(`page:${path}`, 5 * 60 * 1000, () => buildPage(path, origin))
  if (!html) return res.status(404).type('html').send(seo.notFoundPage(origin))
  res.type('html').set('Cache-Control', 'public, max-age=300').send(html)
}))
