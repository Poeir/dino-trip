import Button from './Button.jsx'

// Building blocks for admin form modals.
//
//   <Modal footer={<FormActions .../>}>
//     <FormSection title="ข้อมูลพื้นฐาน" first>
//       <FormGrid>...</FormGrid>
//     </FormSection>
//   </Modal>

export default function FormSection({ title, first = false, children }) {
  return (
    <section className={`ad-fsec${first ? ' ad-fsec--first' : ''}`}>
      {title && <h3 className="ad-fsec__title">{title}</h3>}
      <div className="ad-fsec__body">{children}</div>
    </section>
  )
}

// Responsive 2-up grid of fields.
export function FormGrid({ children }) {
  return <div className="ad-form-grid">{children}</div>
}

// Grouped controls with a visible legend (chip pickers, composers).
export function FormGroup({ legend, children }) {
  return (
    <fieldset className="ad-fieldset">
      <legend className="ad-fieldset__legend">{legend}</legend>
      {children}
    </fieldset>
  )
}

export function FormError({ children }) {
  return children ? <div className="ad-error-text" role="alert">{children}</div> : null
}

// Footer buttons for a form Modal (pass as the `footer` prop). The Modal pins them to the bottom
// of the panel, so no sticky positioning is needed in the form body.
export function FormActions({ onSave, onCancel, saving = false, disabled = false, saveLabel = 'บันทึก', cancelLabel = 'ยกเลิก', error }) {
  return (
    <>
      {error && <div className="ad-form-actions__error" role="alert">{error}</div>}
      <Button variant="secondary" onClick={onCancel} disabled={saving}>{cancelLabel}</Button>
      <Button onClick={onSave} loading={saving} disabled={disabled}>{saving ? 'กำลังบันทึก...' : saveLabel}</Button>
    </>
  )
}
