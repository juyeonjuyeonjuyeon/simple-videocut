(() => {
  const supported = ['strawberry', 'light', 'dark']
  let theme = 'dark'
  try {
    const saved = globalThis.localStorage.getItem('simplecut-color-theme')
    if (supported.includes(saved)) theme = saved
  } catch { /* storage may be unavailable */ }
  globalThis.document.documentElement.dataset.theme = theme
  globalThis.document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
})()
