import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useEditor } from './store'
import './styles.css'

// Dev-only: expose the editor store for debugging in the browser console.
if (import.meta.env.DEV) {
  ;(window as unknown as { useEditor: typeof useEditor }).useEditor = useEditor
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Remove the startup splash once the app has mounted.
requestAnimationFrame(() => {
  const splash = document.getElementById('splash')
  if (splash) {
    splash.classList.add('hide')
    setTimeout(() => splash.remove(), 400)
  }
})

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => console.error('오프라인 준비 실패', error))
  })
}
