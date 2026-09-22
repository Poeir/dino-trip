// Shared spinner visual -- lifted from the one already used in
// TripLoadingPage.jsx/PointsPage.jsx's scan-processing state (dc-spin
// keyframe in index.css) so every loading moment in the app looks the same.
export default function LoadingSpinner({ size = 40, label, style }) {
  return (
    <div style={{ textAlign: 'center', padding: label ? '28px 20px' : 0, ...style }}>
      <div style={{
        width: size, height: size, borderRadius: '50%',
        border: `${Math.max(3, Math.round(size / 11))}px solid #C8E6C9`, borderTopColor: '#2E7D32',
        margin: label ? '0 auto 14px' : '0 auto', animation: 'dc-spin 0.8s linear infinite',
      }} />
      {label && <div style={{ color: '#6d7a72', fontSize: 14 }}>{label}</div>}
    </div>
  )
}
