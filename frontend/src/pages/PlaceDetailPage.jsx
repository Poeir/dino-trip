import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import PlaceDetailView from '../components/PlaceDetailView.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { fetchPlace } from '../lib/apiClient.js'

export default function PlaceDetailPage() {
  const { state, actions } = useApp()
  const { id } = useParams()
  const [found, setFound] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchPlace(id)
      .then((place) => { if (!cancelled) setFound(place) })
      .catch(() => { if (!cancelled) setFound(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  // Distinguish "still loading" from "no such place" so a direct link/
  // refresh shows a spinner instead of a broken-looking blank detail view.
  if (!found && loading) {
    return <main style={{ maxWidth: 1360, margin: '0 auto', padding: '90px 32px' }}><LoadingSpinner size={40} label="กำลังโหลดข้อมูลสถานที่..." /></main>
  }

  const p = found
    ? { ...found, isFavorite: state.favoriteIds.includes(found.id), onToggleFavorite: () => actions.toggleFavorite(found.id) }
    : { amenities: [] }
  return (
    <main style={{ maxWidth: 1360, margin: '0 auto', padding: '28px 32px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: '#8a938c', flexWrap: 'wrap' }}>
        <a href="#" onClick={(e) => { e.preventDefault(); actions.goHome() }} style={{ color: '#8a938c', fontWeight: 600 }}>หน้าแรก</a>
        <span>/</span>
        <a href="#" onClick={(e) => { e.preventDefault(); actions.goPlaces() }} style={{ color: '#8a938c', fontWeight: 600 }}>สถานที่ท่องเที่ยว</a>
        <span>/</span>
        <span style={{ color: '#1B5E20', fontWeight: 700 }}>{p.name}</span>
      </div>
      <div style={{ marginTop: 16 }}>
        <PlaceDetailView place={p} />
      </div>
    </main>
  )
}
