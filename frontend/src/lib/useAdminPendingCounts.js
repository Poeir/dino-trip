import { useEffect, useState } from 'react'
import { fetchAdminPlaceReportCount, fetchAdminEventReportCount, fetchAdminEventRequestCount } from './apiClient.js'

// Pending admin work (report + request queues), shared by the sidebar badges,
// the reports tab chips and the dashboard "งานค้าง" card. Callers mounting at the
// same moment share one in-flight request; there is no longer-lived cache, so a
// later `refreshKey` change always refetches.
const EMPTY = { placeReports: 0, eventReports: 0, requests: 0 }
let inflight = null

function loadCounts() {
  if (!inflight) {
    // Each count degrades to 0 on failure (matches the old sidebar behaviour).
    const safe = (p, pick) => p.then(pick).catch(() => 0)
    inflight = Promise.all([
      safe(fetchAdminPlaceReportCount(), (r) => r.pending),
      safe(fetchAdminEventReportCount(), (r) => r.pending),
      safe(fetchAdminEventRequestCount(), (r) => r.pending),
    ])
      .then(([placeReports, eventReports, requests]) => ({ placeReports, eventReports, requests }))
      .finally(() => { inflight = null })
  }
  return inflight
}

// Returns { placeReports, eventReports, requests, reports (sum), loaded }.
export function useAdminPendingCounts(refreshKey) {
  const [counts, setCounts] = useState(EMPTY)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    loadCounts().then((c) => { if (!cancelled) { setCounts(c); setLoaded(true) } })
    return () => { cancelled = true }
  }, [refreshKey])
  return { ...counts, reports: counts.placeReports + counts.eventReports, loaded }
}
