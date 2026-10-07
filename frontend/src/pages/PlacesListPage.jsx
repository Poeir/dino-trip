import { useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import ImageSlot from '../components/ImageSlot.jsx'
import { GridIcon, CupIcon, TempleIcon, MuseumIcon, TreeIcon, MountainIcon, BasketIcon, CameraIcon, FoodIcon, BedIcon, HeartIcon } from '../components/Icons.jsx'
import PageControls from '../components/PageControls.jsx'
import { fetchPlaces } from '../lib/apiClient.js'
import { usePagedList } from '../lib/usePagedList.js'
import { useSeo } from '../lib/useSeo.js'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import EmptyState from '../components/EmptyState.jsx'
import LoadError from '../components/LoadError.jsx'
import { placeCategoryIcon, MASCOT } from '../data/categoryImages.js'

// >=1500 reviews reads as "popular" -- mirrors the badge PlacesTab/PlaceCard
// used to compute in AppContext.jsx before this page moved to its own
// server-paginated fetch.
const placeBadge = (p) => p.reviews >= 1500 ? { label: 'ยอดนิยม', bg: '#FDEEE3', color: '#9b5527' } : { label: '', bg: '', color: '' }

function CategoryIcon({ cat }) {
  const props = { size: 15, color: cat.iconBorder, box: false }
  if (cat.showGrid) return <GridIcon {...props} />
  if (cat.showCup) return <CupIcon {...props} />
  if (cat.showTemple) return <TempleIcon {...props} />
  if (cat.showMuseum) return <MuseumIcon {...props} />
  if (cat.showTree) return <TreeIcon {...props} />
  if (cat.showMountain) return <MountainIcon {...props} />
  if (cat.showBasket) return <BasketIcon {...props} />
  if (cat.showCamera) return <CameraIcon {...props} />
  if (cat.showFood) return <FoodIcon {...props} />
  if (cat.showBed) return <BedIcon {...props} />
  return null
}

export default function PlacesListPage() {
  const { state, actions, derived } = useApp()
  useSeo({
    title: 'สถานที่ท่องเที่ยวขอนแก่นทั้งหมด',
    description: 'รวมสถานที่ท่องเที่ยว วัด คาเฟ่ ร้านอาหาร พิพิธภัณฑ์ สวนสาธารณะ และตลาดในขอนแก่น พร้อมรีวิวและแผนที่ เลือกดูตามหมวดหมู่ได้เลย',
    path: '/places',
  })

  // Debounced so typing doesn't fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState(state.searchQuery)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(state.searchQuery), 300)
    return () => clearTimeout(t)
  }, [state.searchQuery])

  // The search box binds to AppContext's state.searchQuery (shared with the
  // category chips' onClick handlers), so this page passes the debounced
  // term through extraParams rather than usePagedList's own query/setQuery.
  const paged = usePagedList(fetchPlaces, {
    pageSize: 24,
    extraParams: {
      search: debouncedSearch || undefined,
      category: state.activeCategory === 'ทั้งหมด' ? undefined : state.activeCategory,
      isActive: true,
    },
  })
  const placesView = paged.rows.map((p) => ({
    ...p,
    onOpen: () => actions.openPlace(p.id),
    badge: placeBadge(p),
    isFavorite: state.favoriteIds.includes(p.id),
    onToggleFavorite: () => actions.toggleFavorite(p.id),
  }))

  // On small screens the category bar scrolls sideways; show a "next" arrow
  // (and edge fade, via CSS) only while there is more to the right.
  const filterRef = useRef(null)
  const [canScrollMore, setCanScrollMore] = useState(false)
  const [canScrollBack, setCanScrollBack] = useState(false)
  const updateCanScroll = () => {
    const el = filterRef.current
    if (!el) return
    const overflowing = el.scrollWidth > el.clientWidth + 1
    const more = overflowing && el.scrollLeft + el.clientWidth < el.scrollWidth - 4
    const back = overflowing && el.scrollLeft > 4
    setCanScrollMore((prev) => (prev === more ? prev : more))
    setCanScrollBack((prev) => (prev === back ? prev : back))
  }
  useEffect(() => {
    updateCanScroll()
    window.addEventListener('resize', updateCanScroll)
    return () => window.removeEventListener('resize', updateCanScroll)
  }, [derived.categoriesViewIcons.length])

  return (
    <main data-role="places-page" style={{ maxWidth: 1360, margin: '0 auto', padding: 'var(--page-pt) var(--page-gutter) var(--page-pb)' }}>
      <h1 data-font="culture" style={{ fontSize: 27, fontWeight: 800, color: '#1B5E20', margin: '0 0 6px' }}>สถานที่ท่องเที่ยวทั้งหมด</h1>
      <p style={{ color: '#5f6a63', fontSize: 14, margin: '0 0 22px' }}>รวมสถานที่แนะนำในขอนแก่น เลือกดูตามหมวดหมู่ได้เลย</p>
      <input
        value={state.searchQuery}
        onChange={actions.onSearchChange}
        placeholder="ค้นหาสถานที่..."
        style={{ width: '100%', maxWidth: 420, border: '1px solid #DCD8C6', borderRadius: 20, padding: '10px 18px', fontSize: 14, marginBottom: 18, display: 'block' }}
      />
      <div data-role="places-filter-wrap" data-more={canScrollMore ? 'true' : 'false'} data-back={canScrollBack ? 'true' : 'false'} style={{ position: 'relative' }}>
      <button type="button" className="dc-filter-prev" aria-label="ดูหมวดหมู่ก่อนหน้า" onClick={() => filterRef.current?.scrollBy({ left: -180, behavior: 'smooth' })}>‹</button>
      <div ref={filterRef} data-role="places-filter-bar" data-more={canScrollMore ? 'true' : 'false'} data-back={canScrollBack ? 'true' : 'false'} onScroll={updateCanScroll} style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginBottom: 26 }}>
        {derived.categoriesViewIcons.map((cat) => (
          <button key={cat.label} onClick={cat.onClick} style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid #C8E6C9', borderRadius: 20, padding: '8px 18px 8px 13px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s ease', background: cat.bg, color: cat.color }}>
            <CategoryIcon cat={cat} />
            {cat.label}
          </button>
        ))}
      </div>
      <button type="button" className="dc-filter-next" aria-label="ดูหมวดหมู่ถัดไป" onClick={() => filterRef.current?.scrollBy({ left: 180, behavior: 'smooth' })}>›</button>
      </div>
      {paged.loading && placesView.length === 0 && <LoadingSpinner size={36} label="กำลังโหลดสถานที่..." />}
      {paged.error && <LoadError message="โหลดรายการสถานที่ไม่สำเร็จ" onRetry={paged.refetch} />}
      {!paged.loading && !paged.error && placesView.length === 0 && (
        <EmptyState mascot={MASCOT.sad} tone="green" style={{ padding: '56px 20px' }} title="ไม่พบสถานที่ในหมวดนี้" desc={'ลองเลือกหมวดหมู่อื่น หรือกลับไปดู "ทั้งหมด"'} />
      )}
      <div data-role="card-grid" style={{ display: paged.error ? 'none' : 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 24 }}>
        {placesView.map((place) => (
          <div key={place.id} onClick={place.onOpen} style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: 320, background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.22s ease,box-shadow 0.22s ease', animation: 'dc-fade-up 0.4s ease both' }}>
            {place.badge.label && (
              <span style={{ position: 'absolute', top: 10, left: 10, zIndex: 2, fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 10, background: place.badge.bg, color: place.badge.color }}>{place.badge.label}</span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); place.onToggleFavorite() }}
              aria-label="บันทึกรายการโปรด"
              style={{ position: 'absolute', top: 10, right: 10, zIndex: 2, width: 30, height: 30, borderRadius: '50%', border: 'none', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}
            >
              <HeartIcon size={15} color={place.isFavorite ? '#E53935' : '#626863'} box={false} />
            </button>
            <ImageSlot src={place.img} shape="rect" style={{ width: '100%', height: 170, flexShrink: 0 }} placeholder="ภาพสถานที่" icon={placeCategoryIcon(place.category)} />
            <div data-role="place-card-body" style={{ padding: 16, flex: 1, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#2E7D32', background: '#E8F5E9', padding: '3px 9px', borderRadius: 10 }}>{place.category}</span>
                {place.hasQR && <span style={{ fontSize: 11, fontWeight: 700, color: '#7A5205', background: '#FFF8E1', padding: '3px 9px', borderRadius: 10 }}>+{place.qrPoints} พอยท์</span>}
              </div>
              <div style={{ fontWeight: 400, fontSize: 16, color: '#1f2a24', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{place.name}</div>
              <div style={{ fontWeight: 300, fontSize: 13, color: '#5f6a63', marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>★ {place.rating} ({place.reviews}) · {place.price}</div>
              <div style={{ fontWeight: 300, fontSize: 12.5, color: '#626863', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{place.address}</div>
            </div>
          </div>
        ))}
      </div>
      <PageControls page={paged.page} totalPages={paged.totalPages} total={paged.total} onChange={paged.setPage} />
    </main>
  )
}
