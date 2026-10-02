import Avatar from '../components/Avatar.jsx'

const memberSince = (d) => (d ? new Date(d).toLocaleDateString('th-TH', { year: 'numeric', month: 'long' }) : '')
const TITLES = { mr: 'นาย', mrs: 'นาง', miss: 'นางสาว' }

// The profile's header: a membership pass whose perforated stub carries the
// point balance -- same ticket-stub language as the points card and emails.
export default function ProfilePass({ profile, onEditAvatar }) {
  const stats = profile.stats
  return (
    <div className="dc-pass-wrap">
      <div className="dc-pass">
        <div className="dc-pass-id">
          <button type="button" className="dc-pass-avatar" onClick={onEditAvatar} aria-label="เปลี่ยนรูปโปรไฟล์">
            <span className="dc-pass-ring"><Avatar user={profile} size={88} /></span>
            <span className="dc-pass-edit">เปลี่ยนรูป</span>
          </button>
          <div style={{ minWidth: 0 }}>
            <h1 data-font="culture" style={{ margin: 0, fontSize: 26, lineHeight: 1.25, fontWeight: 900, wordBreak: 'break-word' }}>
              {TITLES[profile.title] || ''}{profile.displayName}
            </h1>
            <div style={{ fontSize: 14, opacity: 0.85, marginTop: 4, wordBreak: 'break-all' }}>{profile.email}</div>
            <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 8 }}>สมาชิกตั้งแต่ {memberSince(profile.createdAt)}</div>
          </div>
        </div>

        <div className="dc-pass-stub">
          <div>
            <div style={{ fontSize: 12.5, color: '#8a6a1c', fontWeight: 700 }}>พอยท์คงเหลือ</div>
            <div data-font="culture" style={{ fontSize: 46, lineHeight: 1.1, fontWeight: 900, color: '#7A5205' }}>{profile.pointsBalance ?? 0}</div>
          </div>
          {stats && (
            <div style={{ fontSize: 12, color: '#626863', lineHeight: 1.7, marginTop: 4 }}>
              สแกนแล้ว {stats.scans} จุด<br />แลกรางวัลแล้ว {stats.redemptions} ครั้ง
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
