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
    district: row.district,
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
    isActive: row.is_active !== false,
    // An admin-uploaded gallery (row.uploadedPhotoUrls, attached by
    // places.routes.js's attachUploadedPhotos()) wins outright over whatever
    // was in `img`/`images` (a Google-imported gallery from import-places.js,
    // or nothing for an admin-added place) rather than merging the two --
    // once an admin has curated their own photos, those are the gallery.
    // Both are absolute Cloudinary URLs (src/lib/cloudinary.js) -- nothing
    // to resolve against the API's own origin.
    img: (row.uploadedPhotoUrls?.[0]) || row.img,
    images: (row.uploadedPhotoUrls?.length ? row.uploadedPhotoUrls : null) || (row.images && row.images.length ? row.images : (row.img ? [row.img] : [])),
    businessStatus: row.business_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function rowToEvent(row) {
  return {
    id: row.id, name: row.name, category: row.category, dateRange: row.date_range, venueName: row.venue_name,
    admission: row.admission, organizer: row.organizer, suitableFor: row.suitable_for || [], desc: row.description,
    status: row.status,
    // row.uploadedPhotoUrls is attached by events.routes.js's
    // attachEventPhotos() -- falls back to the legacy single `img` column
    // (from before the gallery existed) for any event that still only has
    // that. `img` (first photo) is what list/card views and
    // EventDetailView.jsx already read; `images` is the full gallery for
    // whenever a public gallery view wants it (mirrors rowToPlace above).
    img: row.uploadedPhotoUrls?.[0] || row.img,
    images: row.uploadedPhotoUrls?.length ? row.uploadedPhotoUrls : (row.img ? [row.img] : []),
    eventStartDate: row.event_start_date, eventEndDate: row.event_end_date,
    // Optional link to an existing places row (see eventPayload below).
    placeId: row.place_id,
    // The vector itself never needs to leave the server -- admins only need
    // to know whether the RAG reindex has picked this row up yet.
    isEmbedded: row.embedding != null,
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
  // lat/lng normally arrive as flat form fields (PlacesTab's LocationPicker),
  // but togglePlaceActive (AppContext.jsx) round-trips a place through this
  // same payload just to flip visibility, passing the API's own `location`
  // shape ({lat,lng}) instead -- accept either so that path doesn't null out
  // coordinates it never touched.
  const lat = body.lat != null && body.lat !== '' ? parseFloat(body.lat) : (body.location?.lat ?? null)
  const lng = body.lng != null && body.lng !== '' ? parseFloat(body.lng) : (body.location?.lng ?? null)
  return {
    name: body.name, category: body.category, rating: parseFloat(body.rating) || null,
    review_count: parseInt(body.reviews) || 0, price: body.price, address: body.address,
    hours: body.hours, phone: body.phone, description: body.desc,
    amenities: splitList(body.amenities), tags: splitList(body.tags),
    has_qr: !!body.hasQR, qr_points: parseInt(body.qrPoints) || 0,
    lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null,
    // Defaults to visible/true unless explicitly turned off -- matches
    // openCreateForm's `isActive: true` default and lets any caller that
    // omits the field (older code paths) leave existing rows untouched.
    is_active: body.isActive !== false,
  }
}

export function eventPayload(body) {
  return {
    name: body.name, category: body.category, date_range: body.dateRange, venue_name: body.venueName,
    admission: body.admission, organizer: body.organizer, suitable_for: splitList(body.suitableFor),
    description: body.desc, status: body.status,
    event_start_date: body.eventStartDate || null, event_end_date: body.eventEndDate || null,
    place_id: body.placeId || null,
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
