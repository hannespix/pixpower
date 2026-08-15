import { useEffect, useState } from 'react'
import type { Mode } from '../lib/palette'

/** Folgt prefers-color-scheme live (Charts muessen bei Wechsel neu einfaerben). */
export function useTheme(): Mode {
  const [mode, setMode] = useState<Mode>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setMode(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mode
}
