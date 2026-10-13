import { cloneElement, isValidElement, useId } from 'react'

export default function Field({ label, children, required, error }) {
  const autoId = useId()
  const child = isValidElement(children) ? children : null
  const id = child?.props?.id || autoId
  const errorId = error ? `${id}-error` : undefined
  const control = child
    ? cloneElement(child, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': errorId })
    : children

  return (
    <div>
      <label htmlFor={id} style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#3c463f', marginBottom: 4 }}>
        {label}{required && <span style={{ color: '#a33232' }}> *</span>}
      </label>
      {control}
      {error && <div id={errorId} style={{ color: '#a33232', fontSize: 11.5, marginTop: 4 }}>{error}</div>}
    </div>
  )
}
