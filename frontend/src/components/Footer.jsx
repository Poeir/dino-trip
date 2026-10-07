import { useApp } from '../context/AppContext.jsx'

const iconWrapStyle = { width: 30, height: 30, borderRadius: '50%', background: 'rgba(27,94,32,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }

function FacebookIcon() {
  return (
    <span style={iconWrapStyle}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M15 8.5h2V5h-2c-2.2 0-4 1.8-4 4v2H9v3.5h2V21h3.5v-6.5H17l.5-3.5h-3V9c0-.6.4-.5 1-.5Z" fill="#1B5E20" /></svg>
    </span>
  )
}

function InstagramIcon() {
  return (
    <span style={iconWrapStyle}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="3.5" width="17" height="17" rx="5" stroke="#1B5E20" strokeWidth="2" /><circle cx="12" cy="12" r="4" stroke="#1B5E20" strokeWidth="2" /><circle cx="17.2" cy="6.8" r="1.2" fill="#1B5E20" /></svg>
    </span>
  )
}

function LineIcon() {
  return (
    <span style={iconWrapStyle}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 11.5C4 6.8 8.2 3 12 3s8 3.8 8 8.5c0 4.4-4.6 8.2-8 8.5-.8.1-1.4-.1-2.1.3l-2.6 1.5c-.4.2-.6 0-.5-.4l.5-2c.1-.4 0-.6-.3-.8C4.9 17.4 4 14.6 4 11.5Z" stroke="#1B5E20" strokeWidth="1.8" strokeLinejoin="round" /></svg>
    </span>
  )
}

const logoStyle = { height: 34, width: 'auto', display: 'block', objectFit: 'contain' }

export default function Footer() {
  const { actions } = useApp()
  return (
    <footer style={{ padding: '0 32px', borderTop: '1px solid rgba(27,94,32,0.3)' }}>
      <div data-role="footer-inner" style={{ maxWidth: 1360, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: '16px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={actions.goHome}>
          <img src="/assets/dino-logo-full.webp" alt="Dino Trip Planner" width={103} height={52} loading="lazy" decoding="async" style={{ height: 52, width: 'auto' }} />
        </div>

        <div data-role="footer-info-stack" style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', flex: '1 1 420px', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img src="/assets/logos/cpkku.webp" alt="วิทยาลัยการคอมพิวเตอร์ มหาวิทยาลัยขอนแก่น" width={113} height={34} loading="lazy" decoding="async" style={{ height: 34, width: 'auto', display: 'block' }} />
            <img src="/assets/logos/kku.webp" alt="มหาวิทยาลัยขอนแก่น" width={73} height={34} loading="lazy" decoding="async" style={logoStyle} />
            <img src="/assets/logos/tat.webp" alt="การท่องเที่ยวแห่งประเทศไทย" width={40} height={40} loading="lazy" decoding="async" style={{ height: 40, width: 'auto', display: 'block' }} />
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#3d4a41', maxWidth: 420 }}>
            <span style={{ fontWeight: 700, color: '#1B5E20' }}>สร้างสรรค์โดย </span>
            วิทยาลัยการคอมพิวเตอร์ มหาวิทยาลัยขอนแก่น ร่วมกับ การท่องเที่ยวแห่งประเทศไทย (ททท.) สำนักงานขอนแก่น
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FacebookIcon />
          <InstagramIcon />
          <LineIcon />
          <a href="#" onClick={(e) => { e.preventDefault(); actions.goAdminLogin() }} style={{ fontSize: 12, color: '#5f6a63', marginLeft: 8 }}>สำหรับผู้ดูแลระบบ</a>
        </div>
      </div>
      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '0 0 12px', textAlign: 'center', fontSize: 11.5, color: '#7a847d' }}>
        เวอร์ชัน Preview {/^\d/.test(__APP_VERSION__) ? `v${__APP_VERSION__}` : __APP_VERSION__}
      </div>
    </footer>
  )
}
