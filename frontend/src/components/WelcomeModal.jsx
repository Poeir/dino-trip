import { useApp } from '../context/AppContext.jsx'
import { MASCOT } from '../data/categoryImages.js'
import AiNotice from './AiNotice.jsx'
import { WELCOME_SNOOZE_DAYS } from '../lib/welcomeSnooze.js'

export default function WelcomeModal() {
  const { state, actions } = useApp()
  if (!state.welcomeModalOpen) return null
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,35,20,0.55)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, animation: 'dc-fade 0.3s ease both' }}>
      <div style={{ background: '#fff', borderRadius: 24, maxWidth: 520, width: '100%', padding: 36, position: 'relative', animation: 'dc-pop 0.32s ease both', boxShadow: '0 30px 70px rgba(0,0,0,0.3)' }}>
        <button onClick={actions.closeWelcomeModal} style={{ position: 'absolute', top: 16, right: 16, background: '#F1F8E9', border: 'none', width: 32, height: 32, borderRadius: '50%', fontSize: 16, color: '#3c463f', cursor: 'pointer' }}>×</button>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <img src={MASCOT.wave} alt="" width={130} height={130} style={{ width: 130, height: 'auto', margin: '0 auto 8px', display: 'block', animation: 'dc-float 3.4s ease-in-out infinite' }} />
          <h2 data-font="culture" style={{ fontSize: 20, fontWeight: 800, color: '#1B5E20', margin: '0 0 4px' }}>สวัสดีครับ! ผม น้องไดโน พร้อมช่วยเหลือแล้วครับ</h2>
          <p style={{ fontSize: 13.5, color: '#5f6a63', margin: 0 }}>สามารถเริ่มฟังก์ชันพิเศษได้เลย</p>
        </div>
        <div style={{ marginBottom: 14 }}><AiNotice variant="compact" /></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 22 }}>
          <div onClick={actions.welcomeGoTrip} style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#F1F8E9', borderRadius: 16, padding: '14px 16px', cursor: 'pointer' }}>
            <span style={{ width: 20, height: 20, background: '#FBC02D', flexShrink: 0, transform: 'rotate(45deg)', borderRadius: 4, position: 'relative' }}><span style={{ position: 'absolute', inset: 5, background: '#fff', transform: 'rotate(0deg)', borderRadius: 2 }}></span></span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14.5, color: '#1B5E20' }}>AI ช่วยวางแผนทริป</div>
              <div style={{ fontSize: 12.5, color: '#5f6a63' }}>ตอบไม่กี่คำถาม รับตารางเที่ยวรายวันทันที</div>
            </div>
          </div>
          <div onClick={actions.welcomeGoPoints} style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#FFF8E1', borderRadius: 16, padding: '14px 16px', cursor: 'pointer' }}>
            <span style={{ width: 20, height: 14, border: '2px solid #7A5205', borderRadius: 3, position: 'relative', display: 'inline-block', flexShrink: 0 }}><span style={{ position: 'absolute', top: 2, left: 4, width: 8, height: 8, borderRadius: '50%', border: '2px solid #7A5205' }}></span></span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14.5, color: '#7A5205' }}>สแกน QR สะสมพอยท์</div>
              <div style={{ fontSize: 12.5, color: '#7A5205' }}>สแกนตามสถานที่ท่องเที่ยว แลกของรางวัลได้ทันที</div>
            </div>
          </div>
        </div>
        <button onClick={actions.closeWelcomeModal} style={{ width: '100%', background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: 13, borderRadius: 20, fontWeight: 800, fontSize: 14.5, cursor: 'pointer' }}>เริ่มสำรวจขอนแก่น</button>
        <button onClick={actions.snoozeWelcomeModal} style={{ display: 'block', margin: '12px auto 0', background: 'none', border: 'none', color: '#5f6a63', fontSize: 12.5, textDecoration: 'underline', cursor: 'pointer', padding: 4 }}>ไม่แสดงอีก {WELCOME_SNOOZE_DAYS} วัน</button>
      </div>
    </div>
  )
}
