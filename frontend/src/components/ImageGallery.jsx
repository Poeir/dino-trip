import { useState } from 'react'
import ImageSlot from './ImageSlot.jsx'

export default function ImageGallery({ images = [], height = 460, placeholder = '' }) {
  const list = images.length ? images : [null]
  const [active, setActive] = useState(0)
  const current = list[Math.min(active, list.length - 1)]

  return (
    <div>
      <div style={{ borderRadius: 16, overflow: 'hidden' }}>
        <ImageSlot src={current} shape="rect" style={{ width: '100%', height }} placeholder={placeholder} />
      </div>
      {list.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, overflowX: 'auto' }}>
          {list.map((src, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              style={{
                padding: 0,
                border: i === active ? '2px solid #2E7D32' : '2px solid transparent',
                borderRadius: 8,
                overflow: 'hidden',
                cursor: 'pointer',
                flexShrink: 0,
                width: 64,
                height: 64,
                background: 'none',
              }}
            >
              <ImageSlot src={src} shape="rect" style={{ width: 64, height: 64 }} placeholder="" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
