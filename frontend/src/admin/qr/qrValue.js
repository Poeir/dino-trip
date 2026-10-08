// Just the opaque qrId -- points/place name are looked up server-side when this URL is scanned
// (see qrs.routes.js's POST /:id/scan), never trusted from the QR's own content. A full URL (rather
// than a bare id string) means the code also works when scanned by a phone's regular camera app,
// not just the in-app scanner -- see ScanLandingPage.jsx.
export const qrValue = (q) => `${window.location.origin}/scan/${q.id}`
