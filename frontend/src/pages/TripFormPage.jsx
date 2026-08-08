import { useApp } from '../context/AppContext.jsx'
import { CalendarIcon, HeartIcon, WalletIcon, ClockIcon } from '../components/Icons.jsx'
import TripLoadingPage from './TripLoadingPage.jsx'

export default function TripFormPage() {
  const { state, actions, derived } = useApp()
  if (state.tripPlanning) return <TripLoadingPage />
  const f = state.tripForm
  const steps = derived.stepMeta
  const progressFrac = state.tripStep / (steps.length - 1)

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px 70px' }}>
      <div style={{ textAlign: 'center', marginBottom: 34, animation: 'dc-fade-up 0.4s ease both' }}>
        <img src="./assets/dino-mascot-front.png" alt="" style={{ width: 76, height: 'auto', margin: '0 auto 14px', display: 'block', animation: 'dc-float 3.4s ease-in-out infinite' }} onError={(e) => { e.currentTarget.style.display = 'none' }} />
        <h1 data-font="culture" style={{ fontSize: 26, fontWeight: 900, color: '#1B5E20', margin: '0 0 6px' }}>วางแผนทริปด้วย AI</h1>
        <p style={{ color: '#8a938c', fontSize: 14, margin: 0 }}>แค่ 4 ขั้นตอน น้องไดโนจัดทริปในฝันให้คุณ</p>
      </div>

      <div data-role="trip-stepper" style={{ position: 'relative', maxWidth: 520, margin: '0 auto 40px', animation: 'dc-fade-up 0.4s ease 0.05s both' }}>
        <div style={{ position: 'absolute', top: 17, left: 17, right: 17, height: 3, background: '#E7E3D2', borderRadius: 2 }}></div>
        <div style={{ position: 'absolute', top: 17, left: 17, height: 3, width: `calc((100% - 34px) * ${progressFrac})`, background: 'linear-gradient(90deg,#66BB6A,#388E3C)', borderRadius: 2, transition: 'width 0.3s ease' }}></div>
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between' }}>
          {steps.map((st) => (
            <div key={st.n} onClick={st.onClick} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <span style={{ width: 34, height: 34, borderRadius: '50%', background: st.circleBg, border: `2px solid ${st.circleBorder}`, color: st.circleColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, transition: 'all 0.25s ease', boxShadow: st.active ? '0 0 0 4px rgba(251,192,45,0.28)' : 'none' }}>
                {st.done ? '✓' : st.n}
              </span>
              <span data-role="trip-stepper-label" style={{ fontSize: 12, fontWeight: st.labelWeight, color: st.labelColor, whiteSpace: 'nowrap' }}>{st.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div data-role="trip-form-card" style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 24, padding: 40, boxShadow: '0 18px 40px rgba(46,125,50,0.10)', minHeight: 380 }}>
        <div key={state.tripStep} style={{ animation: 'dc-fade-up 0.35s ease both' }}>

          {derived.isStep0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
                <CalendarIcon />
                <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1B5E20', margin: 0 }}>คุณจะเดินทางเมื่อไหร่?</h2>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
                {derived.datePresetOptions.map((p) => (
                  <button key={p.key} type="button" onClick={p.onClick} style={{ border: '1px solid #C8E6C9', background: '#F1F8E9', color: '#2E7D32', borderRadius: 20, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{p.label}</button>
                ))}
              </div>
              <div data-role="trip-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', marginBottom: 6 }}>วันเริ่มต้น</label>
                  <input type="date" value={f.startDate} onChange={actions.onStartDateChange} style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 10, padding: 11, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', marginBottom: 6 }}>วันสิ้นสุด</label>
                  <input type="date" value={f.endDate} min={f.startDate || undefined} onChange={actions.onEndDateChange} style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 10, padding: 11, fontSize: 14 }} />
                </div>
              </div>
              <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', marginBottom: 6 }}>พักที่ไหน?</label>
              <input value={f.accommodation} onChange={actions.onAccommodationChange} placeholder="เช่น โรงแรมพูลแมน ขอนแก่น" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 10, padding: 11, fontSize: 14, marginBottom: 18 }} />
              <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', marginBottom: 6 }}>มีสถานที่ที่อยากไปแน่ๆ มั้ย? (ถ้ามี)</label>
              {derived.mustGoChipsView.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {derived.mustGoChipsView.map((chip) => (
                    <span key={chip.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#E8F5E9', color: '#1B5E20', border: '1px solid #C8E6C9', borderRadius: 16, padding: '5px 6px 5px 12px', fontSize: 13, fontWeight: 700 }}>
                      {chip.name}
                      <button type="button" onClick={chip.onRemove} aria-label={`ลบ ${chip.name}`} style={{ background: 'transparent', border: 'none', color: '#2E7D32', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 4px' }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ position: 'relative' }}>
                <input
                  value={state.mustGoQuery}
                  onChange={actions.onMustGoQueryChange}
                  onKeyDown={actions.onMustGoKeyDown}
                  placeholder="พิมพ์ค้นหาสถานที่ แล้วกด Enter หรือเลือกจากรายการ"
                  style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 10, padding: 11, fontSize: 14 }}
                />
                {derived.mustGoSuggestionsView.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid #E7E3D2', borderRadius: 12, boxShadow: '0 12px 28px rgba(46,125,50,0.14)', zIndex: 5, overflow: 'hidden' }}>
                    {derived.mustGoSuggestionsView.map((sug) => (
                      <div key={sug.id} onClick={sug.onClick} style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13.5, display: 'flex', justifyContent: 'space-between', gap: 10, borderBottom: '1px solid #F1F1EA' }}>
                        <span style={{ fontWeight: 700, color: '#1f2a24' }}>{sug.name}</span>
                        <span style={{ color: '#8a938c', fontSize: 12 }}>{sug.category}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {derived.isStep1 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <HeartIcon />
                <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1B5E20', margin: 0 }}>คุณสนใจอะไรบ้าง?</h2>
              </div>
              <p style={{ color: '#8a938c', fontSize: 13, margin: '0 0 20px' }}>เลือกได้หลายข้อ</p>
              <div data-role="trip-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {derived.interestOptionsView.map((opt) => (
                  <div key={opt.label} onClick={opt.onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, borderRadius: 14, padding: 14, cursor: 'pointer', transition: 'all 0.2s ease', border: `2px solid ${opt.borderColor}`, background: opt.bg }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: opt.iconBg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15, flexShrink: 0 }}>{opt.letter}</div>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: opt.color }}>{opt.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {derived.isStep2 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
                <WalletIcon />
                <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1B5E20', margin: 0 }}>งบประมาณโดยรวม</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {derived.budgetOptionsView.map((opt) => (
                  <div key={opt.label} onClick={opt.onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 14, padding: '16px 18px', cursor: 'pointer', transition: 'all 0.2s ease', border: `2px solid ${opt.borderColor}`, background: opt.bg }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15, color: opt.color }}>{opt.label}</div>
                      <div style={{ fontSize: 12.5, color: opt.descColor, marginTop: 2 }}>{opt.desc}</div>
                    </div>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${opt.color}`, background: opt.dotBg }}></div>
                  </div>
                ))}
              </div>
              <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', margin: '22px 0 12px' }}>จังหวะการเที่ยว</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {derived.paceOptionsView.map((opt) => (
                  <div key={opt.label} onClick={opt.onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 14, padding: '16px 18px', cursor: 'pointer', transition: 'all 0.2s ease', border: `2px solid ${opt.borderColor}`, background: opt.bg }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15, color: opt.color }}>{opt.label}</div>
                      <div style={{ fontSize: 12.5, color: opt.descColor, marginTop: 2 }}>{opt.desc}</div>
                    </div>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${opt.color}`, background: opt.dotBg }}></div>
                  </div>
                ))}
              </div>
              <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', margin: '22px 0 12px' }}>ขอบเขตพื้นที่</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {derived.areaScopeOptionsView.map((opt) => (
                  <div key={opt.label} onClick={opt.onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 14, padding: '16px 18px', cursor: 'pointer', transition: 'all 0.2s ease', border: `2px solid ${opt.borderColor}`, background: opt.bg }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15, color: opt.color }}>{opt.label}</div>
                      <div style={{ fontSize: 12.5, color: opt.descColor, marginTop: 2 }}>{opt.desc}</div>
                    </div>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${opt.color}`, background: opt.dotBg }}></div>
                  </div>
                ))}
              </div>
            </>
          )}

          {derived.isStep3 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
                <ClockIcon />
                <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1B5E20', margin: 0 }}>เดินทางช่วงเวลาไหนในแต่ละวัน?</h2>
              </div>
              <div data-role="trip-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', marginBottom: 6 }}>เริ่มวันละ</label>
                  <input type="time" value={f.dailyStart} onChange={actions.onDailyStartChange} style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 10, padding: 11, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', marginBottom: 6 }}>สิ้นสุดวันละ</label>
                  <input type="time" value={f.dailyEnd} min={f.dailyStart || undefined} onChange={actions.onDailyEndChange} style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 10, padding: 11, fontSize: 14 }} />
                </div>
              </div>
            </>
          )}

          {state.tripFormError && (
            <div style={{ background: '#fdecec', color: '#a33232', fontSize: 13.5, padding: '10px 14px', borderRadius: 8, marginTop: 16 }}>{state.tripFormError}</div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 30 }}>
          <button onClick={actions.prevStep} style={{ background: 'transparent', color: '#6d7a72', border: 'none', padding: '13px 10px', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: derived.prevOpacity }}>← ย้อนกลับ</button>
          <button onClick={derived.onPrimaryStep} style={{ flex: 1, background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: 14, borderRadius: 20, fontWeight: 800, fontSize: 15, cursor: 'pointer', boxShadow: '0 10px 22px rgba(46,125,50,0.25)' }}>{derived.primaryLabel}</button>
        </div>
      </div>
    </main>
  )
}
