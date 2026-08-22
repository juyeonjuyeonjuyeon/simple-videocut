import { useEffect, useMemo, useRef, useState } from 'react'
import { FONT_OPTIONS } from '../types'
import { canListLocalFonts, cssFontFamily, firstFontFamily, listLocalFontFamilies } from '../utils/fonts'
import Icon from './Icon'
import { useLanguage } from '../i18n'

interface Props {
  value: string
  onChange: (value: string) => void
}

type LocalStatus = 'idle' | 'loading' | 'loaded' | 'unsupported' | 'error'

const matches = (query: string, ...values: string[]) => values.some((value) => value.toLocaleLowerCase().includes(query))

export default function FontPicker({ value, onChange }: Props) {
  const { language, t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [localFonts, setLocalFonts] = useState<string[]>([])
  const [localStatus, setLocalStatus] = useState<LocalStatus>('idle')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = FONT_OPTIONS.find((font) => font.value === value)
  const selectedFamily = selected?.family ?? firstFontFamily(value)
  const selectedLabel = selected ? (language === 'ko' ? selected.label : selected.labelEn) : selectedFamily
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const freeFonts = useMemo(() => FONT_OPTIONS.filter((font) => !normalizedQuery || matches(normalizedQuery, font.label, font.labelEn, font.family, font.note, font.noteEn)), [normalizedQuery])
  const freeFamilies = useMemo(() => new Set(FONT_OPTIONS.map((font) => font.family.toLocaleLowerCase())), [])
  const visibleLocal = useMemo(() => localFonts.filter((family) =>
    !freeFamilies.has(family.toLocaleLowerCase()) && (!normalizedQuery || matches(normalizedQuery, family))), [freeFamilies, localFonts, normalizedQuery])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('keydown', closeEscape)
    }
  }, [open])

  const loadLocal = async () => {
    if (localStatus !== 'idle') return
    if (!canListLocalFonts()) {
      setLocalStatus('unsupported')
      return
    }
    setLocalStatus('loading')
    try {
      const fonts = await listLocalFontFamilies()
      setLocalFonts(fonts)
      setLocalStatus(fonts.length ? 'loaded' : 'unsupported')
    } catch {
      setLocalStatus('error')
    }
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) {
      void loadLocal()
      window.setTimeout(() => searchRef.current?.focus(), 0)
    }
  }

  const choose = (fontValue: string) => {
    onChange(fontValue)
    void document.fonts.load(`24px ${fontValue}`, '가나다라마바사 ABC 123').catch(() => {})
    setOpen(false)
  }

  return (
    <div className="font-picker" ref={rootRef}>
      <button type="button" className="font-picker__toggle" onClick={toggle} aria-label={t(`글꼴 선택: ${selectedLabel}`, `Choose font: ${selectedLabel}`)} aria-expanded={open} aria-haspopup="listbox">
        <span className="font-picker__sample" style={{ fontFamily: value }}>가나다 ABC</span>
        <span className="font-picker__current"><b>{selectedLabel}</b><small>{selectedFamily}</small></span>
        <Icon name={open ? 'close' : 'search'} />
      </button>

      {open && (
        <div className="font-picker__catalog">
          <label className="font-picker__search">
            <Icon name="search" />
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('글꼴 이름 검색', 'Search fonts')} aria-label={t('글꼴 이름 검색', 'Search fonts')} />
          </label>
          <div className="font-picker__list" role="listbox" aria-label={t('사용 가능한 글꼴', 'Available fonts')}>
            <div className="font-picker__section-title"><b>{t('무료 한글 글꼴', 'Free Korean fonts')}</b><span>{t(`${freeFonts.length}개`, `${freeFonts.length}`)}</span></div>
            {freeFonts.map((font) => (
              <button type="button" role="option" aria-selected={value === font.value} key={font.family}
                className={`font-option${value === font.value ? ' font-option--selected' : ''}`} onClick={() => choose(font.value)}>
                <span className="font-option__preview" style={{ fontFamily: font.value }}>가나다 ABC 123</span>
                <span><b>{language === 'ko' ? font.label : font.labelEn}</b><small>{language === 'ko' ? font.note : font.noteEn} · {font.family}</small></span>
              </button>
            ))}

            <div className="font-picker__section-title font-picker__section-title--local"><b>{t('내 컴퓨터', 'My computer')}</b><span>{localStatus === 'loaded' ? t(`${visibleLocal.length}개`, `${visibleLocal.length}`) : ''}</span></div>
            {localStatus === 'loading' && <div className="font-picker__message"><span className="spinner spinner--sm" />{t('설치된 글꼴을 불러오는 중…', 'Loading installed fonts…')}</div>}
            {localStatus === 'unsupported' && <div className="font-picker__message">{t('이 브라우저에서는 로컬 글꼴 목록을 열 수 없습니다. 위 무료 글꼴은 그대로 사용할 수 있습니다.', 'This browser cannot list local fonts. You can still use the free fonts above.')}</div>}
            {localStatus === 'error' && <div className="font-picker__message">{t('로컬 글꼴 권한이 허용되지 않았습니다.', 'Permission to access local fonts was not granted.')}</div>}
            {localStatus === 'loaded' && visibleLocal.map((family) => {
              const fontValue = cssFontFamily(family)
              return (
                <button type="button" role="option" aria-selected={firstFontFamily(value) === family} key={family}
                  className={`font-option${firstFontFamily(value) === family ? ' font-option--selected' : ''}`} onClick={() => choose(fontValue)}>
                  <span className="font-option__preview" style={{ fontFamily: fontValue }}>가나다 ABC 123</span>
                  <span><b>{family}</b><small>{t('이 컴퓨터에 설치됨', 'Installed on this computer')}</small></span>
                </button>
              )
            })}
            {!freeFonts.length && !visibleLocal.length && localStatus !== 'loading' && <div className="font-picker__message">{t('검색 결과가 없습니다.', 'No search results.')}</div>}
          </div>
          <div className="font-picker__foot">{t('무료 글꼴은 인터넷 연결 시 불러오며, 로컬 글꼴은 설치된 컴퓨터에서 사용됩니다.', 'Free fonts load when online; local fonts are available on the computer where they are installed.')}</div>
        </div>
      )}
    </div>
  )
}
