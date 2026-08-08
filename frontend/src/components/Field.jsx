export default function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#3c463f', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}
