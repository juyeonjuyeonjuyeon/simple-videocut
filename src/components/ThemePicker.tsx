import { useEffect, useRef, useState } from 'react'
import { APP_THEMES, applyTheme, persistTheme, readStoredTheme, type AppTheme } from '../utils/theme'
import Icon from './Icon'

export default function ThemePicker() {
  const [theme, setTheme] = useState<AppTheme>(() => readStoredTheme(window.localStorage))
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    applyTheme(theme)
    persistTheme(theme, window.localStorage)
  }, [theme])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeWithEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('keydown', closeWithEscape)
    }
  }, [open])

  const current = APP_THEMES.find((candidate) => candidate.value === theme) ?? APP_THEMES[2]

  return (
    <div className="theme-picker" ref={rootRef}>
      <button
        type="button"
        className={`iconbtn iconbtn--sm${open ? ' iconbtn--on' : ''}`}
        aria-label={`색상 테마: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`색상 테마 · ${current.label}`}
        onClick={() => setOpen((visible) => !visible)}
      >
        <Icon name="palette" />
      </button>
      {open && (
        <div className="theme-picker__menu" role="menu" aria-label="색상 테마 선택">
          <div className="theme-picker__title">색상 테마</div>
          <div className="theme-picker__options">
            {APP_THEMES.map((option) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={theme === option.value}
                className={theme === option.value ? 'is-active' : ''}
                key={option.value}
                onClick={() => { setTheme(option.value); setOpen(false) }}
              >
                <span className={`theme-picker__swatch theme-picker__swatch--${option.value}`} aria-hidden="true">
                  <i /><i /><i />
                </span>
                <span><b>{option.label}</b><small>{option.description}</small></span>
                <span className="theme-picker__check" aria-hidden="true"><i /></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
