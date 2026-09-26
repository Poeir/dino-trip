// "Couldn't load this" block with a retry button, used by the admin lists.
export default function LoadError({ message, onRetry }) {
  return (
    <div style={{ textAlign: 'center', padding: '32px 24px', border: '1px dashed #e6b8b8', borderRadius: 16, background: '#fff' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#a33232', marginBottom: 12 }}>{message}</div>
      <button type="button" onClick={onRetry} style={{ background: '#fff', color: '#a33232', border: '1px solid #a33232', padding: '8px 20px', borderRadius: 16, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>ลองใหม่</button>
    </div>
  )
}
