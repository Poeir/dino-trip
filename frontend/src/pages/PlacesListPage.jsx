import { useApp } from '../context/AppContext.jsx'
import ImageSlot from '../components/ImageSlot.jsx'
import { GridIcon, CupIcon, TempleIcon, MuseumIcon, TreeIcon, MountainIcon, BasketIcon, CameraIcon, FoodIcon, BedIcon, HeartIcon } from '../components/Icons.jsx'

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
  return (
    <main style={{ maxWidth: 1360, margin: '0 auto', padding: '36px 32px 60px' }}>
      <h1 data-font="culture" style={{ fontSize: 27, fontWeight: 800, color: '#1B5E20', margin: '0 0 6px' }}>สถานที่ท่องเที่ยวทั้งหมด</h1>
      <p style={{ color: '#6d7a72', fontSize: 14, margin: '0 0 22px' }}>รวมสถานที่แนะนำในขอนแก่น เลือกดูตามหมวดหมู่ได้เลย</p>
      <input
        value={state.searchQuery}
        onChange={actions.onSearchChange}
        placeholder="ค้นหาสถานที่..."
        style={{ width: '100%', maxWidth: 420, border: '1px solid #DCD8C6', borderRadius: 20, padding: '10px 18px', fontSize: 14, marginBottom: 18, display: 'block' }}
      />
      <div data-role="places-filter-bar" style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginBottom: 26 }}>
        {derived.categoriesViewIcons.map((cat) => (
          <button key={cat.label} onClick={cat.onClick} style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid #C8E6C9', borderRadius: 20, padding: '8px 18px 8px 13px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s ease', background: cat.bg, color: cat.color }}>
            <CategoryIcon cat={cat} />
            {cat.label}
          </button>
        ))}
      </div>
      {derived.placesEmpty && (
        <div style={{ textAlign: 'center', padding: '60px 20px', border: '1px dashed #C8E6C9', borderRadius: 18 }}>
          <img src="./assets/dino-mascot-front.png" alt="" style={{ width: 64, height: 'auto', margin: '0 auto 14px', display: 'block', opacity: 0.8 }} onError={(e) => { e.currentTarget.style.display = 'none' }} />
          <div style={{ fontWeight: 700, fontSize: 15, color: '#3c463f', marginBottom: 4 }}>ไม่พบสถานที่ในหมวดนี้</div>
          <div style={{ fontSize: 13, color: '#8a938c' }}>ลองเลือกหมวดหมู่อื่น หรือกลับไปดู "ทั้งหมด"</div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 24 }}>
        {derived.filteredPlaces.map((place) => (
          <div key={place.id} onClick={place.onOpen} style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: 320, background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.22s ease,box-shadow 0.22s ease', animation: 'dc-fade-up 0.4s ease both' }}>
            {place.badge.label && (
              <span style={{ position: 'absolute', top: 10, left: 10, zIndex: 2, fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 10, background: place.badge.bg, color: place.badge.color }}>{place.badge.label}</span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); place.onToggleFavorite() }}
              aria-label="บันทึกรายการโปรด"
              style={{ position: 'absolute', top: 10, right: 10, zIndex: 2, width: 30, height: 30, borderRadius: '50%', border: 'none', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}
            >
              <HeartIcon size={15} color={place.isFavorite ? '#E53935' : '#8a938c'} box={false} />
            </button>
            <ImageSlot src={place.img} shape="rect" style={{ width: '100%', height: 170, flexShrink: 0 }} placeholder="ภาพสถานที่" />
            <div style={{ padding: 16, flex: 1, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#2E7D32', background: '#E8F5E9', padding: '3px 9px', borderRadius: 10 }}>{place.category}</span>
                {place.hasQR && <span style={{ fontSize: 11, fontWeight: 700, color: '#7A5205', background: '#FFF8E1', padding: '3px 9px', borderRadius: 10 }}>+{place.qrPoints} พอยท์</span>}
              </div>
              <div style={{ fontWeight: 400, fontSize: 16, color: '#1f2a24', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{place.name}</div>
              <div style={{ fontWeight: 300, fontSize: 13, color: '#6d7a72', marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>★ {place.rating} ({place.reviews}) · {place.price}</div>
              <div style={{ fontWeight: 300, fontSize: 12.5, color: '#8a938c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{place.address}</div>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
