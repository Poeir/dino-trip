import { Sparkles } from 'lucide-react'
import { useId, useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import { extractEventFromText } from '../../lib/apiClient.js'
import Button from '../ui/Button.jsx'

// "Paste a Facebook post, let the AI fill the form" box. It only fetches; `onExtracted(fields)`
// lets the form decide how to apply the result (it also drives the date pickers).
// Mounted inside the form Modal, so its text and error reset every time the form opens.
export default function EventAiExtract({ onExtracted }) {
  const { actions } = useApp()
  const labelId = useId()
  const [pasteText, setPasteText] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState('')

  const handleExtract = async () => {
    if (!pasteText.trim()) return
    setExtracting(true)
    setError('')
    try {
      onExtracted(await extractEventFromText(pasteText))
    } catch (err) {
      if (!actions.handleSessionExpired(err)) setError(err.status === undefined ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' : err.message)
    } finally {
      setExtracting(false)
    }
  }

  return (
    <div className="ad-ai-box">
      <label htmlFor={labelId} className="ad-ai-box__label">วางข้อความจากโพสต์ Facebook (ไม่บังคับ)</label>
      <textarea
        id={labelId}
        className="ad-textarea"
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
        placeholder="ก็อปข้อความจากโพสต์เพจ Facebook มาวางที่นี่ แล้วกด &quot;ดึงข้อมูลอัตโนมัติ&quot; เพื่อให้ AI ช่วยเติมฟอร์มด้านล่าง"
      />
      <div className="ad-row">
        <Button size="sm" onClick={handleExtract} loading={extracting} disabled={!pasteText.trim()}>
          <Sparkles size={14} aria-hidden="true" />
          {extracting ? 'กำลังดึงข้อมูล...' : 'ดึงข้อมูลอัตโนมัติ'}
        </Button>
        <span className="ad-ai-box__note">ตรวจสอบและแก้ไขข้อมูลด้านล่างก่อนบันทึกเสมอ</span>
      </div>
      {error && <div className="ad-error-text" role="alert">ดึงข้อมูลไม่สำเร็จ: {error}</div>}
    </div>
  )
}
