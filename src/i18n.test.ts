import { describe, expect, it } from 'vitest'
import { applyLanguage, DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, localizedErrorMessage, persistLanguage, readStoredLanguage, translate } from './i18n'

describe('application language', () => {
  it('restores only supported languages', () => {
    expect(readStoredLanguage({ getItem: () => 'en' })).toBe('en')
    expect(readStoredLanguage({ getItem: () => 'ja' })).toBe(DEFAULT_LANGUAGE)
    expect(readStoredLanguage({ getItem: () => null })).toBe(DEFAULT_LANGUAGE)
  })

  it('updates document metadata and persists the choice', () => {
    const root = { lang: '', dataset: {} } as unknown as HTMLElement
    const values = new Map<string, string>()
    applyLanguage('en', root)
    persistLanguage('en', { setItem: (key, value) => values.set(key, value) })
    expect(root.lang).toBe('en')
    expect(root.dataset.language).toBe('en')
    expect(values.get(LANGUAGE_STORAGE_KEY)).toBe('en')
    expect(translate('한국어', 'English')).toBe('English')
    expect(localizedErrorMessage(new Error('내부 오류'), '작업 실패', 'Operation failed.')).toBe('Operation failed.')
    expect(localizedErrorMessage(new Error('Codec failed'), '작업 실패', 'Operation failed.')).toBe('Codec failed')
    applyLanguage('ko', root)
  })
})
