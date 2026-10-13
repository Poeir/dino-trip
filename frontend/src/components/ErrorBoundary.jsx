import { Component } from 'react'

// Catches render errors below it so one broken component shows a message instead of a blank page.
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" style={{ padding: '24px', textAlign: 'center' }}>
        <p style={{ fontWeight: 600, marginBottom: 8 }}>เกิดข้อผิดพลาดในการแสดงผลหน้านี้</p>
        <p style={{ marginBottom: 16, opacity: 0.7 }}>ลองโหลดหน้าใหม่ หากยังเป็นอยู่โปรดแจ้งผู้พัฒนา</p>
        <button type="button" onClick={() => window.location.reload()}>โหลดหน้าใหม่</button>
      </div>
    )
  }
}
