import { useEffect, useRef, useState } from 'react'
import { useEditor } from './store'
import Preview from './components/Preview'
import Timeline from './components/Timeline'
import Inspector from './components/Inspector'
import ExportDialog from './components/ExportDialog'
import ProjectDialog from './components/ProjectDialog'
import { projectDuration, formatTime } from './utils/time'
import { saveProject, loadProject, autosaveMeta, AUTOSAVE_KEY } from './utils/project'
import type { ProjectMeta } from './utils/project'

export default function App() {
  const clips = useEditor((s) => s.clips)
  const overlays = useEditor((s) => s.overlays)
  const audios = useEditor((s) => s.audios)
  const texts = useEditor((s) => s.texts)
  const selection = useEditor((s) => s.selection)
  const playhead = useEditor((s) => s.playhead)
  const isPlaying = useEditor((s) => s.isPlaying)
  const loop = useEditor((s) => s.loop)
  const addFiles = useEditor((s) => s.addFiles)
  const addOverlayFiles = useEditor((s) => s.addOverlayFiles)
  const addAudioFiles = useEditor((s) => s.addAudioFiles)
  const addBackground = useEditor((s) => s.addBackground)
  const splitAtPlayhead = useEditor((s) => s.splitAtPlayhead)
  const addText = useEditor((s) => s.addText)
  const deleteSelected = useEditor((s) => s.deleteSelected)
  const duplicateSelected = useEditor((s) => s.duplicateSelected)
  const setPlaying = useEditor((s) => s.setPlaying)
  const setPlayhead = useEditor((s) => s.setPlayhead)
  const setLoop = useEditor((s) => s.setLoop)

  const replaceProject = useEditor((s) => s.replaceProject)
  const fileRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [showExport, setShowExport] = useState(false)
  const [showProject, setShowProject] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [restorable, setRestorable] = useState<ProjectMeta | null>(null)
  // Resizable panels (desktop).
  const [inspectorW, setInspectorW] = useState(320)
  const [timelineH, setTimelineH] = useState<number | null>(null)

  const startResize = (axis: 'w' | 'h') => (e: React.PointerEvent) => {
    e.preventDefault()
    document.body.style.userSelect = 'none'
    document.body.style.cursor = axis === 'w' ? 'ew-resize' : 'ns-resize'
    const move = (ev: PointerEvent) => {
      if (axis === 'w') setInspectorW(Math.max(240, Math.min(window.innerWidth - ev.clientX, 640)))
      else setTimelineH(Math.max(140, Math.min(window.innerHeight - ev.clientY, window.innerHeight * 0.72)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const appStyle = {
    ['--inspector-w' as string]: `${inspectorW}px`,
    ...(timelineH != null ? { ['--tl-h' as string]: `${timelineH}px` } : {}),
  } as React.CSSProperties

  // Offer to restore the last auto-saved session on startup.
  useEffect(() => { autosaveMeta().then(setRestorable).catch(() => {}) }, [])

  // Auto-save the current project to IndexedDB, but only when it actually
  // changed (avoid re-writing media blobs every tick).
  const lastSig = useRef('')
  useEffect(() => {
    const iv = setInterval(() => {
      const s = useEditor.getState()
      if (!(s.clips.length || s.overlays.length || s.audios.length || s.backgrounds.length || s.texts.length)) return
      const strip = (arr: { file?: File; src?: string }[]) => arr.map(({ file: _f, src: _s, ...r }) => { void _f; void _s; return r })
      const sig = JSON.stringify({
        c: strip(s.clips), o: strip(s.overlays), a: strip(s.audios), b: strip(s.backgrounds),
        t: s.texts, ar: s.aspectRatio, es: s.exportSettings,
      })
      if (sig === lastSig.current) return
      lastSig.current = sig
      saveProject(AUTOSAVE_KEY, {
        clips: s.clips, overlays: s.overlays, audios: s.audios, backgrounds: s.backgrounds, texts: s.texts,
        aspectRatio: s.aspectRatio, exportSettings: s.exportSettings,
      }).catch(() => {})
    }, 8000)
    return () => clearInterval(iv)
  }, [])

  const restore = async () => {
    const p = await loadProject(AUTOSAVE_KEY)
    if (p) replaceProject(p)
    setRestorable(null)
  }

  const backgrounds = useEditor((s) => s.backgrounds)
  const total = projectDuration(clips, overlays, audios, texts, backgrounds)
  const hasClips = clips.length > 0
  const hasContent = hasClips || overlays.length > 0 || audios.length > 0 || backgrounds.length > 0

  // Keyboard shortcuts (ignored while typing in inputs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        duplicateSelected()
      } else if (e.code === 'Space') {
        e.preventDefault()
        if (hasContent) setPlaying(!isPlaying)
      } else if (e.key === 's' || e.key === 'S') {
        splitAtPlayhead()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected()
      } else if (e.key === 'ArrowLeft') {
        setPlayhead(Math.max(0, playhead - 0.1))
      } else if (e.key === 'ArrowRight') {
        setPlayhead(Math.min(total, playhead + 0.1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---- drag & drop files anywhere onto the app ----
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')
  const onDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    dragDepth.current++
    setDragging(true)
  }
  const onDragOver = (e: React.DragEvent) => {
    if (hasFiles(e)) e.preventDefault()
  }
  const onDragLeave = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    dragDepth.current--
    if (dragDepth.current <= 0) setDragging(false)
  }
  const onDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    const main = files.filter((f) => f.type.startsWith('video/') || f.type.startsWith('image/'))
    const audio = files.filter((f) => f.type.startsWith('audio/'))
    if (main.length) addFiles(main)
    if (audio.length) addAudioFiles(audio)
  }

  return (
    <div className="app" style={appStyle} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo">🐶</span>
          <span className="topbar__name">간단컷</span>
        </div>
        <div className="topbar__actions">
          <button className="btn" onClick={() => fileRef.current?.click()}>＋ 동영상·사진</button>
          <button className="iconbtn iconbtn--sm" onClick={() => setShowProject(true)} title="프로젝트 저장·불러오기" aria-label="프로젝트">📁</button>
          <button className="btn btn--primary" onClick={() => setShowExport(true)} disabled={!hasClips}>
            내보내기
          </button>
        </div>
        <input ref={fileRef} type="file" accept="video/*,image/*" multiple hidden
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
        <input ref={overlayRef} type="file" accept="video/*,image/*" multiple hidden
          onChange={(e) => { if (e.target.files) addOverlayFiles(e.target.files); e.target.value = '' }} />
        <input ref={audioRef} type="file" accept="audio/*" multiple hidden
          onChange={(e) => { if (e.target.files) addAudioFiles(e.target.files); e.target.value = '' }} />
      </header>

      <main className="stage">
        <section className="stage__preview">
          <Preview />
          <div className="transport">
            <button
              className="iconbtn iconbtn--play"
              onClick={() => setPlaying(!isPlaying)}
              disabled={!hasContent}
              aria-label={isPlaying ? '일시정지' : '재생'}
            >
              {isPlaying ? '❚❚' : '▶'}
            </button>
            <button
              className={`iconbtn${loop ? ' iconbtn--on' : ''}`}
              onClick={() => setLoop(!loop)}
              title="반복 재생"
              aria-label="반복 재생"
            >
              🔁
            </button>
            <div className="transport__time">
              {formatTime(playhead)} <span>/ {formatTime(total)}</span>
            </div>
            <div className="transport__spacer" />
            <button className="btn btn--sm" onClick={splitAtPlayhead} disabled={!hasClips} title="단축키: S">✂ 분할</button>
            <button className="btn btn--sm" onClick={() => overlayRef.current?.click()}>⊞ 오버레이</button>
            <button className="btn btn--sm" onClick={() => audioRef.current?.click()}>♪ 음악</button>
            <button className="btn btn--sm" onClick={addBackground}>🎨 배경</button>
            <button className="btn btn--sm" onClick={addText}>T 텍스트</button>
            <button className="btn btn--sm" onClick={duplicateSelected} disabled={!selection} title="단축키: ⌘D">⧉ 복제</button>
            <button className="btn btn--sm btn--danger" onClick={deleteSelected} disabled={!selection} title="단축키: Delete">삭제</button>
          </div>
        </section>
        <Inspector />
        <div className="resizer resizer--v" onPointerDown={startResize('w')} title="패널 너비 조절" />
      </main>

      <div className="resizer resizer--h" onPointerDown={startResize('h')} title="타임라인 높이 조절" />
      <Timeline />

      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
      {showProject && <ProjectDialog onClose={() => setShowProject(false)} />}

      {restorable && !hasContent && (
        <div className="restore-banner">
          <span>이전에 작업하던 프로젝트가 있어요. 복원할까요?</span>
          <button className="btn btn--sm btn--primary" onClick={restore}>복원</button>
          <button className="btn btn--sm" onClick={() => setRestorable(null)}>새로 시작</button>
        </div>
      )}

      {dragging && (
        <div className="dropzone">
          <div className="dropzone__inner">
            <span>⬇</span>
            <p>파일을 놓아 추가</p>
            <small>동영상·사진은 메인 트랙, 음악은 오디오 트랙으로 추가됩니다</small>
          </div>
        </div>
      )}
    </div>
  )
}
