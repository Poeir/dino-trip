// Resolves { lat, lng }, or rejects with an Error whose `reason` is one of
// 'unsupported' | 'denied' | 'unavailable' | 'timeout' so callers can tell the
// tourist what to actually do about it.
export function getCurrentPosition({ timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const fail = (reason) => reject(Object.assign(new Error(reason), { reason }))
    if (!('geolocation' in navigator)) return fail('unsupported')
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => fail(err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable'),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    )
  })
}

// Shown when the server says this QR needs a location and we couldn't get one.
export const LOCATION_ERROR_MESSAGE = {
  denied: 'ต้องอนุญาตการเข้าถึงตำแหน่งเพื่อสแกน QR นี้ เปิดได้ที่การตั้งค่าเบราว์เซอร์ (ไอคอนแม่กุญแจข้างช่องที่อยู่เว็บ) แล้วลองสแกนอีกครั้ง',
  timeout: 'หาตำแหน่งของคุณไม่ทันเวลา ลองย้ายไปที่โล่งหรือเปิด GPS แล้วสแกนอีกครั้ง',
  unavailable: 'ไม่สามารถระบุตำแหน่งของคุณได้ กรุณาเปิด GPS แล้วลองอีกครั้ง',
  unsupported: 'เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง หรือเว็บไม่ได้เปิดผ่าน HTTPS จึงสแกน QR นี้ไม่ได้',
}
