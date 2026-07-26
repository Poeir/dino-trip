import { useApp } from '../context/AppContext.jsx'

export default function DashboardTab() {
  const { state } = useApp()
  return (
    <>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: '0 0 20px' }}>แดชบอร์ด</h1>
      <div data-role="admin-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
        <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 20, animation: 'dc-fade-up 0.35s ease both' }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: '#E8F5E9', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <span style={{ width: 11, height: 11, borderRadius: '50% 50% 50% 0', background: '#2E7D32', transform: 'rotate(-45deg)' }}></span>
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#1B5E20' }}>{state.places.length}</div>
          <div style={{ fontSize: 13, color: '#6d7a72' }}>สถานที่ทั้งหมด</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 20, animation: 'dc-fade-up 0.35s ease 0.05s both' }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: '#FDEEE3', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <span style={{ width: 14, height: 12, border: '2px solid #E07B39', borderRadius: 2, position: 'relative' }}>
              <span style={{ position: 'absolute', top: -4, left: 2, width: 2, height: 5, background: '#E07B39' }}></span>
              <span style={{ position: 'absolute', top: -4, right: 2, width: 2, height: 5, background: '#E07B39' }}></span>
            </span>
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#1B5E20' }}>{state.events.length}</div>
          <div style={{ fontSize: 13, color: '#6d7a72' }}>อีเวนท์ทั้งหมด</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 20, animation: 'dc-fade-up 0.35s ease 0.1s both' }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: '#E8F5E9', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <span style={{ width: 15, height: 11, background: '#2E7D32', borderRadius: '4px 4px 4px 0' }}></span>
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#1B5E20' }}>{state.knowledgeBase.length}</div>
          <div style={{ fontSize: 13, color: '#6d7a72' }}>องค์ความรู้แชทบอท</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #FFE082', borderRadius: 16, padding: 20, animation: 'dc-fade-up 0.35s ease 0.15s both' }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: '#FFF8E1', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <span style={{ width: 14, height: 11, border: '2px solid #7A5205', borderRadius: 2, position: 'relative', display: 'inline-block' }}>
              <span style={{ position: 'absolute', top: 1, left: 2.5, width: 5, height: 5, borderRadius: '50%', border: '1.5px solid #7A5205' }}></span>
            </span>
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#7A5205' }}>{state.userPoints}</div>
          <div style={{ fontSize: 13, color: '#7A5205' }}>พอยท์ที่แจกไปแล้ว</div>
        </div>
      </div>
    </>
  )
}
