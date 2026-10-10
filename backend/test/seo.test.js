import test from 'node:test'
import assert from 'node:assert/strict'
import {
  escapeHtml, truncate, jsonLdScript, siteOrigin, robotsTxt, sitemapXml,
  placePage, eventPage, homePage, placesListPage, notFoundPage, PRIVATE_PATHS,
} from '../src/lib/seo.js'

const ORIGIN = 'https://example.test'

const jsonLdOf = (html) => {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  return m ? JSON.parse(m[1]) : null
}

test('escapeHtml neutralises markup and quotes', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  assert.equal(escapeHtml(null), '')
})

test('truncate collapses whitespace and caps length with an ellipsis', () => {
  assert.equal(truncate('  a \n b  '), 'a b')
  const long = truncate('ก'.repeat(300))
  assert.equal(long.length, 155)
  assert.ok(long.endsWith('…'))
})

test('jsonLdScript cannot be closed early by stored "</script>"', () => {
  const out = jsonLdScript({ name: '</script><script>alert(1)</script>' })
  assert.equal(out.match(/<\/script>/g).length, 1) // only our own closing tag
  assert.deepEqual(JSON.parse(out.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')).name, '</script><script>alert(1)</script>')
})

test('siteOrigin strips trailing slashes and falls back for dev', () => {
  assert.equal(siteOrigin({ FRONTEND_ORIGIN: 'https://a.test//' }), 'https://a.test')
  assert.equal(siteOrigin({}), 'http://localhost:5173')
})

test('robots.txt blocks private paths and points at the sitemap', () => {
  const txt = robotsTxt(ORIGIN)
  for (const p of PRIVATE_PATHS) assert.ok(txt.includes(`Disallow: ${p}`), p)
  assert.ok(txt.includes(`Sitemap: ${ORIGIN}/sitemap.xml`))
  // /trip (the planner landing page) must stay crawlable while /trip/<id> results are blocked.
  assert.ok(!/^Disallow: \/trip$/m.test(txt))
})

test('sitemap lists absolute, escaped URLs with a date-only lastmod', () => {
  const xml = sitemapXml([{ path: '/places/a&b', lastmod: '2026-10-02T09:00:00Z', priority: 0.8 }, { path: '/' }], ORIGIN)
  assert.ok(xml.includes('<loc>https://example.test/places/a&amp;b</loc>'))
  assert.ok(xml.includes('<lastmod>2026-10-02</lastmod>'))
  assert.ok(xml.includes('<loc>https://example.test/</loc>'))
})

const PLACE = {
  id: '28d1ae32-daa7-401a-8f95-028644a42a1d', name: 'วัด "ทดสอบ" <b>', category: 'วัด', district: 'เมืองขอนแก่น',
  address: '1 ถนนทดสอบ', desc: 'วัดสวยงาม', phone: '043-000000', hours: ['จ. 08:00-17:00', 'อ. 08:00-17:00'],
  amenities: ['ที่จอดรถ'], images: ['https://img.test/1.jpg'], img: 'https://img.test/1.jpg', location: { lat: 16.4, lng: 102.8 },
}

test('place page: canonical, share tags, escaped content and valid JSON-LD', () => {
  const html = placePage(PLACE, ORIGIN)
  assert.ok(html.includes(`<link rel="canonical" href="${ORIGIN}/places/${PLACE.id}" />`))
  assert.ok(html.includes('<meta property="og:image" content="https://img.test/1.jpg" />'))
  assert.ok(html.includes('<meta name="robots" content="index, follow" />'))
  assert.ok(!html.includes('<b>'), 'name must be escaped')
  assert.ok(html.includes('จ. 08:00-17:00 | อ. 08:00-17:00'))
  const ld = jsonLdOf(html)
  assert.equal(ld['@type'], 'TouristAttraction')
  assert.equal(ld.geo.latitude, 16.4)
  assert.equal(ld.aggregateRating, undefined)
})

test('place page falls back to the home share image when the place has no photo', () => {
  const html = placePage({ ...PLACE, images: [], img: null }, ORIGIN)
  assert.ok(html.includes(`content="${ORIGIN}/assets/og-home.jpg"`))
})

test('cafes and restaurants get their own schema type', () => {
  assert.equal(jsonLdOf(placePage({ ...PLACE, category: 'คาเฟ่' }, ORIGIN))['@type'], 'CafeOrCoffeeShop')
  assert.equal(jsonLdOf(placePage({ ...PLACE, category: 'ร้านอาหาร' }, ORIGIN))['@type'], 'Restaurant')
})

test('event page: Event JSON-LD only when there is a start date', () => {
  const ev = { id: 'e1', name: 'งานไหม', desc: 'งานประจำปี', dateRange: '1-10 ธ.ค.', venueName: 'สนามกลาง', status: 'published', images: [] }
  assert.equal(jsonLdOf(eventPage(ev, ORIGIN)), null)
  const ld = jsonLdOf(eventPage({ ...ev, eventStartDate: '2026-12-01', eventEndDate: '2026-12-10' }, ORIGIN))
  assert.equal(ld['@type'], 'Event')
  assert.equal(ld.startDate, '2026-12-01')
  assert.equal(ld.eventStatus, 'https://schema.org/EventScheduled')
})

test('list/home pages link to detail pages and 404 page is noindex', () => {
  const places = [{ id: 'p1', name: 'A', category: 'วัด', district: 'เมือง' }]
  assert.ok(placesListPage(places, ORIGIN).includes(`href="${ORIGIN}/places/p1"`))
  const home = homePage(places, [{ id: 'e1', name: 'E', dateRange: 'x', venueName: 'y' }], ORIGIN)
  assert.ok(home.includes(`href="${ORIGIN}/events/e1"`))
  assert.ok(home.includes(`<link rel="canonical" href="${ORIGIN}/" />`))
  assert.ok(notFoundPage(ORIGIN).includes('noindex'))
})
