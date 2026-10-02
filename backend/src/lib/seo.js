// Pure helpers that build the pages and files crawlers read: robots.txt,
// sitemap.xml, and a server-rendered HTML page per public route.
//
// The site is a client-rendered SPA, so a crawler that doesn't run JavaScript
// (LINE / Facebook link previews, most bots) would otherwise see the same empty
// shell -- and the home page's title -- for every URL. Caddy sends those
// user agents to routes/seo.routes.js, which renders these pages instead.
// Real visitors never get them. Titles/descriptions must stay in sync with
// frontend/src/lib/useSeo.js so both audiences see the same thing.
//
// No database access in here, so it can be unit-tested directly.

export const SITE_NAME = 'Dino เที่ยวขอนแก่น'
export const DEFAULT_TITLE = 'Dino - เที่ยวขอนแก่น | ที่เที่ยว ร้านอาหาร เทศกาล วางแผนทริป AI'
export const DEFAULT_DESCRIPTION = 'รวมที่เที่ยว ร้านอาหาร คาเฟ่ และงานเทศกาลในขอนแก่น พร้อมน้องไดโนผู้ช่วย AI วางแผนทริปให้ในไม่กี่ขั้นตอน สะสมพอยท์จากการสแกน QR ตามสถานที่ท่องเที่ยว'
const DEFAULT_IMAGE_PATH = '/assets/og-home.jpg'
const MAX_DESCRIPTION = 155

// Pages with nothing for a search engine (accounts, scans, private data).
// Kept in one place so robots.txt can't drift from the routes.
export const PRIVATE_PATHS = [
  '/api/', '/admin', '/login', '/signup', '/forgot-password', '/reset-password',
  '/confirm', '/profile', '/trips', '/trip/', '/points', '/scan/',
]

export function siteOrigin(env = process.env) {
  return (env.FRONTEND_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '')
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function truncate(text, max = MAX_DESCRIPTION) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

// JSON inside a <script>: "<" is escaped so a stored "</script>" can't end it early.
export function jsonLdScript(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`
}

// hours/amenities come from Google imports and admin edits in a few shapes.
function textOf(value) {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(' | ')
  if (typeof value === 'object') return ''
  return String(value).trim()
}

const absoluteImage = (src, origin) => (src ? (/^https?:\/\//i.test(src) ? src : `${origin}${src}`) : `${origin}${DEFAULT_IMAGE_PATH}`)

export function renderPage({ title, description, canonical, image, type = 'website', jsonLd, bodyHtml, noindex = false }) {
  const t = escapeHtml(title)
  const d = escapeHtml(description)
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${t}</title>
<meta name="description" content="${d}" />
<meta name="robots" content="${noindex ? 'noindex, nofollow' : 'index, follow'}" />
<link rel="canonical" href="${escapeHtml(canonical)}" />
<meta property="og:type" content="${type}" />
<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />
<meta property="og:locale" content="th_TH" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
<meta property="og:url" content="${escapeHtml(canonical)}" />
<meta property="og:image" content="${escapeHtml(image)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${t}" />
<meta name="twitter:description" content="${d}" />
<meta name="twitter:image" content="${escapeHtml(image)}" />
${jsonLd ? jsonLdScript(jsonLd) : ''}
</head>
<body>
${bodyHtml}
</body>
</html>
`
}

const nav = (origin) => `<nav><a href="${origin}/">หน้าแรก</a> | <a href="${origin}/places">สถานที่ท่องเที่ยว</a> | <a href="${origin}/events">กิจกรรม &amp; เทศกาล</a> | <a href="${origin}/trip">วางแผนทริปด้วย AI</a></nav>`

const SCHEMA_TYPE_BY_CATEGORY = { 'คาเฟ่': 'CafeOrCoffeeShop', 'ร้านอาหาร': 'Restaurant' }

export function placePage(place, origin) {
  const canonical = `${origin}/places/${place.id}`
  const description = truncate(place.desc) || truncate([place.category, place.district || 'ขอนแก่น', place.address].filter(Boolean).join(' · '))
  const images = (place.images || []).filter(Boolean).slice(0, 5)
  const title = `${place.name} | ${SITE_NAME}`

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': SCHEMA_TYPE_BY_CATEGORY[place.category] || 'TouristAttraction',
    name: place.name,
    description,
    url: canonical,
    ...(images.length ? { image: images } : {}),
    address: {
      '@type': 'PostalAddress',
      ...(place.address ? { streetAddress: place.address } : {}),
      addressLocality: place.district || 'ขอนแก่น',
      addressRegion: 'ขอนแก่น',
      addressCountry: 'TH',
    },
    ...(place.location ? { geo: { '@type': 'GeoCoordinates', latitude: place.location.lat, longitude: place.location.lng } } : {}),
    ...(place.phone ? { telephone: place.phone } : {}),
    // Deliberately no aggregateRating: the ratings come from Google, and
    // Google's guidelines don't allow marking up reviews that aren't ours.
  }

  const rows = [
    ['ประเภท', place.category],
    ['ที่อยู่', place.address],
    ['เวลาเปิด-ปิด', textOf(place.hours)],
    ['เบอร์โทร', place.phone],
    ['ค่าเข้า / ราคา', place.price],
    ['สิ่งอำนวยความสะดวก', textOf(place.amenities)],
  ].filter(([, v]) => v)

  const bodyHtml = `<main>
${nav(origin)}
<article>
<h1>${escapeHtml(place.name)}</h1>
${images[0] ? `<img src="${escapeHtml(images[0])}" alt="${escapeHtml(place.name)}" />` : ''}
${place.desc ? `<p>${escapeHtml(place.desc)}</p>` : ''}
<dl>
${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('\n')}
</dl>
${place.website ? `<p><a href="${escapeHtml(place.website)}" rel="nofollow">เว็บไซต์</a></p>` : ''}
</article>
</main>`

  return renderPage({ title, description, canonical, image: absoluteImage(images[0] || place.img, origin), type: 'article', jsonLd, bodyHtml })
}

export function eventPage(event, origin) {
  const canonical = `${origin}/events/${event.id}`
  const description = truncate(event.desc) || truncate([event.dateRange, event.venueName].filter(Boolean).join(' · '))
  const images = (event.images || []).filter(Boolean).slice(0, 5)
  const title = `${event.name} | ${SITE_NAME}`

  // Google needs a start date to show an Event; without one skip the markup.
  const jsonLd = event.eventStartDate ? {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.name,
    description,
    url: canonical,
    startDate: event.eventStartDate,
    ...(event.eventEndDate ? { endDate: event.eventEndDate } : {}),
    eventStatus: event.status === 'cancelled' ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: event.venueName || 'ขอนแก่น',
      address: { '@type': 'PostalAddress', addressLocality: 'ขอนแก่น', addressRegion: 'ขอนแก่น', addressCountry: 'TH' },
    },
    ...(images.length ? { image: images } : {}),
    ...(event.organizer ? { organizer: { '@type': 'Organization', name: event.organizer } } : {}),
  } : null

  const rows = [
    ['ช่วงเวลา', event.dateRange],
    ['สถานที่จัดงาน', event.venueName],
    ['ค่าเข้าชม', event.admission],
    ['ผู้จัด', event.organizer],
    ['เหมาะสำหรับ', textOf(event.suitableFor)],
    ['ประเภท', event.category],
    ['สถานะ', event.status === 'cancelled' ? 'ยกเลิก' : ''],
  ].filter(([, v]) => v)

  const bodyHtml = `<main>
${nav(origin)}
<article>
<h1>${escapeHtml(event.name)}</h1>
${images[0] ? `<img src="${escapeHtml(images[0])}" alt="${escapeHtml(event.name)}" />` : ''}
${event.desc ? `<p>${escapeHtml(event.desc)}</p>` : ''}
<dl>
${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('\n')}
</dl>
</article>
</main>`

  return renderPage({ title, description, canonical, image: absoluteImage(images[0] || event.img, origin), type: 'article', jsonLd, bodyHtml })
}

const linkList = (items, origin, prefix) => `<ul>
${items.map((i) => `<li><a href="${origin}/${prefix}/${escapeHtml(i.id)}">${escapeHtml(i.name)}</a>${i.sub ? ` — ${escapeHtml(i.sub)}` : ''}</li>`).join('\n')}
</ul>`

export function placesListPage(places, origin) {
  const description = 'รวมสถานที่ท่องเที่ยว วัด คาเฟ่ ร้านอาหาร พิพิธภัณฑ์ สวนสาธารณะ และตลาดในขอนแก่น พร้อมรีวิวและแผนที่ เลือกดูตามหมวดหมู่ได้เลย'
  const bodyHtml = `<main>
${nav(origin)}
<h1>สถานที่ท่องเที่ยวขอนแก่นทั้งหมด</h1>
<p>${escapeHtml(description)}</p>
${linkList(places.map((p) => ({ id: p.id, name: p.name, sub: [p.category, p.district].filter(Boolean).join(' · ') })), origin, 'places')}
</main>`
  return renderPage({ title: `สถานที่ท่องเที่ยวขอนแก่นทั้งหมด | ${SITE_NAME}`, description, canonical: `${origin}/places`, image: absoluteImage(null, origin), bodyHtml })
}

export function eventsListPage(events, origin) {
  const description = 'ตารางงานเทศกาล กิจกรรม และอีเวนต์ในขอนแก่น ทั้งที่กำลังจัดอยู่และเร็ว ๆ นี้ พร้อมวันที่ สถานที่ และค่าเข้าชม'
  const bodyHtml = `<main>
${nav(origin)}
<h1>กิจกรรมและเทศกาลในขอนแก่น</h1>
<p>${escapeHtml(description)}</p>
${linkList(events.map((e) => ({ id: e.id, name: e.name, sub: [e.dateRange, e.venueName].filter(Boolean).join(' · ') })), origin, 'events')}
</main>`
  return renderPage({ title: `กิจกรรมและเทศกาลในขอนแก่น | ${SITE_NAME}`, description, canonical: `${origin}/events`, image: absoluteImage(null, origin), bodyHtml })
}

export function tripPage(origin) {
  const description = 'ให้น้องไดโนผู้ช่วย AI จัดแผนเที่ยวขอนแก่นให้ตามจำนวนวัน งบประมาณ และความสนใจของคุณ ได้ตารางเที่ยวรายวัน พร้อมเส้นทางและเวลาเปิดปิดของแต่ละที่'
  const bodyHtml = `<main>
${nav(origin)}
<h1>วางแผนทริปขอนแก่นด้วย AI</h1>
<p>${escapeHtml(description)}</p>
</main>`
  return renderPage({ title: `วางแผนทริปขอนแก่นด้วย AI | ${SITE_NAME}`, description, canonical: `${origin}/trip`, image: absoluteImage(null, origin), bodyHtml })
}

export function homePage(places, events, origin) {
  const bodyHtml = `<main>
${nav(origin)}
<h1>${escapeHtml(SITE_NAME)}</h1>
<p>${escapeHtml(DEFAULT_DESCRIPTION)}</p>
<h2>สถานที่ท่องเที่ยวแนะนำ</h2>
${linkList(places.map((p) => ({ id: p.id, name: p.name, sub: [p.category, p.district].filter(Boolean).join(' · ') })), origin, 'places')}
<h2>กิจกรรมและเทศกาล</h2>
${linkList(events.map((e) => ({ id: e.id, name: e.name, sub: [e.dateRange, e.venueName].filter(Boolean).join(' · ') })), origin, 'events')}
</main>`
  return renderPage({ title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, canonical: `${origin}/`, image: absoluteImage(null, origin), bodyHtml })
}

export function notFoundPage(origin) {
  return renderPage({
    title: `ไม่พบหน้านี้ | ${SITE_NAME}`,
    description: 'ไม่พบหน้าที่ต้องการ',
    canonical: `${origin}/`,
    image: absoluteImage(null, origin),
    noindex: true,
    bodyHtml: `<main>${nav(origin)}<h1>ไม่พบหน้านี้</h1></main>`,
  })
}

export function robotsTxt(origin) {
  return `User-agent: *
${PRIVATE_PATHS.map((p) => `Disallow: ${p}`).join('\n')}

Sitemap: ${origin}/sitemap.xml
`
}

// entries: [{ path, lastmod?: Date|string, changefreq?, priority? }]
export function sitemapXml(entries, origin) {
  const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null)
  const urls = entries.map((e) => {
    const lastmod = day(e.lastmod)
    return `  <url>
    <loc>${escapeHtml(`${origin}${e.path}`)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}${e.changefreq ? `\n    <changefreq>${e.changefreq}</changefreq>` : ''}${e.priority != null ? `\n    <priority>${e.priority}</priority>` : ''}
  </url>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`
}
