import { Link } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import { Card, ghostBtn } from './ui.jsx'

const fmtDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }) : '-')

export default function OverviewTab({ profile }) {
  const { derived } = useApp()
  const labelOf = (options, value) => options.find((o) => o.value === value)?.label || '-'
  const address = [profile.subdistrict, profile.district, profile.province].filter(Boolean).join(' ')

  return (
    <>
      <Card title="สะสมพอยท์">
        <p style={{ margin: '0 0 14px', fontSize: 14, color: '#4a544d', lineHeight: 1.7 }}>
          สแกน QR ที่สถานที่ท่องเที่ยวเพื่อรับพอยท์ แล้วนำไปแลกของรางวัลที่เคาน์เตอร์ โดยแจ้งชื่อหรือเบอร์โทรที่สมัครไว้กับเจ้าหน้าที่
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link to="/points" style={{ background: 'linear-gradient(135deg,#f9a825,#FBC02D)', color: '#1B5E20', padding: '11px 22px', borderRadius: 22, fontWeight: 800, fontSize: 14, textDecoration: 'none' }}>สแกน QR</Link>
          <Link to="/profile?tab=history" style={{ ...ghostBtn, textDecoration: 'none' }}>ดูประวัติพอยท์</Link>
        </div>
      </Card>

      <Card title="ข้อมูลของฉัน" action={<Link to="/profile?tab=info" style={{ color: '#2E7D32', fontSize: 13, fontWeight: 700 }}>แก้ไข</Link>}>
        <dl className="dc-rows">
          <dt>เบอร์โทรศัพท์</dt><dd>{profile.phone || '-'}</dd>
          <dt>ที่อยู่</dt><dd>{address || '-'}</dd>
          <dt>วันเกิด</dt><dd>{fmtDate(profile.birthdate)}</dd>
          <dt>เพศ</dt><dd>{labelOf(derived.genderOptions, profile.gender)}</dd>
          <dt>อาชีพ</dt><dd>{labelOf(derived.occupationOptions, profile.occupation)}</dd>
        </dl>
      </Card>
    </>
  )
}
