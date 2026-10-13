import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import { generatePlaceDescription } from '../../lib/apiClient.js'
import Button from '../ui/Button.jsx'

const SOURCE_NOTE = {
  search_assisted: 'สรุปจากรีวิว Google Maps และผลค้นหา Google',
  reviews_only: 'สรุปจากรีวิว Google Maps (ไม่พบผลค้นหาที่ใช้ได้)',
  template_only: 'ไม่พบรีวิวหรือผลค้นหาเพียงพอ จึงได้เพียงประโยคพื้นฐาน — ควรเขียนคำอธิบายเอง',
}

// "Generate description with AI" for the place form. It only fetches a suggestion: nothing touches
// the form until the admin presses "ใช้ข้อความนี้", so an existing description is never overwritten
// silently. `getInput()` returns the form's current values (so unsaved edits are used);
// `onApply(text)` writes the chosen text into the description field.
export default function PlaceAiDescription({ getInput, onApply, canGenerate }) {
  const { actions } = useApp()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [suggestion, setSuggestion] = useState(null)

  const handleGenerate = async () => {
    setLoading(true)
    setError('')
    setSuggestion(null)
    try {
      setSuggestion(await generatePlaceDescription(getInput()))
    } catch (err) {
      if (!actions.handleSessionExpired(err)) setError(err.status === undefined ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' : err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="ad-ai-box">
      <div className="ad-row">
        <Button size="sm" onClick={handleGenerate} loading={loading} disabled={!canGenerate}>
          <Sparkles size={14} aria-hidden="true" />
          {loading ? 'กำลังสร้างคำอธิบาย...' : 'สร้างคำอธิบายด้วย AI'}
        </Button>
        <span className="ad-ai-box__note">
          {canGenerate ? 'ใช้รีวิวและผลค้นหา Google อาจใช้เวลาสักครู่ — ตรวจสอบก่อนบันทึกเสมอ' : 'กรอกชื่อและเลือกหมวดหมู่ก่อน'}
        </span>
      </div>
      {error && <div className="ad-error-text" role="alert">สร้างคำอธิบายไม่สำเร็จ: {error}</div>}
      {suggestion && (
        <>
          <div className="ad-ai-box__label">ข้อความที่แนะนำ</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{suggestion.description}</div>
          <div className="ad-ai-box__note">{SOURCE_NOTE[suggestion.source] || ''}</div>
          <div className="ad-row">
            <Button size="sm" onClick={() => { onApply(suggestion.description); setSuggestion(null) }}>ใช้ข้อความนี้</Button>
            <Button size="sm" variant="ghost" onClick={() => setSuggestion(null)}>ปิด</Button>
          </div>
        </>
      )}
    </div>
  )
}
