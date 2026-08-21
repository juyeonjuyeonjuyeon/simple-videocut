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
import { AUDIO_ACCEPT, isAudioFile, isImageFile, isVideoFile } from './utils/media'
import Icon from './components/Icon'
import { startPointerDrag } from './utils/pointer'
import MediaPanel from './components/MediaPanel'

const ACTIVE_PROJECT_KEY = 'simplecut-active-project-name'

function snapshotProject() {
  const s = useEditor.getState()
  return {
    clips: s.clips, overlays: s.overlays, audios: s.audios, backgrounds: s.backgrounds, texts: s.texts,
    markers: s.markers, aspectRatio: s.aspectRatio, exportSettings: s.exportSettings,
    groups: s.groups,
  }
}

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
  const addMarker = useEditor((s) => s.addMarker)
  const deleteSelected = useEditor((s) => s.deleteSelected)
  const duplicateSelected = useEditor((s) => s.duplicateSelected)
  const setPlaying = useEditor((s) => s.setPlaying)
  const setPlayhead = useEditor((s) => s.setPlayhead)
  const setLoop = useEditor((s) => s.setLoop)
  const canUndo = useEditor((s) => s.canUndo)
  const canRedo = useEditor((s) => s.canRedo)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)

  const replaceProject = useEditor((s) => s.replaceProject)
  const fileRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [showExport, setShowExport] = useState(false)
  const [projectDialogMode, setProjectDialogMode] = useState<'manage' | 'saveAs' | null>(null)
  const [activeProjectName, setActiveProjectNameState] = useState<string | null>(() => {
    try { return localStorage.getItem(ACTIVE_PROJECT_KEY) }
    catch { return null }
  })
  const [dragging, setDragging] = useState(false)
  const [restorable, setRestorable] = useState<ProjectMeta | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [manualSaveStatus, setManualSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [mediaPanelOpen, setMediaPanelOpen] = useState(() => window.innerWidth > 1000)
  // Resizable panels (desktop).
  const [inspectorW, setInspectorW] = useState(320)
  const [timelineH, setTimelineH] = useState<number | null>(null)

  const startResize = (axis: 'w' | 'h') => (e: React.PointerEvent) => {
    e.preventDefault()
    document.body.style.cursor = axis === 'w' ? 'ew-resize' : 'ns-resize'
    startPointerDrag((ev) => {
      if (axis === 'w') setInspectorW(Math.max(240, Math.min(window.innerWidth - ev.clientX, 640)))
      else setTimelineH(Math.max(140, Math.min(window.innerHeight - ev.clientY, window.innerHeight * 0.72)))
    }, () => {
      document.body.style.cursor = ''
    })
  }
  const appStyle = {
    ['--inspector-w' as string]: inspectorOpen ? `${inspectorW}px` : '0px',
    ['--media-panel-w' as string]: mediaPanelOpen ? '260px' : '0px',
    ...(timelineH != null ? { ['--tl-h' as string]: `${timelineH}px` } : {}),
  } as React.CSSProperties

  const setActiveProjectName = (name: string | null) => {
    setActiveProjectNameState(name)
    try {
      if (name) localStorage.setItem(ACTIVE_PROJECT_KEY, name)
      else localStorage.removeItem(ACTIVE_PROJECT_KEY)
    } catch { /* storage can be unavailable in private browsing */ }
  }

  const saveCurrentProject = async () => {
    if (!activeProjectName) {
      setProjectDialogMode('saveAs')
      return
    }
    setManualSaveStatus('saving')
    try {
      await saveProject(activeProjectName, snapshotProject())
      setManualSaveStatus('saved')
      window.setTimeout(() => setManualSaveStatus('idle'), 1800)
    } catch (error) {
      setManualSaveStatus('error')
      alert('프로젝트 저장 실패: ' + (error as Error).message)
    }
  }

  // Offer to restore the last auto-saved session on startup.
  useEffect(() => { autosaveMeta().then(setRestorable).catch(() => {}) }, [])

  // Save shortly after each real edit. pagehide/visibilitychange are only a
  // final safety net because mobile browsers may freeze a page immediately.
  const lastSig = useRef('')
  useEffect(() => {
    let timer = 0
    let dirty = false
    let inFlight = false
    let queued = false
    const signature = () => {
      const s = useEditor.getState()
      const strip = (arr: { file?: File; src?: string }[]) => arr.map(({ file: _f, src: _s, ...r }) => { void _f; void _s; return r })
      return JSON.stringify({
        c: strip(s.clips), o: strip(s.overlays), a: strip(s.audios), b: strip(s.backgrounds),
        t: s.texts, m: s.markers, g: s.groups, ar: s.aspectRatio, es: s.exportSettings,
      })
    }
    const saveNow = async () => {
      const s = useEditor.getState()
      if (!(s.clips.length || s.overlays.length || s.audios.length || s.backgrounds.length || s.texts.length)) return
      const sig = signature()
      if (sig === lastSig.current) { dirty = false; return }
      if (inFlight) {
        queued = true
        setSaveStatus('saving')
        return
      }
      inFlight = true
      setSaveStatus('saving')
      let succeeded = false
      try {
        await saveProject(AUTOSAVE_KEY, {
          clips: s.clips, overlays: s.overlays, audios: s.audios, backgrounds: s.backgrounds, texts: s.texts,
          markers: s.markers,
          groups: s.groups,
          aspectRatio: s.aspectRatio, exportSettings: s.exportSettings,
        })
        lastSig.current = sig
        dirty = signature() !== sig
        succeeded = true
      } catch (error) {
        console.error('자동 저장 실패', error)
        setSaveStatus('error')
      } finally {
        inFlight = false
        if (queued || dirty) {
          queued = false
          setSaveStatus('saving')
          window.clearTimeout(timer)
          timer = window.setTimeout(() => { void saveNow() }, 250)
        } else if (succeeded) {
          setSaveStatus('saved')
        }
      }
    }
    const schedule = () => {
      if (signature() === lastSig.current) return
      dirty = true
      setSaveStatus('saving')
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { void saveNow() }, 800)
    }
    const unsubscribe = useEditor.subscribe(schedule)
    const onVisibility = () => { if (document.visibilityState === 'hidden') void saveNow() }
    const onPageHide = () => { void saveNow() }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      // A desktop window must close immediately like a normal macOS window.
      // The frequent native autosave remains the recovery path there; browser
      // tabs still receive the accidental-navigation warning while dirty.
      if (window.simplecutDesktop) return
      if (!dirty && !inFlight) return
      event.preventDefault()
      event.returnValue = ''
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

  const restore = async () => {
    setSaveStatus('saving')
    try {
      const p = await loadProject(AUTOSAVE_KEY)
      if (p) replaceProject(p)
      setRestorable(null)
      setSaveStatus('saved')
    } catch (error) {
      setSaveStatus('error')
      alert('복원 실패: ' + (error as Error).message)
    }
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
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) redo(); else undo()
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        duplicateSelected()
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        if (e.shiftKey) setProjectDialogMode('saveAs')
        else void saveCurrentProject()
      } else if (e.code === 'Space') {
        e.preventDefault()
        if (hasContent) setPlaying(!isPlaying)
      } else if (e.key === 's' || e.key === 'S') {
        splitAtPlayhead()
      } else if (e.key === 'm' || e.key === 'M') {
        addMarker(playhead)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        const step = e.altKey ? 1 / 30 : e.shiftKey ? 1 : 0.1
        setPlayhead(Math.max(0, playhead - step))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        const step = e.altKey ? 1 / 30 : e.shiftKey ? 1 : 0.1
        setPlayhead(Math.min(total, playhead + step))
      } else if (e.key === 'Home') {
        e.preventDefault()
        setPlayhead(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        setPlayhead(total)
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
  const addCategorizedFiles = async (files: File[]) => {
    const main = files.filter((file) => isVideoFile(file) || isImageFile(file))
    const audio = files.filter(isAudioFile)
    if (main.length) await addFiles(main)
    if (audio.length) await addAudioFiles(audio)
  }
  const onDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    void addCategorizedFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <div className="app" style={appStyle} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo"><Icon name="brand" /></span>
          <span className="topbar__name">SimpleCut</span>
          <span className="topbar__project" title={activeProjectName || '저장되지 않은 프로젝트'}>{activeProjectName || '저장되지 않음'}</span>
        </div>
        <div className="topbar__actions">
          <span className={`save-status save-status--${saveStatus}`} role="status">
            {manualSaveStatus === 'saving' ? '프로젝트 저장 중…' : manualSaveStatus === 'saved' ? '프로젝트 저장됨' : manualSaveStatus === 'error' ? '저장 실패' : saveStatus === 'saving' ? '자동 저장 중…' : saveStatus === 'saved' ? '자동 저장됨' : saveStatus === 'error' ? '자동 저장 실패' : ''}
          </span>
          <button className="btn topbar__add" onClick={() => fileRef.current?.click()} aria-label="파일 추가"><Icon name="plus" /><span className="topbar__add-label"> 파일 추가</span></button>
          <button className={`iconbtn iconbtn--sm${mediaPanelOpen ? ' iconbtn--on' : ''}`} onClick={() => setMediaPanelOpen((open) => !open)} title="왼쪽 미디어 패널 열기·닫기" aria-label="왼쪽 미디어 패널 열기·닫기"><Icon name="library" /></button>
          <button className="iconbtn iconbtn--sm" onClick={() => void saveCurrentProject()} title={activeProjectName ? `${activeProjectName} 저장 (⌘S)` : '프로젝트 저장'} aria-label="프로젝트 저장"><Icon name="save" /></button>
          <button className="iconbtn iconbtn--sm" onClick={() => setProjectDialogMode('manage')} title="프로젝트 열기·관리" aria-label="프로젝트 열기·관리"><Icon name="folder" /></button>
          <button className={`iconbtn iconbtn--sm${inspectorOpen ? ' iconbtn--on' : ''}`} onClick={() => setInspectorOpen((open) => !open)} title="오른쪽 편집 패널 열기·닫기" aria-label="오른쪽 편집 패널 열기·닫기"><Icon name="panel" /></button>
          <button className="btn btn--primary" onClick={() => setShowExport(true)} disabled={!hasClips}>
            내보내기
          </button>
        </div>
        <input ref={fileRef} type="file" accept={`video/*,image/*,${AUDIO_ACCEPT}`} multiple hidden
          onChange={(e) => { if (e.target.files) void addCategorizedFiles(Array.from(e.target.files)); e.target.value = '' }} />
        <input ref={overlayRef} type="file" accept="video/*,image/*" multiple hidden
          onChange={(e) => { if (e.target.files) addOverlayFiles(e.target.files); e.target.value = '' }} />
        <input ref={audioRef} type="file" accept={AUDIO_ACCEPT} multiple hidden
          onChange={(e) => { if (e.target.files) addAudioFiles(e.target.files); e.target.value = '' }} />
      </header>

      <main className={`stage${inspectorOpen ? '' : ' stage--inspector-hidden'}${mediaPanelOpen ? '' : ' stage--media-hidden'}`}>
        {mediaPanelOpen && <MediaPanel
          onClose={() => setMediaPanelOpen(false)}
          onPickFiles={() => fileRef.current?.click()}
          onPickOverlay={() => overlayRef.current?.click()}
          onPickAudio={() => audioRef.current?.click()}
        />}
        <section className="stage__preview">
          <Preview />
          <div className="transport">
            <button
              className="iconbtn iconbtn--play"
              onClick={() => setPlaying(!isPlaying)}
              disabled={!hasContent}
              aria-label={isPlaying ? '일시정지' : '재생'}
            >
              <Icon name={isPlaying ? 'pause' : 'play'} />
            </button>
            <button
              className={`iconbtn${loop ? ' iconbtn--on' : ''}`}
              onClick={() => setLoop(!loop)}
              title="반복 재생"
              aria-label="반복 재생"
            >
              <Icon name="repeat" />
            </button>
            <div className="transport__time">
              {formatTime(playhead)} <span>/ {formatTime(total)}</span>
            </div>
            <div className="transport__spacer" />
            <button className="btn btn--sm" onClick={splitAtPlayhead} disabled={!hasClips} title="단축키: S"><Icon name="split" />분할</button>
            <button className="btn btn--sm" onClick={() => overlayRef.current?.click()}><Icon name="layers" />오버레이</button>
            <button className="btn btn--sm" onClick={() => audioRef.current?.click()}><Icon name="music" />음악</button>
            <button className="btn btn--sm" onClick={addBackground}><Icon name="palette" />배경</button>
            <button className="btn btn--sm" onClick={addText}><Icon name="text" />텍스트</button>
            <button className="iconbtn" onClick={undo} disabled={!canUndo} title="실행 취소" aria-label="실행 취소"><Icon name="undo" /></button>
            <button className="iconbtn" onClick={redo} disabled={!canRedo} title="다시 실행" aria-label="다시 실행"><Icon name="redo" /></button>
            <button className="btn btn--sm" onClick={duplicateSelected} disabled={!selection} title="단축키: ⌘D"><Icon name="copy" />복제</button>
            <button className="btn btn--sm btn--danger" onClick={deleteSelected} disabled={!selection} title="단축키: Delete"><Icon name="trash" />삭제</button>
          </div>
        </section>
        {inspectorOpen && <Inspector />}
        {inspectorOpen && <div className="resizer resizer--v" onPointerDown={startResize('w')} title="패널 너비 조절" />}
      </main>

      <div className="resizer resizer--h" onPointerDown={startResize('h')} title="타임라인 높이 조절" />
      <Timeline />

      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
      {projectDialogMode && <ProjectDialog
        onClose={() => setProjectDialogMode(null)}
        activeName={activeProjectName}
        initialMode={projectDialogMode}
        onActiveProjectChange={setActiveProjectName}
        onSaved={() => {
          setManualSaveStatus('saved')
          window.setTimeout(() => setManualSaveStatus('idle'), 1800)
        }}
      />}

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
            <Icon name="download" />
            <p>파일을 놓아 추가</p>
            <small>동영상·사진은 메인 트랙, 음악은 오디오 트랙으로 추가됩니다</small>
          </div>
        </div>
      )}
    </div>
  )
}
