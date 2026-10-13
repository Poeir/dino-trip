// Place/event photos are stored as plain Cloudinary delivery URLs, e.g.
//   https://res.cloudinary.com/<cloud>/image/upload/v1790899812/dino/places/<id>.jpg
// and the originals are large (often 600-800KB each). Cloudinary can resize and
// re-encode on delivery if the URL carries transformations, so add them here
// instead of rewriting what's stored in the database:
//   f_auto  -> WebP/AVIF where the browser supports it
//   q_auto  -> a quality level picked per image
//   c_limit -> shrink to the width below but never upscale
const PLAIN_UPLOAD_URL = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(v\d+\/.+)$/

// cssWidth: roughly how wide the image is shown, in CSS pixels. The delivered
// image is 2x that (sharp on retina screens), capped so a stray huge slot
// can't pull a multi-megabyte photo.
export function cld(url, cssWidth = 400) {
  if (typeof url !== 'string') return url
  const match = url.match(PLAIN_UPLOAD_URL)
  // Not Cloudinary, or it already has transformations in the path: leave it.
  if (!match) return url
  const width = Math.min(1600, Math.max(64, Math.round(cssWidth * 2)))
  return `${match[1]}f_auto,q_auto,c_limit,w_${width}/${match[2]}`
}
