import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type AppLanguage = 'ko' | 'en'

export const LANGUAGE_STORAGE_KEY = 'simplecut-language'
export const DEFAULT_LANGUAGE: AppLanguage = 'ko'

export const isAppLanguage = (value: unknown): value is AppLanguage => value === 'ko' || value === 'en'

export function readStoredLanguage(storage?: Pick<Storage, 'getItem'>): AppLanguage {
  try {
    const value = storage?.getItem(LANGUAGE_STORAGE_KEY)
    return isAppLanguage(value) ? value : DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

let activeLanguage: AppLanguage = DEFAULT_LANGUAGE

/** Use outside React for newly-created default names and asynchronous errors. */
export const translate = (ko: string, en: string) => activeLanguage === 'ko' ? ko : en

/** Keep low-level browser/desktop details, but never leak Korean-only errors into English UI. */
export function localizedErrorMessage(error: unknown, koFallback: string, enFallback: string) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (!message) return translate(koFallback, enFallback)
  if (activeLanguage === 'en' && /[가-힣]/.test(message)) return enFallback
  return message
}

export function applyLanguage(language: AppLanguage, root: HTMLElement = document.documentElement) {
  activeLanguage = language
  root.lang = language
  root.dataset.language = language
  if (root.ownerDocument) {
    root.ownerDocument.title = language === 'ko' ? 'SimpleCut — 나만의 영상 편집기' : 'SimpleCut — Personal Video Editor'
  }
}

export function persistLanguage(language: AppLanguage, storage?: Pick<Storage, 'setItem'>) {
  try { storage?.setItem(LANGUAGE_STORAGE_KEY, language) }
  catch { /* storage can be unavailable in private browsing */ }
}

interface LanguageContextValue {
  language: AppLanguage
  setLanguage: (language: AppLanguage) => void
  t: (ko: string, en: string) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(() => {
    const initial = readStoredLanguage(window.localStorage)
    activeLanguage = initial
    return initial
  })
  const setLanguage = useCallback((next: AppLanguage) => {
    activeLanguage = next
    setLanguageState(next)
  }, [])

  useEffect(() => {
    applyLanguage(language)
    persistLanguage(language, window.localStorage)
    window.simplecutDesktop?.setLanguage?.(language)
  }, [language])

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage,
    t: (ko, en) => language === 'ko' ? ko : en,
  }), [language, setLanguage])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('LanguageProvider is missing.')
  return context
}
