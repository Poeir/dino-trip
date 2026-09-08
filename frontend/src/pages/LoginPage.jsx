import { useApp } from '../context/AppContext.jsx'
import { MailIcon, LockIcon, GiftIcon, RouteIcon, StarIcon, PinIcon } from '../components/Icons.jsx'

const labelStyle = { fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }
const inputStyle = { width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 16 }

function FieldLabel({ icon: Icon, children }) {
  return <label style={labelStyle}><Icon size={15} box={false} />{children}</label>
}

function PerkChip({ icon: Icon, text }) {
  return (
    <span style={{
      background: '#E8F5E9', border: '1px solid rgba(46,125,50,0.4)', color: '#1B5E20',
      borderRadius: 20, padding: '5px 13px', fontSize: 12, fontWeight: 600,
      display: 'inline-flex', alignItems: 'center', gap: 5,
    }}>
      <Icon size={13} box={false} />{text}
    </span>
  )
}

// Turns "poori.chan@example.com" into "Poori.chan" -- a light, live echo of
// who's about to sign in, the same "card mirrors the form" idea as the
// signup persona card, just without real profile fields to draw from yet.
function guessNameFromEmail(email) {
  const local = email.split('@')[0]?.trim()
  if (!local) return ''
  const cleaned = local.replace(/[._-]+/g, ' ').trim()
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase())
}

// Welcome-back card mirroring the signup persona card's shape (same gradient,
// dashed ticket-stub divider, mascot stamp) but with static feature chips
// instead of fill-in-progress ones, since login has no profile to build.
function WelcomeCard({ state }) {
  const guessedName = guessNameFromEmail(state.authForm.email)
  const initial = guessedName.charAt(0).toUpperCase()

  return (
    <div style={{
      position: 'sticky', top: 92, borderRadius: 20, overflow: 'hidden', color: '#1f2a24',
      background: 'linear-gradient(165deg, #FFFDF6, #F1F8E9)', border: '1px solid #E7E3D2',
      boxShadow: '0 16px 32px rgba(46,125,50,0.12)', padding: '26px 24px 22px',
      display: 'flex', flexDirection: 'column', minHeight: 460,
      animation: 'dc-slide-in 0.5s ease both',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p data-font="culture" style={{ margin: 0, color: '#1B5E20', fontSize: 15, fontWeight: 800 }}>บัตรสมาชิก Dino</p>
          <p style={{ margin: '3px 0 0', color: '#8a938c', fontSize: 12 }}>ยินดีต้อนรับกลับ</p>
        </div>
        <div style={{ transform: 'rotate(9deg)', textAlign: 'center', flexShrink: 0, animation: 'dc-pop 0.4s cubic-bezier(.34,1.56,.64,1) 0.3s both' }}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', border: '2px solid #FBC02D', padding: 3, background: '#fff', animation: 'dc-pulse 2.4s ease-in-out infinite' }}>
            <img src="./assets/chatbot-icon.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '50%' }} />
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 9, fontWeight: 800, color: '#1B5E20' }}>สมาชิก</p>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '18px 0' }}>
        <div style={{
          width: 108, height: 108, borderRadius: '50%', marginBottom: 14, overflow: 'hidden',
          background: initial ? 'linear-gradient(135deg,#66BB6A,#388E3C)' : '#F1F8E9',
          border: '4px solid rgba(46,125,50,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'dc-float 3.4s ease-in-out infinite',
        }}>
          {initial
            ? <span data-font="culture" style={{ fontSize: 40, fontWeight: 900, color: '#fff' }}>{initial}</span>
            : <img src="./assets/chatbot-icon.png" alt="" style={{ width: '70%', height: '70%', objectFit: 'contain' }} />}
        </div>

        <h2 data-font="culture" style={{ margin: 0, fontSize: 21, fontWeight: 800, color: '#1B5E20' }}>
          สวัสดี{guessedName ? `, ${guessedName}` : ''}
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#8a938c' }}>เข้าสู่ระบบเพื่อไปต่อจากที่ค้างไว้</p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 16 }}>
          <PerkChip icon={GiftIcon} text="แต้มสะสม" />
          <PerkChip icon={RouteIcon} text="แผนทริป AI" />
          <PerkChip icon={StarIcon} text="ของรางวัลพิเศษ" />
        </div>
      </div>

      <div style={{ borderTop: '1.5px dashed #DCD8C6', paddingTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 12.5, color: '#1f2a24' }}>
          <PinIcon color="#2E7D32" box={false} />
          <span>เที่ยวขอนแก่นแบบไม่พลาดทุกจุด</span>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  const { state, actions } = useApp()
  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '70px 32px' }}>
      <h1 data-font="culture" style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: '0 0 22px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, animation: 'dc-fade-up 0.4s ease both' }}>
        <img src="./assets/dino-logo-mark.png" alt="" style={{ width: 26, height: 26 }} />
        เข้าสู่ระบบ Dino
      </h1>
      <div data-role="login-grid" style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 28, alignItems: 'start' }}>
        <WelcomeCard state={state} />
        <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 26, animation: 'dc-fade-up 0.5s ease 0.1s both' }}>
          <FieldLabel icon={MailIcon}>อีเมล</FieldLabel>
          <input className="dc-signup-input" value={state.authForm.email} onChange={actions.onAuthEmailChange} placeholder="you@email.com" style={inputStyle} />
          <FieldLabel icon={LockIcon}>รหัสผ่าน</FieldLabel>
          <input className="dc-signup-input" type="password" value={state.authForm.password} onChange={actions.onAuthPasswordChange} placeholder="••••••••" style={{ ...inputStyle, marginBottom: 8 }} />
          <div style={{ textAlign: 'right', marginBottom: 16 }}>
            <a href="#" onClick={(e) => { e.preventDefault(); actions.goForgotPassword() }} style={{ fontSize: 12.5, color: '#6d7a72' }}>ลืมรหัสผ่าน?</a>
          </div>
          {state.authError && <div style={{ background: '#fdecec', color: '#a33232', fontSize: 13, padding: '8px 12px', borderRadius: 8, marginBottom: 14, animation: 'dc-pop 0.25s ease both' }}>{state.authError}</div>}
          <button onClick={actions.submitLogin} disabled={state.authSubmitting} className="dc-signup-cta" style={{ width: '100%', background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: 12, borderRadius: 20, fontWeight: 800, fontSize: 14.5, cursor: state.authSubmitting ? 'default' : 'pointer', opacity: state.authSubmitting ? 0.7 : 1 }}>{state.authSubmitting ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}</button>
          <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13.5, color: '#6d7a72' }}>ยังไม่มีบัญชี? <a href="#" onClick={(e) => { e.preventDefault(); actions.goSignup() }} style={{ fontWeight: 700 }}>สมัครสมาชิก</a></div>
        </div>
      </div>
    </main>
  )
}
