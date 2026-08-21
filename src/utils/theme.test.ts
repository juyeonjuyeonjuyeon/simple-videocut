import { describe, expect, it } from 'vitest'
import { applyTheme, DEFAULT_THEME, readStoredTheme, THEME_STORAGE_KEY } from './theme'

describe('app theme', () => {
  it('accepts only the three supported saved themes', () => {
    expect(readStoredTheme({ getItem: () => 'strawberry' })).toBe('strawberry')
    expect(readStoredTheme({ getItem: () => 'light' })).toBe('light')
    expect(readStoredTheme({ getItem: () => 'dark' })).toBe('dark')
    expect(readStoredTheme({ getItem: () => 'unknown' })).toBe(DEFAULT_THEME)
    expect(readStoredTheme({ getItem: (key) => key === THEME_STORAGE_KEY ? null : 'light' })).toBe(DEFAULT_THEME)
  })

  it('applies the theme and matching native color scheme', () => {
    const root = { dataset: {}, style: {}, ownerDocument: undefined } as unknown as HTMLElement
    applyTheme('strawberry', root)
    expect(root.dataset.theme).toBe('strawberry')
    expect(root.style.colorScheme).toBe('light')
    applyTheme('dark', root)
    expect(root.style.colorScheme).toBe('dark')
  })
})
