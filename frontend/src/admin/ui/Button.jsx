import { Loader2 } from 'lucide-react'

// variant: primary | secondary | ghost | danger | soft;  size: sm | md.
// `loading` disables the button and swaps in a spinner.
export default function Button({ variant = 'primary', size = 'md', loading = false, disabled, type = 'button', className = '', children, ...rest }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`ad-btn ad-btn--${variant} ad-btn--${size}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {loading && <Loader2 size={size === 'sm' ? 13 : 15} className="ad-spin" aria-hidden="true" />}
      {children}
    </button>
  )
}
