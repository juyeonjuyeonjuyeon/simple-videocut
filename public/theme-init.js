(() => {
  const supported = ['strawberry', 'light', 'dark']
  let theme = 'dark'
  try {
    const saved = globalThis.localStorage.getItem('simplecut-color-theme')
    if (supported.includes(saved)) theme = saved
  } catch { /* storage may be unavailable */ }
  globalThis.document.documentElement.dataset.theme = theme
  globalThis.document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
  let language = 'ko'
  try {
    const savedLanguage = globalThis.localStorage.getItem('simplecut-language')
    if (savedLanguage === 'ko' || savedLanguage === 'en') language = savedLanguage
  } catch { /* storage may be unavailable */ }
  globalThis.document.documentElement.lang = language
  globalThis.document.documentElement.dataset.language = language
  globalThis.document.title = language === 'ko' ? 'SimpleCut — 나만의 영상 편집기' : 'SimpleCut — Personal Video Editor'
})()
