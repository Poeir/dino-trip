import { useState } from 'react'

const shapeRadius = { rect: 0, rounded: null, circle: '50%', pill: 999 }

export default function ImageSlot({ src, shape = 'rounded', radius = 12, style = {}, placeholder = '' }) {
  const [failed, setFailed] = useState(!src)
  const borderRadius = shape === 'rect' ? 0 : shape === 'circle' ? '50%' : shape === 'pill' ? 999 : radius

  const boxStyle = {
    borderRadius,
    overflow: 'hidden',
    background: failed ? 'linear-gradient(135deg,#C8E6C9,#A5D6A7)' : '#eee',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...style,
  }

  if (failed || !src) {
    return (
      <div style={boxStyle}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#2E7D32', textAlign: 'center', padding: 8 }}>
          {placeholder}
        </span>
      </div>
    )
  }

  return (
    <div style={boxStyle}>
      <img
        src={src}
        alt={placeholder}
        onError={() => setFailed(true)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </div>
  )
}
