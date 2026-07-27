// DB rows use snake_case; the frontend consumes camelCase. These mappers used
// to live in frontend/src/context/AppContext.jsx -- moved server-side so the
// API is the single place that knows about the DB column shape.

export function rowToPlace(row) {
  return {
    id: row.id,
    source: row.source,
    googlePlaceId: row.google_place_id,
    name: row.name,
    category: row.category,
    rating: row.rating,
    reviews: row.review_count,
    price: row.price,
    address: row.address,
    hours: row.hours,
    phone: row.phone,
    website: row.website,
    mapsUrl: row.maps_url,
    desc: row.description,
    amenities: row.amenities || [],
    tags: row.tags || [],
    hasQR: row.has_qr,
    qrPoints: row.qr_points,
    reviewsList: row.reviews || [],
    location: row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null,
    img: row.img,
    businessStatus: row.business_status,
  }
}

export function rowToEvent(row) {
  return {
    id: row.id, name: row.name, category: row.category, dateRange: row.date_range, venueName: row.venue_name,
    admission: row.admission, organizer: row.organizer, suitableFor: row.suitable_for || [], desc: row.description,
    status: row.status, img: row.img,
  }
}

export function rowToKb(row) {
  return { id: row.id, title: row.title, category: row.category, content: row.content, isPinned: row.is_pinned, isActive: row.is_active }
}

export function rowToQr(row) {
  return { id: row.id, placeId: row.place_id, points: row.points }
}

const splitList = (v) => (Array.isArray(v) ? v : (v || '').split(',').map((s) => s.trim()).filter(Boolean))

// Inverse mappers: request body (camelCase form fields) -> DB row payload.
// Mirrors the payload-building blocks that used to be inline in
// AppContext.jsx's saveForm().

export function placePayload(body) {
  return {
    name: body.name, category: body.category, rating: parseFloat(body.rating) || null,
    review_count: parseInt(body.reviews) || 0, price: body.price, address: body.address,
    hours: body.hours, phone: body.phone, description: body.desc,
    amenities: splitList(body.amenities), tags: splitList(body.tags),
    has_qr: !!body.hasQR, qr_points: parseInt(body.qrPoints) || 0,
  }
}

export function eventPayload(body) {
  return {
    name: body.name, category: body.category, date_range: body.dateRange, venue_name: body.venueName,
    admission: body.admission, organizer: body.organizer, suitable_for: splitList(body.suitableFor),
    description: body.desc, status: body.status, img: body.img,
  }
}

export function kbPayload(body) {
  return { title: body.title, category: body.category, content: body.content, is_pinned: !!body.isPinned, is_active: !!body.isActive }
}

export function qrPayload(body) {
  return { place_id: body.placeId, points: parseInt(body.points) || 0 }
}

export function rewardPayload(body) {
  return { name: body.name, cost: parseInt(body.cost) || 0 }
}
