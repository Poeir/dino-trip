import { useEffect, useRef, useState } from 'react'

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Counts from 0 up to an integer `target` once (the first time a number is available), ease-out.
// Returns the value to display: null while `target` is null, and the final value immediately when
// the user prefers reduced motion. Later changes of `target` snap without animating.
export default function useCountUp(target, duration = 700) {
  const [shown, setShown] = useState(() => (target != null && !reducedMotion() ? 0 : target))
  const playedRef = useRef(false)

  useEffect(() => {
    if (target == null || playedRef.current || reducedMotion()) {
      if (target != null) playedRef.current = true
      setShown(target)
      return undefined
    }
    let raf = 0
    let start = 0
    const tick = (now) => {
      if (!start) start = now
      const p = Math.min((now - start) / duration, 1)
      setShown(Math.round(target * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
      else playedRef.current = true
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return shown
}
