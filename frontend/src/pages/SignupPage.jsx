import { useRef } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { PinIcon, UserIcon, GenderIcon, CalendarIcon, BriefcaseIcon, MailIcon, PhoneIcon, LockIcon, CameraIcon, ZoomIcon } from '../components/Icons.jsx'
import Modal from '../components/Modal.jsx'

const labelStyle = { fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }
const inputStyle = { width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 16 }

function FieldLabel({ icon: Icon, children }) {
  return <label style={labelStyle}><Icon size={15} box={false} />{children}</label>
}

// Ticket-stub chip for a persona stat -- muted "?" placeholder before the
// matching form field is filled in, so the card visibly fills in as the
// visitor types instead of jumping from nothing to something.
function PersonaChip({ text, filled }) {
  return (
    <span style={{
      background: filled ? '#E8F5E9' : '#F7F5EC',
      border: `1px solid ${filled ? 'rgba(46,125,50,0.4)' : '#E7E3D2'}`,
      color: filled ? '#1B5E20' : '#a9b3ac',
      borderRadius: 20, padding: '5px 13px', fontSize: 12, fontWeight: 600,
    }}>
      {text}
    </span>
  )
}

function personaAvatarContent(avatarUrl, avatarPosition, avatarScale, initial, personaAvatarOptions) {
  if (avatarUrl?.startsWith('preset:')) {
    const opt = personaAvatarOptions.find((o) => `preset:${o.key}` === avatarUrl)
    if (opt) return { bg: opt.bg, node: <span style={{ fontSize: 58 }}>{opt.emoji}</span>, isPhoto: false }
  }
  if (avatarUrl) {
    const [x, y] = avatarPosition.split(' ')
    return {
      bg: '#fff', isPhoto: true,
      node: <img src={avatarUrl} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${x}% ${y}%`, transform: `scale(${avatarScale})`, transformOrigin: 'center' }} />,
    }
  }
  if (initial) return { bg: 'linear-gradient(135deg,#66BB6A,#388E3C)', node: <span data-font="culture" style={{ fontSize: 48, fontWeight: 900, color: '#fff' }}>{initial}</span>, isPhoto: false }
  return { bg: '#F1F8E9', node: <img src="./assets/chatbot-icon.png" alt="" style={{ width: '70%', height: '70%', objectFit: 'contain' }} />, isPhoto: false }
}

// Live-updating "membership pass" -- mirrors the form on the right so
// signing up feels like assembling a traveler identity, not filling a form.
function PersonaCard({ state, actions, derived }) {
  const f = state.authForm
  const titleLabel = derived.titleOptions.find((t) => t.value === f.title)?.label
  const fullName = `${titleLabel ? titleLabel + ' ' : ''}${f.firstName} ${f.lastName}`.trim()
  const initial = f.firstName.trim().charAt(0).toUpperCase()
  const genderLabel = derived.genderOptions.find((g) => g.value === f.gender)?.label
  const occupationLabel = derived.occupationOptions.find((o) => o.value === f.occupation)?.label
  const ageLabel = derived.authBirthdateAge != null ? `อายุ ${derived.authBirthdateAge} ปี` : null
  const addressParts = [
    f.subdistrict && `ตำบล${f.subdistrict}`,
    f.district && `อำเภอ${f.district}`,
    f.province && `จังหวัด${f.province}`,
  ].filter(Boolean)
  const buddhistYear = new Date().getFullYear() + 543
  const avatar = personaAvatarContent(f.avatarUrl, f.avatarPosition, f.avatarScale, initial, derived.personaAvatarOptions)

  return (
    <div style={{
      position: 'sticky', top: 92, borderRadius: 20, overflow: 'hidden', color: '#1f2a24',
      background: 'linear-gradient(165deg, #FFFDF6, #F1F8E9)', border: '1px solid #E7E3D2',
      boxShadow: '0 16px 32px rgba(46,125,50,0.12)', padding: '26px 24px 22px',
      display: 'flex', flexDirection: 'column', minHeight: 520,
      animation: 'dc-slide-in 0.5s ease both',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p data-font="culture" style={{ margin: 0, color: '#1B5E20', fontSize: 15, fontWeight: 800 }}>บัตรสมาชิก Dino</p>
          <p style={{ margin: '3px 0 0', color: '#8a938c', fontSize: 12 }}>ตัวตนนักเที่ยวของคุณ</p>
        </div>
        <div style={{ transform: 'rotate(9deg)', textAlign: 'center', flexShrink: 0, animation: 'dc-pop 0.4s cubic-bezier(.34,1.56,.64,1) 0.3s both' }}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', border: '2px solid #FBC02D', padding: 3, background: '#fff', animation: 'dc-pulse 2.4s ease-in-out infinite' }}>
            <img src="./assets/chatbot-icon.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '50%' }} />
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 9, fontWeight: 800, color: '#1B5E20' }}>สมาชิกใหม่</p>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '18px 0' }}>
        <div style={{
          width: 132, height: 132, borderRadius: '50%', marginBottom: 12, overflow: 'hidden', background: avatar.bg,
          border: '4px solid rgba(46,125,50,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'dc-float 3.4s ease-in-out infinite',
        }}>
          {avatar.node}
        </div>

        <div style={{ display: 'flex', gap: 5, justifyContent: 'center', flexWrap: 'wrap', maxWidth: 280, marginBottom: 6 }}>
          {derived.personaAvatarOptions.map((a) => (
            <button key={a.key} type="button" className="dc-avatar-swatch" onClick={() => actions.selectPersonaAvatarPreset(a.key)} title={a.key}
              style={{
                width: 26, height: 26, borderRadius: '50%', background: a.bg, fontSize: 13, padding: 0, cursor: 'pointer',
                border: f.avatarUrl === `preset:${a.key}` ? '2px solid #2E7D32' : '1px solid #E7E3D2',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
              {a.emoji}
            </button>
          ))}
          <label title="อัปโหลดรูปของคุณ" className="dc-avatar-swatch" style={{
            width: 26, height: 26, borderRadius: '50%', border: '1px dashed #8a938c', color: '#6d7a72',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>
            <CameraIcon size={13} color="#6d7a72" box={false} />
            <input type="file" accept="image/*" onChange={actions.onAuthAvatarFileChange} style={{ display: 'none' }} />
          </label>
        </div>
        {state.avatarUploading && <p style={{ margin: '0 0 4px', fontSize: 11, color: '#8a938c' }}>กำลังอัปโหลด...</p>}
        {state.avatarError && <p style={{ margin: '0 0 4px', fontSize: 11, color: '#a33232' }}>{state.avatarError}</p>}
        {avatar.isPhoto && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
            <button type="button" onClick={actions.openAvatarReposition} style={{ background: 'none', border: 'none', color: '#2E7D32', fontSize: 11, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>
              ปรับตำแหน่งรูป
            </button>
            <button type="button" onClick={actions.clearPersonaAvatar} style={{ background: 'none', border: 'none', color: '#8a938c', fontSize: 11, textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>
              ใช้รูปเริ่มต้น
            </button>
          </div>
        )}

        <h2 data-font="culture" style={{ margin: '10px 0 0', fontSize: 21, fontWeight: 800, color: '#1B5E20' }}>{fullName || 'นักผจญภัยคนใหม่'}</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 12 }}>
          <PersonaChip text={genderLabel || 'เพศ?'} filled={!!genderLabel} />
          <PersonaChip text={ageLabel || 'วันเกิด?'} filled={!!ageLabel} />
          <PersonaChip text={occupationLabel || 'อาชีพ?'} filled={!!occupationLabel} />
        </div>
      </div>

      <div style={{ borderTop: '1.5px dashed #DCD8C6', paddingTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: addressParts.length ? '#1f2a24' : '#a9b3ac' }}>
          <PinIcon color={addressParts.length ? '#2E7D32' : '#b7c2ba'} box={false} />
          <span>{addressParts.length ? addressParts.join(', ') : 'ยังไม่ระบุที่อยู่'}</span>
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 11, color: '#a9b3ac', textAlign: 'center' }}>สมาชิก Dino ตั้งแต่ปี {buddhistYear}</p>
      </div>
    </div>
  )
}

// Nothing reaches the server until "ยืนยัน" -- selecting a file (or
// reopening this to re-drag an already-uploaded photo) only ever touches
// local/already-hosted preview state; see confirmAvatarCrop in AppContext.
function AvatarCropModal({ state, actions }) {
  const dragRef = useRef(null)
  const [x, y] = state.avatarCropPosition.split(' ').map(Number)
  const scale = state.avatarCropScale

  const onPointerDown = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    dragRef.current = { startX: e.clientX, startY: e.clientY, posX: x, posY: y, w: rect.width, h: rect.height }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d) return
    const newX = d.posX - ((e.clientX - d.startX) / d.w) * 100
    const newY = d.posY - ((e.clientY - d.startY) / d.h) * 100
    actions.setAvatarCropPosition(newX, newY)
  }
  const onPointerUp = () => { dragRef.current = null }

  return (
    <Modal open={state.avatarCropOpen} onClose={actions.cancelAvatarCrop} title="ปรับตำแหน่งรูปโปรไฟล์" maxWidth={360}>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6d7a72', textAlign: 'center' }}>ลากรูปเพื่อเลือกส่วนที่จะแสดงในวงกลมโปรไฟล์</p>
      <div
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        style={{ position: 'relative', width: 280, height: 280, margin: '0 auto', borderRadius: 12, overflow: 'hidden', background: '#111', cursor: 'grab', touchAction: 'none' }}
      >
        {state.avatarCropObjectUrl && (
          <img src={state.avatarCropObjectUrl} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${x}% ${y}%`, transform: `scale(${scale})`, transformOrigin: 'center', pointerEvents: 'none' }} />
        )}
        <div style={{ position: 'absolute', width: 220, height: 220, top: 30, left: 30, borderRadius: '50%', boxShadow: '0 0 0 9999px rgba(15,25,18,0.6)', border: '2px solid #fff', pointerEvents: 'none' }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
        <ZoomIcon size={17} color="#8a938c" box={false} />
        <input
          type="range" min="1" max="3" step="0.05" value={scale}
          onChange={(e) => actions.setAvatarCropScale(Number(e.target.value))}
          style={{ flex: 1 }}
        />
      </div>

      {state.avatarError && <div style={{ marginTop: 14, background: '#fdecec', color: '#a33232', fontSize: 13, padding: '8px 12px', borderRadius: 8 }}>{state.avatarError}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button type="button" onClick={actions.cancelAvatarCrop} style={{ flex: 1, background: '#fff', border: '1px solid #DCD8C6', color: '#4a544d', padding: 11, borderRadius: 20, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
          ยกเลิก
        </button>
        <button type="button" onClick={actions.confirmAvatarCrop} style={{ flex: 1, background: 'linear-gradient(135deg,#66BB6A,#388E3C)', border: 'none', color: '#fff', padding: 11, borderRadius: 20, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
          ยืนยัน
        </button>
      </div>
    </Modal>
  )
}

export default function SignupPage() {
  const { state, actions, derived } = useApp()
  const isPending = state.authPendingConfirmation
  return (
    <main style={{ maxWidth: isPending ? 420 : 980, margin: '0 auto', padding: '70px 32px' }}>
      <h1 data-font="culture" style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: '0 0 22px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, animation: 'dc-fade-up 0.4s ease both' }}>
        <img src="./assets/dino-logo-mark.png" alt="" style={{ width: 26, height: 26 }} />
        สมัครสมาชิก Dino
      </h1>
      {isPending ? (
        <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 26, animation: 'dc-pop 0.4s ease both' }}>
          <div style={{ background: '#E8F5E9', color: '#1B5E20', fontSize: 13.5, padding: '14px 16px', borderRadius: 10, marginBottom: 14, lineHeight: 1.6 }}>
            เราส่งอีเมลยืนยันไปที่ <strong>{state.authForm.email}</strong> แล้ว กรุณาตรวจสอบกล่องจดหมาย (รวมถึงโฟลเดอร์สแปม) และคลิกลิงก์เพื่อยืนยันบัญชีก่อนเข้าสู่ระบบ
          </div>
          <div style={{ textAlign: 'center', fontSize: 13.5, color: '#6d7a72' }}>
            กรอกอีเมลผิด? <a href="#" onClick={(e) => { e.preventDefault(); actions.goSignup() }} style={{ fontWeight: 700 }}>แก้ไขข้อมูล</a>
          </div>
        </div>
      ) : (
        <div data-role="signup-grid" style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 28, alignItems: 'start' }}>
          <PersonaCard state={state} actions={actions} derived={derived} />
          <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 26, animation: 'dc-fade-up 0.5s ease 0.1s both' }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 0.7 }}>
                <FieldLabel icon={UserIcon}>คำนำหน้า</FieldLabel>
                <select className="dc-signup-input" value={state.authForm.title} onChange={actions.onAuthTitleChange} style={inputStyle}>
                  <option value="">เลือก</option>
                  {derived.titleOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <FieldLabel icon={UserIcon}>ชื่อ</FieldLabel>
                <input className="dc-signup-input" value={state.authForm.firstName} onChange={actions.onAuthFirstNameChange} placeholder="ชื่อจริง" style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <FieldLabel icon={UserIcon}>นามสกุล</FieldLabel>
                <input className="dc-signup-input" value={state.authForm.lastName} onChange={actions.onAuthLastNameChange} placeholder="นามสกุล" style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <FieldLabel icon={GenderIcon}>เพศ</FieldLabel>
                <select className="dc-signup-input" value={state.authForm.gender} onChange={actions.onAuthGenderChange} style={inputStyle}>
                  <option value="">เลือกเพศ</option>
                  {derived.genderOptions.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <FieldLabel icon={CalendarIcon}>วันเกิด{derived.authBirthdateAge != null ? ` (อายุ ${derived.authBirthdateAge} ปี)` : ''}</FieldLabel>
                <input className="dc-signup-input" type="date" value={state.authForm.birthdate} onChange={actions.onAuthBirthdateChange} max={new Date().toISOString().slice(0, 10)} style={inputStyle} />
              </div>
            </div>
            <FieldLabel icon={BriefcaseIcon}>อาชีพ</FieldLabel>
            <select className="dc-signup-input" value={state.authForm.occupation} onChange={actions.onAuthOccupationChange} style={inputStyle}>
              <option value="">เลือกอาชีพ</option>
              {derived.occupationOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <FieldLabel icon={MailIcon}>อีเมล</FieldLabel>
            <input className="dc-signup-input" value={state.authForm.email} onChange={actions.onAuthEmailChange} placeholder="you@email.com" style={inputStyle} />
            <FieldLabel icon={PhoneIcon}>เบอร์โทรศัพท์</FieldLabel>
            <input className="dc-signup-input" value={state.authForm.phone} onChange={actions.onAuthPhoneChange} placeholder="0812345678" style={inputStyle} />
            <FieldLabel icon={LockIcon}>รหัสผ่าน</FieldLabel>
            <input className="dc-signup-input" type="password" value={state.authForm.password} onChange={actions.onAuthPasswordChange} placeholder="••••••••" style={{ ...inputStyle, marginBottom: 8 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
              {derived.passwordRules.map((r) => (
                <span key={`${r.key}-${r.met}`} style={{ fontSize: 12, fontWeight: 600, color: r.met ? '#2E7D32' : '#a9b3ac', display: 'flex', alignItems: 'center', gap: 6, animation: 'dc-pop 0.25s ease both' }}>
                  <span style={{ fontWeight: 800 }}>{r.met ? '✓' : '○'}</span>{r.label}
                </span>
              ))}
            </div>
            <FieldLabel icon={LockIcon}>ยืนยันรหัสผ่าน</FieldLabel>
            <input className="dc-signup-input" type="password" value={state.authForm.confirmPassword} onChange={actions.onAuthConfirmPasswordChange} placeholder="••••••••" style={{ ...inputStyle, marginBottom: state.authForm.confirmPassword ? 6 : 16 }} />
            {state.authForm.confirmPassword && (
              <p key={derived.passwordsMatch} style={{ margin: '0 0 16px', fontSize: 12, fontWeight: 600, color: derived.passwordsMatch ? '#2E7D32' : '#a33232', animation: 'dc-pop 0.25s ease both' }}>
                {derived.passwordsMatch ? '✓ รหัสผ่านตรงกัน' : '✗ รหัสผ่านไม่ตรงกัน'}
              </p>
            )}

            <FieldLabel icon={PinIcon}>ที่อยู่ปัจจุบัน</FieldLabel>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <select className="dc-signup-input" value={state.authForm.province} onChange={actions.onAuthProvinceChange} style={{ ...inputStyle, marginBottom: 0, flex: 1 }}>
                <option value="">จังหวัด</option>
                {derived.provinceOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className="dc-signup-input" value={state.authForm.district} onChange={actions.onAuthDistrictChange} disabled={!state.authForm.province} style={{ ...inputStyle, marginBottom: 0, flex: 1 }}>
                <option value="">อำเภอ</option>
                {derived.districtOptions.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <select className="dc-signup-input" value={state.authForm.subdistrict} onChange={actions.onAuthSubdistrictChange} disabled={!state.authForm.district} style={{ ...inputStyle, marginBottom: 0, flex: 1 }}>
                <option value="">ตำบล</option>
                {derived.subdistrictOptions.map((sd) => <option key={sd} value={sd}>{sd}</option>)}
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: '#4a544d', marginBottom: 16, cursor: 'pointer' }}>
              <input type="checkbox" checked={state.authForm.consent} onChange={actions.onAuthConsentChange} style={{ marginTop: 2 }} />
              <span>ฉันยินยอมให้ Dino เก็บและใช้ข้อมูลส่วนบุคคล (คำนำหน้า, ชื่อ-นามสกุล, อีเมล, เพศ, วันเกิด, อาชีพ, ที่อยู่ปัจจุบัน, รูปโปรไฟล์ถ้ามี) เพื่อสร้างและดูแลบัญชีผู้ใช้ ตามนโยบายความเป็นส่วนตัว</span>
            </label>
            {state.authError && <div style={{ background: '#fdecec', color: '#a33232', fontSize: 13, padding: '8px 12px', borderRadius: 8, marginBottom: 14, animation: 'dc-pop 0.25s ease both' }}>{state.authError}</div>}
            <button onClick={actions.submitSignup} disabled={state.authSubmitting} className="dc-signup-cta" style={{ width: '100%', background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: 12, borderRadius: 20, fontWeight: 800, fontSize: 14.5, cursor: state.authSubmitting ? 'default' : 'pointer', opacity: state.authSubmitting ? 0.7 : 1 }}>{state.authSubmitting ? 'กำลังสมัครสมาชิก...' : 'สมัครสมาชิก'}</button>
            <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13.5, color: '#6d7a72' }}>มีบัญชีอยู่แล้ว? <a href="#" onClick={(e) => { e.preventDefault(); actions.goLogin() }} style={{ fontWeight: 700 }}>เข้าสู่ระบบ</a></div>
          </div>
        </div>
      )}
      <AvatarCropModal state={state} actions={actions} />
    </main>
  )
}
