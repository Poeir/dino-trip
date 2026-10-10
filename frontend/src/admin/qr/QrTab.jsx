import { useCallback, useEffect, useState } from 'react'
import { Plus, QrCode } from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'
import { fetchPlaceNames, updateQr, fetchQrStats } from '../../lib/apiClient.js'
import AdminPageHeader from '../ui/AdminPageHeader.jsx'
import Button from '../ui/Button.jsx'
import StatCard from '../ui/StatCard.jsx'
import QrFormModal from './QrFormModal.jsx'
import QrList from './QrList.jsx'
import QrPreviewModal from './QrPreviewModal.jsx'
import QrPrintLabel from './QrPrintLabel.jsx'

// /admin/qr -- QR codes only. Rewards live in ../rewards/RewardsTab.jsx (/admin/rewards).
export default function QrTab() {
  const { actions, derived } = useApp()
  const [previewQr, setPreviewQr] = useState(null)
  const [printQr, setPrintQr] = useState(null)
  const [placeNameById, setPlaceNameById] = useState(new Map())
  const [placeNamesError, setPlaceNamesError] = useState(false)
  const [stats, setStats] = useState(new Map())
  const [statsError, setStatsError] = useState(false)
  const [togglingId, setTogglingId] = useState(null)

  const loadStats = () => {
    setStatsError(false)
    fetchQrStats()
      .then((rows) => setStats(new Map(rows.map((s) => [s.qrId, s]))))
      .catch((err) => { if (!actions.handleSessionExpired(err)) setStatsError(true) })
  }
  // derived.qrsView no longer joins placeName (no bulk state.places to join against) -- fetch a
  // lean id->name map once instead.
  const loadPlaceNames = () => {
    setPlaceNamesError(false)
    fetchPlaceNames()
      .then((rows) => setPlaceNameById(new Map(rows.map((p) => [p.id, p.name]))))
      .catch(() => setPlaceNamesError(true))
  }
  useEffect(() => { loadStats(); loadPlaceNames() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = async (q) => {
    setTogglingId(q.id)
    try {
      const updated = await updateQr(q.id, { placeId: q.placeId, points: q.points, radiusM: q.radiusM, expiresAt: q.expiresAt || '', isActive: !q.isActive })
      actions.applyQrUpdate(updated)
    } catch (err) {
      actions.reportError('เปลี่ยนสถานะ QR ไม่สำเร็จ: ', err)
    } finally {
      setTogglingId(null)
    }
  }

  const finishPrint = useCallback(() => setPrintQr(null), [])

  return (
    <>
      <AdminPageHeader
        title="QR Code"
        actions={<Button onClick={actions.onNewQr}><Plus size={16} aria-hidden="true" />สร้าง QR ใหม่</Button>}
      />
      <div className="ad-stat-grid ad-stat-grid--sm">
        <StatCard icon={<QrCode size={20} aria-hidden="true" />} value={derived.qrsView.length} label="QR ทั้งหมดในระบบ" tone="warning" />
      </div>

      <QrList
        placeNameById={placeNameById}
        placeNamesError={placeNamesError}
        onRetryPlaceNames={loadPlaceNames}
        stats={stats}
        statsError={statsError}
        onRetryStats={loadStats}
        togglingId={togglingId}
        onPreview={setPreviewQr}
        onToggle={handleToggle}
      />

      <QrFormModal />
      <QrPreviewModal qr={previewQr} onClose={() => setPreviewQr(null)} onPrint={setPrintQr} />
      {printQr && <QrPrintLabel qr={printQr} onDone={finishPrint} />}
    </>
  )
}
