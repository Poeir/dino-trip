import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import EventDetailView from '../components/EventDetailView.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { fetchPlace } from '../lib/apiClient.js'

export default function EventDetailPage() {
  const { state, actions } = useApp()
  const { id } = useParams()
  const foundEvent = state.events.find((event) => event.id === id)
  const [place, setPlace] = useState(null)
  const placeId = foundEvent?.placeId

  useEffect(() => {
    if (!placeId) { setPlace(null); return }
    let cancelled = false
    fetchPlace(placeId).then((p) => { if (!cancelled) setPlace(p) }).catch(() => { if (!cancelled) setPlace(null) })
    return () => { cancelled = true }
  }, [placeId])

  // See PlaceDetailPage.jsx for why: a direct link/refresh would otherwise
  // render a blank event for however long the bulk fetch takes.
  if (!foundEvent && state.dataLoading) {
    return <main style={{ maxWidth: 1360, margin: '0 auto', padding: '90px 32px' }}><LoadingSpinner size={40} label="กำลังโหลดข้อมูลกิจกรรม..." /></main>
  }

  const ev = foundEvent || { suitableFor: [] }
  return (
    <main style={{ maxWidth: 1360, margin: '0 auto', padding: '28px 32px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: '#8a938c', flexWrap: 'wrap' }}>
        <a href="#" onClick={(e) => { e.preventDefault(); actions.goHome() }} style={{ color: '#8a938c', fontWeight: 600 }}>หน้าแรก</a>
        <span>/</span>
        <a href="#" onClick={(e) => { e.preventDefault(); actions.goEvents() }} style={{ color: '#8a938c', fontWeight: 600 }}>กิจกรรม &amp; เทศกาล</a>
        <span>/</span>
        <span style={{ color: '#1B5E20', fontWeight: 700 }}>{ev.name}</span>
      </div>
      <div style={{ marginTop: 16 }}>
        <EventDetailView event={ev} place={place} />
      </div>
    </main>
  )
}
