import { useEffect, useState } from 'react'
import { fetchCostEstimates } from '../../lib/apiClient.js'

// Per-click cost ceilings for the admin buttons that call a paid API (see
// backend/src/lib/apiPricing.js). Static on the server, so fetched once per page load and
// shared; a failed fetch just means no "≈ ฿X" hints (the buttons still work).
let cached = null
let pending = null

const load = () => {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = fetchCostEstimates()
      .then((e) => { cached = e; return e })
      .catch(() => null)
      .finally(() => { pending = null })
  }
  return pending
}

export function useCostEstimates() {
  const [estimates, setEstimates] = useState(cached)
  useEffect(() => {
    if (cached) return undefined
    let cancelled = false
    load().then((e) => { if (!cancelled && e) setEstimates(e) })
    return () => { cancelled = true }
  }, [])
  return estimates
}

// 0.7 -> "฿0.70", 2.1 -> "฿2.10", 38.5 -> "฿39": small amounts keep their satang, bigger ones round up.
export const formatBaht = (n) => `฿${n < 10 ? n.toFixed(2) : Math.ceil(n).toLocaleString('th-TH')}`

// " (≈ ฿0.70)" to append to a button label; empty until the estimates have loaded.
export const costTag = (thb) => (thb == null ? '' : ` (≈ ${formatBaht(thb)})`)

export const FREE_ALLOWANCE_NOTE = 'ประมาณการก่อนหักโควตาฟรีรายเดือนของ Google ยอดจริงดูที่ Google Cloud Billing'
