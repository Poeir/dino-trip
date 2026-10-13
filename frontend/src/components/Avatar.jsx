import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

// A user's profile picture the way they set it up at signup: an uploaded photo
// (with the crop position/zoom they chose), one of the built-in emoji
// personas, or -- with neither -- the first letter of their name.
export default function Avatar({ user, size = 40 }) {
  const { derived } = useApp()
  const [failedUrl, setFailedUrl] = useState(null)
  const url = user?.avatarUrl || ''
  const initial = (user?.displayName || user?.email || '?').trim().charAt(0).toUpperCase()

  const circle = { width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }

  if (url.startsWith('preset:')) {
    const preset = derived.personaAvatarOptions.find((o) => `preset:${o.key}` === url)
    if (preset) return <span style={{ ...circle, background: preset.bg, fontSize: size * 0.55 }} aria-hidden="true">{preset.emoji}</span>
  } else if (url && failedUrl !== url) {
    const src = url.startsWith('/api/') ? `${API_BASE_URL}${url}` : url
    return (
      <span style={{ ...circle, background: '#fff' }}>
        <img
          src={src} alt="" draggable={false} onError={() => setFailedUrl(url)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: user.avatarPosition || '50% 50%', transform: `scale(${Number(user.avatarScale) || 1})`, transformOrigin: 'center' }}
        />
      </span>
    )
  }
  return (
    <span data-font="culture" style={{ ...circle, background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', fontWeight: 900, fontSize: size * 0.45 }} aria-hidden="true">{initial}</span>
  )
}
