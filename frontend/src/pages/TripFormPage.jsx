import { ArrowLeft, Check, X } from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import { CalendarIcon, HeartIcon, WalletIcon, ClockIcon, PinIcon } from '../components/Icons.jsx'
import { MASCOT } from '../data/categoryImages.js'
import TripLoadingPage from './TripLoadingPage.jsx'
import LocationPicker from '../components/LocationPicker.jsx'
import { useSeo } from '../lib/useSeo.js'
import AiNotice from '../components/AiNotice.jsx'

export default function TripFormPage() {
  const { state, actions, derived } = useApp()
  useSeo({
    title: 'วางแผนทริปขอนแก่นด้วย AI',
    description: 'ให้น้องไดโนผู้ช่วย AI จัดแผนเที่ยวขอนแก่นให้ตามจำนวนวัน งบประมาณ และความสนใจของคุณ ได้ตารางเที่ยวรายวัน พร้อมเส้นทางและเวลาเปิดปิดของแต่ละที่',
    path: '/trip',
  })
  if (state.tripPlanning) return <TripLoadingPage />
  const f = state.tripForm
  const steps = derived.stepMeta
  const progressFrac = state.tripStep / (steps.length - 1)

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--page-pt) var(--page-gutter) var(--page-pb)' }}>
      <AiNotice variant="popup" />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 30, animation: 'dc-fade-up 0.4s ease both' }}>
        <img src={MASCOT.map} alt="" style={{ width: 84, height: 84, objectFit: 'contain', flexShrink: 0, animation: 'dc-float 3.4s ease-in-out infinite' }} />
        <div>
          <h1 data-font="culture" style={{ fontSize: 26, fontWeight: 900, color: '#1B5E20', margin: '0 0 6px' }}>วางแผนทริปด้วย AI</h1>
          <p style={{ color: '#626863', fontSize: 14, margin: 0 }}>แค่ 4 ขั้นตอน น้องไดโนจัดทริปในฝันให้คุณ</p>
        </div>
      </div>

      <div data-role="trip-stepper" style={{ position: 'relative', maxWidth: 520, margin: '0 auto 40px', animation: 'dc-fade-up 0.4s ease 0.05s both' }}>
        <div style={{ position: 'absolute', top: 17, left: 17, right: 17, height: 3, background: '#E7E3D2', borderRadius: 2 }}></div>
        <div style={{ position: 'absolute', top: 17, left: 17, height: 3, width: `calc((100% - 34px) * ${progressFrac})`, background: 'linear-gradient(90deg,#66BB6A,#388E3C)', borderRadius: 2, transition: 'width 0.3s ease' }}></div>
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between' }}>
          {steps.map((st) => (
            <div key={st.n} onClick={st.onClick} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <span style={{ width: 34, height: 34, borderRadius: '50%', background: st.circleBg, border: `2px solid ${st.circleBorder}`, color: st.circleColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, transition: 'all 0.25s ease', boxShadow: st.active ? '0 0 0 4px rgba(251,192,45,0.28)' : 'none' }}>
                {st.done ? <Check size={17} strokeWidth={3} /> : st.n}
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
                <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1B5E20', margin: 0 }}>การเดินทางของคุณ</h2>
              </div>
              {/* Start date + number of days (1..MAX_TRIP_DAYS) instead of a
                  start/end date pair: the date still matters (opening hours
                  per weekday, holidays), the end date is derived. */}
              <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', marginBottom: 8 }}>เริ่มเที่ยววันไหน?</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 18 }}>
                {derived.datePresetOptions.map((p) => (
                  <button key={p.key} type="button" onClick={p.onClick} style={{ border: '1px solid #C8E6C9', background: '#F1F8E9', color: '#2E7D32', borderRadius: 20, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{p.label}</button>
                ))}
                <input type="date" value={f.startDate} onChange={actions.onStartDateChange} aria-label="วันเริ่มเที่ยว" style={{ flex: '1 1 160px', minWidth: 0, border: '1px solid #DCD8C6', borderRadius: 10, padding: 10, fontSize: 14 }} />
              </div>
              <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', marginBottom: 8 }}>เที่ยวกี่วัน?</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {derived.dayCountOptionsView.map((opt) => (
                  <button
                    key={opt.n} type="button" onClick={opt.onClick} aria-pressed={opt.active}
                    style={{ minWidth: 64, borderRadius: 12, padding: '9px 12px', cursor: 'pointer', transition: 'all 0.2s ease', border: `2px solid ${opt.borderColor}`, background: opt.bg, color: opt.color, fontSize: 13.5, fontWeight: 800 }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 12.5, color: derived.tripRangeLabel ? '#2E7D32' : '#626863', fontWeight: derived.tripRangeLabel ? 700 : 400, margin: '8px 0 20px' }}>
                {derived.tripRangeLabel || 'เลือกวันเริ่มเที่ยวก่อน แล้วจะเห็นช่วงวันที่ตรงนี้'}
              </p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20' }}>{derived.startPointView.question}</label>
                <button
                  type="button" onClick={actions.useCurrentLocationForAccommodation}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid #C8E6C9', background: '#F1F8E9', color: '#2E7D32', borderRadius: 20, padding: '5px 12px 5px 8px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  <span style={{ transform: 'scale(0.6)', display: 'flex' }}><PinIcon box={false} /></span>
                  ตำแหน่งปัจจุบัน
                </button>
              </div>
              <LocationPicker
                value={f.accommodation?.lat != null ? { lat: f.accommodation.lat, lng: f.accommodation.lng } : null}
                onChange={actions.onAccommodationLocationChange}
                onSelectPlace={actions.onAccommodationSelect}
                height={160}
                showCoordinates={false}
              />
              {/* One status line, never both at once -- what's picked (name
                  only; the map pin already shows exactly where) once
                  something's set, otherwise the fallback-behavior notice. */}
              {f.accommodation?.lat != null ? (
                <p style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: '#2E7D32', fontWeight: 700, margin: '8px 0 18px' }}>
                  <span style={{ transform: 'scale(0.6)', display: 'flex' }}><PinIcon box={false} /></span>
                  {f.accommodation.name || 'ปักหมุดไว้แล้ว'}
                </p>
              ) : (
                <p style={{ fontSize: 11.5, color: '#626863', margin: '8px 0 18px' }}>{derived.startPointView.emptyHint}</p>
              )}

              {/* Where the last day ends (chatbot-service trip_end): back at
                  the start by default, or a departure / another district.
                  Next to the stay so the whole journey is set in one place. */}
              <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', marginBottom: 2 }}>วันสุดท้ายจบที่ไหน?</label>
              <p style={{ fontSize: 11.5, color: '#626863', margin: '0 0 10px' }}>ต้องไปขึ้นเครื่อง ขึ้นรถ หรือเดินทางต่อไปอำเภออื่น? น้องไดโนจะจัดวันสุดท้ายให้ผ่านทางและไปถึงทันเวลา</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {derived.tripEndOptionsView.map((opt) => (
                  <button
                    key={opt.kind} type="button" onClick={opt.onClick} aria-pressed={opt.active}
                    style={{ borderRadius: 999, padding: '7px 14px', cursor: 'pointer', transition: 'all 0.2s ease', border: `2px solid ${opt.borderColor}`, background: opt.bg, color: opt.color, fontSize: 12.5, fontWeight: 700 }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {derived.tripEndView.kind === 'district' && (
                <div style={{ marginTop: 12 }}>
                  <select value={derived.tripEndView.district} onChange={actions.onTripEndDistrictChange} aria-label="อำเภอที่จะไปจบทริป" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 10, padding: 11, fontSize: 14, background: '#fff' }}>
                    <option value="">เลือกอำเภอ</option>
                    {derived.tripEndView.districts.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              )}
              {derived.tripEndView.kind === 'pin' && (
                <div style={{ marginTop: 12 }}>
                  <LocationPicker
                    value={derived.tripEndView.pin?.lat != null ? { lat: derived.tripEndView.pin.lat, lng: derived.tripEndView.pin.lng } : null}
                    onChange={actions.onTripEndPinChange}
                    onSelectPlace={actions.onTripEndPinSelect}
                    height={160}
                    showCoordinates={false}
                  />
                  {derived.tripEndView.pin?.lat != null && (
                    <p style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: '#2E7D32', fontWeight: 700, margin: '8px 0 0' }}>
                      <span style={{ transform: 'scale(0.6)', display: 'flex' }}><PinIcon box={false} /></span>
                      {derived.tripEndView.pin.name || 'ปักหมุดไว้แล้ว'}
                    </p>
                  )}
                </div>
              )}
              {derived.tripEndView.timeLabel && (
                <div style={{ marginTop: 12, maxWidth: 260 }}>
                  <label style={{ fontSize: 12.5, fontWeight: 700, color: '#1B5E20', display: 'block', marginBottom: 6 }}>{derived.tripEndView.timeLabel}</label>
                  <input type="time" value={derived.tripEndView.time} onChange={actions.onTripEndTimeChange} style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 10, padding: 11, fontSize: 14 }} />
                </div>
              )}
              {derived.tripEndView.hint && (
                <p style={{ fontSize: 12.5, color: '#2E7D32', margin: '8px 0 0' }}>{derived.tripEndView.hint}</p>
              )}
            </>
          )}

          {derived.isStep1 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <HeartIcon />
                <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1B5E20', margin: 0 }}>คุณสนใจอะไรบ้าง?</h2>
              </div>
              <p style={{ color: '#626863', fontSize: 13, margin: '0 0 20px' }}>เลือกได้หลายข้อ</p>
              <div data-role="trip-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {derived.interestOptionsView.map((opt) => (
                  <div key={opt.label} onClick={opt.onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, borderRadius: 14, padding: 14, cursor: 'pointer', transition: 'all 0.2s ease', border: `2px solid ${opt.borderColor}`, background: opt.bg }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: opt.iconBg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15, flexShrink: 0 }}>{opt.letter}</div>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: opt.color }}>{opt.label}</span>
                  </div>
                ))}
              </div>

              <h2 style={{ fontSize: 17, fontWeight: 800, color: '#1B5E20', margin: '26px 0 4px' }}>อยากกินอะไร?</h2>
              <p style={{ color: '#626863', fontSize: 13, margin: '0 0 14px' }}>ใช้เลือกร้านมื้อกลางวัน/มื้อเย็น · "อาหารเช้า" เพิ่มมื้อเช้าให้วันที่เริ่มก่อน 09:45 · เลือกได้หลายข้อ หรือไม่เลือกก็ได้</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {derived.foodPreferenceOptionsView.map((opt) => (
                  <div key={opt.label} onClick={opt.onClick} role="button" aria-pressed={opt.color !== '#3c463f'} style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 999, padding: '8px 14px 8px 8px', cursor: 'pointer', transition: 'all 0.2s ease', border: `2px solid ${opt.borderColor}`, background: opt.bg }}>
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: opt.iconBg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, flexShrink: 0 }}>{opt.letter}</div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: opt.color }}>{opt.label}</span>
                  </div>
                ))}
              </div>

              <h2 style={{ fontSize: 17, fontWeight: 800, color: '#1B5E20', margin: '26px 0 4px' }}>มีสถานที่ที่อยากไปแน่ๆ มั้ย?</h2>
              <p style={{ color: '#626863', fontSize: 13, margin: '0 0 12px' }}>ถ้ามี น้องไดโนจะใส่ให้ในทริปก่อนที่อื่น</p>
              {derived.mustGoChipsView.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {derived.mustGoChipsView.map((chip) => (
                    <span key={chip.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#E8F5E9', color: '#1B5E20', border: '1px solid #C8E6C9', borderRadius: 16, padding: '5px 6px 5px 12px', fontSize: 13, fontWeight: 700 }}>
                      {chip.name}
                      <button type="button" onClick={chip.onRemove} aria-label={`ลบ ${chip.name}`} style={{ background: 'transparent', border: 'none', color: '#2E7D32', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 4px', display: 'inline-flex', alignItems: 'center' }}><X size={14} strokeWidth={2.6} /></button>
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
                        <span style={{ color: '#626863', fontSize: 12 }}>{sug.category}</span>
                      </div>
                    ))}
                  </div>
                )}
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
          <button onClick={actions.prevStep} style={{ background: 'transparent', color: '#5f6a63', border: 'none', padding: '13px 10px', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: derived.prevOpacity }}><ArrowLeft size={15} strokeWidth={2.4} style={{ verticalAlign: '-2px' }} /> ย้อนกลับ</button>
          <button onClick={derived.onPrimaryStep} style={{ flex: 1, background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: 14, borderRadius: 20, fontWeight: 800, fontSize: 15, cursor: 'pointer', boxShadow: '0 10px 22px rgba(46,125,50,0.25)' }}>{derived.primaryLabel}</button>
        </div>
      </div>
    </main>
  )
}
