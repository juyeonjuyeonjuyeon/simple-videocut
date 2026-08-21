import { useEffect, useRef, useState } from 'react'
import { APP_THEMES, applyTheme, persistTheme, readStoredTheme, type AppTheme } from '../utils/theme'
import { useLanguage } from '../i18n'
import Icon from './Icon'

export default function ThemePicker() {
  const { language, setLanguage, t } = useLanguage()
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

  const themeCopy: Record<AppTheme, { label: string; description: string }> = {
    strawberry: { label: t('딸기우유', 'Strawberry Milk'), description: t('부드러운 분홍 편집 화면', 'Soft pink editing workspace') },
    light: { label: t('라이트', 'Light'), description: t('밝고 중립적인 편집 화면', 'Bright neutral editing workspace') },
    dark: { label: t('다크', 'Dark'), description: t('영상에 집중하는 어두운 화면', 'Dark workspace focused on video') },
  }
  const current = themeCopy[theme]

  return (
    <div className="theme-picker" ref={rootRef}>
      <button
        type="button"
        className={`iconbtn iconbtn--sm${open ? ' iconbtn--on' : ''}`}
        aria-label={`${t('설정', 'Settings')}: ${current.label}, ${language === 'ko' ? '한국어' : 'English'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${t('설정', 'Settings')} · ${current.label} · ${language === 'ko' ? '한국어' : 'English'}`}
        onClick={() => setOpen((visible) => !visible)}
      >
        <Icon name="settings" />
      </button>
      {open && (
        <div className="theme-picker__menu" role="menu" aria-label={t('앱 설정', 'App settings')}>
          <div className="theme-picker__title">{t('언어', 'Language')}</div>
          <div className="settings-language" role="group" aria-label={t('화면 언어', 'Display language')}>
            <button type="button" className={language === 'ko' ? 'is-active' : ''} aria-pressed={language === 'ko'} onClick={() => setLanguage('ko')}>
              <b>한국어</b><small>한국어 인터페이스</small>
            </button>
            <button type="button" className={language === 'en' ? 'is-active' : ''} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>
              <b>English</b><small>English interface</small>
            </button>
          </div>
          <div className="theme-picker__title theme-picker__title--section">{t('색상 테마', 'Color theme')}</div>
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
                <span><b>{themeCopy[option.value].label}</b><small>{themeCopy[option.value].description}</small></span>
                <span className="theme-picker__check" aria-hidden="true"><i /></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
