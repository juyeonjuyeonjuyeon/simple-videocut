export type AppTheme = 'strawberry' | 'light' | 'dark'

export const THEME_STORAGE_KEY = 'simplecut-color-theme'
export const DEFAULT_THEME: AppTheme = 'dark'

export const APP_THEMES: { value: AppTheme; label: string; description: string; themeColor: string }[] = [
  { value: 'strawberry', label: '딸기우유', description: '부드러운 분홍 편집 화면', themeColor: '#FFF1F5' },
  { value: 'light', label: '라이트', description: '밝고 중립적인 편집 화면', themeColor: '#F4F6F8' },
  { value: 'dark', label: '다크', description: '영상에 집중하는 어두운 화면', themeColor: '#171A1F' },
]

export const isAppTheme = (value: unknown): value is AppTheme =>
  value === 'strawberry' || value === 'light' || value === 'dark'

export function readStoredTheme(storage?: Pick<Storage, 'getItem'>): AppTheme {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY)
    return isAppTheme(value) ? value : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function applyTheme(theme: AppTheme, root: HTMLElement = document.documentElement) {
  root.dataset.theme = theme
  root.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
  const meta = root.ownerDocument?.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  const definition = APP_THEMES.find((candidate) => candidate.value === theme)
  if (meta && definition) meta.content = definition.themeColor
}

export function persistTheme(theme: AppTheme, storage?: Pick<Storage, 'setItem'>) {
  try { storage?.setItem(THEME_STORAGE_KEY, theme) }
  catch { /* storage can be unavailable in private browsing */ }
}
