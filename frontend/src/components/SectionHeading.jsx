export default function SectionHeading({ children, first }) {
  return (
    <div style={{
      fontSize: 11.5, fontWeight: 800, color: '#2E7D32', textTransform: 'uppercase', letterSpacing: 0.4,
      margin: first ? '0 0 10px' : '22px 0 10px',
      paddingTop: first ? 0 : 14,
      borderTop: first ? 'none' : '1px solid #F0EEE3',
    }}>
      {children}
    </div>
  )
}
