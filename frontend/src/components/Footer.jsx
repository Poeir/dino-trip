import { useApp } from '../context/AppContext.jsx'

const iconWrapStyle = { width: 30, height: 30, borderRadius: '50%', background: 'rgba(27,94,32,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }

function PinIcon() {
  return (
    <span style={iconWrapStyle}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 22s7-7.58 7-13a7 7 0 1 0-14 0c0 5.42 7 13 7 13Z" stroke="#1B5E20" strokeWidth="2" strokeLinejoin="round" /><circle cx="12" cy="9" r="2.5" fill="#1B5E20" /></svg>
    </span>
  )
}

function FlagIcon() {
  return (
    <span style={iconWrapStyle}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 21V4" stroke="#1B5E20" strokeWidth="2" strokeLinecap="round" /><path d="M5 4h13l-3.2 4.5L18 13H5" stroke="#1B5E20" strokeWidth="2" strokeLinejoin="round" /></svg>
    </span>
  )
}

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

function ShareIcon() {
  return (
    <span style={iconWrapStyle}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="6" cy="12" r="2.4" stroke="#1B5E20" strokeWidth="1.8" /><circle cx="17" cy="6" r="2.4" stroke="#1B5E20" strokeWidth="1.8" /><circle cx="17" cy="18" r="2.4" stroke="#1B5E20" strokeWidth="1.8" /><path d="M8.2 10.8 14.8 7.2M8.2 13.2 14.8 16.8" stroke="#1B5E20" strokeWidth="1.8" /></svg>
    </span>
  )
}

function FooterColumn({ icon, label, value, extra }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 170 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {icon}
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1B5E20', letterSpacing: 0.2 }}>{label}</span>
      </div>
      <div style={{ fontSize: 13, color: '#3d4a41', paddingLeft: 40 }}>{value}</div>
      {extra}
    </div>
  )
}

export default function Footer() {
  const { actions } = useApp()
  return (
    <footer style={{ padding: '0 32px 22px', borderTop: '1px solid rgba(27,94,32,0.3)' }}>
      <div data-role="footer-inner" style={{ maxWidth: 1360, margin: '0 auto', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 32, padding: '26px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={actions.goHome}>
          <img src="./assets/dino-logo-full.png" alt="Dino Trip Planner" style={{ height: 92, width: 'auto' }} />
        </div>

        <div data-role="footer-info-stack" style={{ display: 'flex', alignItems: 'center', gap: 48, borderLeft: '1px solid rgba(27,94,32,0.25)', paddingLeft: 32, flexWrap: 'wrap' }}>
          <FooterColumn icon={<PinIcon />} label="ติดต่อเรา" value="ศูนย์ข้อมูลท่องเที่ยวขอนแก่น" />
          <FooterColumn icon={<FlagIcon />} label="พันธมิตร" value="การท่องเที่ยวแห่งประเทศไทย (ททท.) สำนักงานขอนแก่น" />
          <FooterColumn
            icon={<ShareIcon />}
            label="ติดตามเรา"
            value={
              <div style={{ display: 'flex', gap: 8 }}>
                <FacebookIcon />
                <InstagramIcon />
                <LineIcon />
              </div>
            }
            extra={
              <a href="#" onClick={(e) => { e.preventDefault(); actions.goAdminLogin() }} style={{ fontSize: 12, color: '#6d7a72', paddingLeft: 40, display: 'block', marginTop: 4 }}>สำหรับผู้ดูแลระบบ</a>
            }
          />
        </div>
      </div>
    </footer>
  )
}
