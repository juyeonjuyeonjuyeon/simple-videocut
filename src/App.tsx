import { useEffect, useRef, useState } from 'react'
import { useEditor } from './store'
import Preview from './components/Preview'
import Timeline from './components/Timeline'
import Inspector from './components/Inspector'
import ExportDialog from './components/ExportDialog'
import ProjectDialog from './components/ProjectDialog'
import ProjectHome from './components/ProjectHome'
import { projectDuration, formatTime, formatTimeFine } from './utils/time'
import { saveProject, loadProject, listProjects, deleteProject, autosaveMeta, AUTOSAVE_KEY } from './utils/project'
import type { ProjectMeta } from './utils/project'
import { AUDIO_ACCEPT, MEDIA_ACCEPT, VISUAL_ACCEPT, isAudioFile, isImageFile, isVideoFile } from './utils/media'
import { filesFromDrop, hasFilePayload } from './utils/drop'
import Icon from './components/Icon'
import { startPointerDrag } from './utils/pointer'
import MediaPanel from './components/MediaPanel'
import HelpDialog from './components/HelpDialog'
import CropDialog from './components/CropDialog'
import ThemePicker from './components/ThemePicker'
import ShapePicker from './components/ShapePicker'
import StickerPicker from './components/StickerPicker'
import ShowcasePreviewDialog from './components/ShowcasePreviewDialog'
import { localizedErrorMessage, useLanguage } from './i18n'

const ACTIVE_PROJECT_KEY = 'simplecut-active-project-name'

function snapshotProject() {
  const s = useEditor.getState()
  return {
    mediaLibrary: s.mediaLibrary,
    clips: s.clips, overlays: s.overlays, audios: s.audios, backgrounds: s.backgrounds, texts: s.texts,
    markers: s.markers, aspectRatio: s.aspectRatio, exportSettings: s.exportSettings,
    groups: s.groups,
    visualOrder: s.visualOrder,
  }
}

export default function App() {
  const { language, t } = useLanguage()
  const mediaLibrary = useEditor((s) => s.mediaLibrary)
  const clips = useEditor((s) => s.clips)
  const overlays = useEditor((s) => s.overlays)
  const audios = useEditor((s) => s.audios)
  const texts = useEditor((s) => s.texts)
  const selection = useEditor((s) => s.selection)
  const selectedItems = useEditor((s) => s.selectedItems)
  const playhead = useEditor((s) => s.playhead)
  const isPlaying = useEditor((s) => s.isPlaying)
  const loop = useEditor((s) => s.loop)
  const importMediaFiles = useEditor((s) => s.importMediaFiles)
  const addFiles = useEditor((s) => s.addFiles)
  const addOverlayFiles = useEditor((s) => s.addOverlayFiles)
  const addShape = useEditor((s) => s.addShape)
  const addSticker = useEditor((s) => s.addSticker)
  const addAudioFiles = useEditor((s) => s.addAudioFiles)
  const addBackground = useEditor((s) => s.addBackground)
  const splitAtPlayhead = useEditor((s) => s.splitAtPlayhead)
  const addText = useEditor((s) => s.addText)
  const addMarker = useEditor((s) => s.addMarker)
  const deleteSelected = useEditor((s) => s.deleteSelected)
  const duplicateSelected = useEditor((s) => s.duplicateSelected)
  const groupSelected = useEditor((s) => s.groupSelected)
  const ungroupSelected = useEditor((s) => s.ungroupSelected)
  const setPlaying = useEditor((s) => s.setPlaying)
  const setPlayhead = useEditor((s) => s.setPlayhead)
  const setLoop = useEditor((s) => s.setLoop)
  const canUndo = useEditor((s) => s.canUndo)
  const canRedo = useEditor((s) => s.canRedo)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)

  const replaceProject = useEditor((s) => s.replaceProject)
  const resetProject = useEditor((s) => s.resetProject)
  const fileRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [showExport, setShowExport] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showCropEditor, setShowCropEditor] = useState(false)
  const [showShapes, setShowShapes] = useState(false)
  const [showStickers, setShowStickers] = useState(false)
  const [showShowcasePreview, setShowShowcasePreview] = useState(false)
  const [showProjectHome, setShowProjectHome] = useState(false)
  const [projectDialogMode, setProjectDialogMode] = useState<'manage' | 'saveAs' | null>(null)
  const [lastProjectName, setLastProjectName] = useState<string | null>(() => {
    try { return localStorage.getItem(ACTIVE_PROJECT_KEY) }
    catch { return null }
  })
  const [activeProjectName, setActiveProjectNameState] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [dropImporting, setDropImporting] = useState(false)
  const [restorable, setRestorable] = useState<ProjectMeta | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [manualSaveStatus, setManualSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth > 860)
  const [mediaPanelOpen, setMediaPanelOpen] = useState(() => window.innerWidth > 1000)
  // Resizable panels (desktop).
  const [inspectorW, setInspectorW] = useState(320)
  const [timelineH, setTimelineH] = useState<number | null>(null)

  const toggleMediaPanel = () => setMediaPanelOpen((open) => {
    const next = !open
    if (next && window.innerWidth <= 860) setInspectorOpen(false)
    return next
  })
  const toggleInspector = () => setInspectorOpen((open) => {
    const next = !open
    if (next && window.innerWidth <= 860) setMediaPanelOpen(false)
    return next
  })

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
    ['--media-panel-w' as string]: mediaPanelOpen ? '300px' : '0px',
    ...(timelineH != null ? { ['--tl-h' as string]: `${timelineH}px` } : {}),
  } as React.CSSProperties

  const setActiveProjectName = (name: string | null) => {
    setActiveProjectNameState(name)
    try {
      if (name) {
        setLastProjectName(name)
        localStorage.setItem(ACTIVE_PROJECT_KEY, name)
      }
    } catch { /* storage can be unavailable in private browsing */ }
  }

  const saveCurrentProject = async () => {
    if (!activeProjectName) {
      setShowProjectHome(false)
      setProjectDialogMode('saveAs')
      return
    }
    setManualSaveStatus('saving')
    try {
      await saveProject(activeProjectName, snapshotProject())
      setLastSavedAt(Date.now())
      setManualSaveStatus('saved')
      window.setTimeout(() => setManualSaveStatus('idle'), 1800)
    } catch (error) {
      setManualSaveStatus('error')
      alert(t('프로젝트 저장 실패: ', 'Project save failed: ') + localizedErrorMessage(error, '알 수 없는 오류', 'Unknown error'))
    }
  }

  // Start on the project home only when there is something useful to resume.
  // An empty first launch still opens straight into the editor.
  useEffect(() => {
    Promise.all([autosaveMeta(), listProjects()])
      .then(([autosave, projects]) => {
        setRestorable(autosave)
        if (autosave || projects.length) setShowProjectHome(true)
      })
      .catch(() => {})
  }, [])

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
        ml: strip(s.mediaLibrary),
        c: strip(s.clips), o: strip(s.overlays), a: strip(s.audios), b: strip(s.backgrounds),
        t: s.texts, m: s.markers, g: s.groups, vo: s.visualOrder, ar: s.aspectRatio, es: s.exportSettings,
      })
    }
    const saveNow = async () => {
      const s = useEditor.getState()
      if (!(s.mediaLibrary.length || s.clips.length || s.overlays.length || s.audios.length || s.backgrounds.length || s.texts.length)) return
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
          mediaLibrary: s.mediaLibrary,
          clips: s.clips, overlays: s.overlays, audios: s.audios, backgrounds: s.backgrounds, texts: s.texts,
          markers: s.markers,
          groups: s.groups,
          visualOrder: s.visualOrder,
          aspectRatio: s.aspectRatio, exportSettings: s.exportSettings,
        })
        lastSig.current = sig
        setLastSavedAt(Date.now())
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
      setActiveProjectName(null)
      setRestorable(null)
      setShowProjectHome(false)
      setSaveStatus('saved')
    } catch (error) {
      setSaveStatus('error')
      alert(t('복원 실패: ', 'Restore failed: ') + localizedErrorMessage(error, '알 수 없는 오류', 'Unknown error'))
    }
  }

  const backgrounds = useEditor((s) => s.backgrounds)
  const total = projectDuration(clips, overlays, audios, texts, backgrounds)
  const hasClips = clips.length > 0
  const hasContent = mediaLibrary.length > 0 || hasClips || overlays.length > 0 || audios.length > 0 || backgrounds.length > 0 || texts.length > 0

  const openProject = async (name: string) => {
    const project = await loadProject(name)
    if (!project) throw new Error(t(`'${name}' 프로젝트를 찾을 수 없습니다.`, `Project '${name}' was not found.`))
    replaceProject(project)
    setActiveProjectName(name)
    setRestorable(null)
    setShowProjectHome(false)
    setSaveStatus('saved')
    setLastSavedAt(Date.now())
  }

  const startNewProject = () => {
    if (hasContent && !confirm(t('새 프로젝트를 시작할까요? 현재 작업은 자동 저장 복구본으로 남아 있습니다.', 'Start a new project? Your current work will remain in the autosave recovery copy.'))) return
    const discardRecovery = !hasContent && !!restorable
    resetProject()
    setActiveProjectName(null)
    setRestorable(null)
    setSaveStatus('idle')
    setLastSavedAt(null)
    setShowProjectHome(false)
    if (discardRecovery) void deleteProject(AUTOSAVE_KEY).catch(() => {})
  }

  // Keyboard shortcuts (ignored while typing in inputs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
      const modalOpen = showExport || showHelp || showCropEditor || showShapes || showShowcasePreview || showProjectHome || projectDialogMode !== null
      if (e.key === 'Escape' && modalOpen) {
        e.preventDefault()
        if (showShowcasePreview) { setPlaying(false); setShowShowcasePreview(false) }
        else if (showCropEditor) setShowCropEditor(false)
        else if (showShapes) setShowShapes(false)
        else if (showHelp) setShowHelp(false)
        else if (showExport) setShowExport(false)
        else if (projectDialogMode) setProjectDialogMode(null)
        else setShowProjectHome(false)
        return
      }
      if (modalOpen) return
      if (!isTyping && e.key === '?') {
        e.preventDefault()
        setShowHelp(true)
        return
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        if (e.shiftKey) setProjectDialogMode('saveAs')
        else void saveCurrentProject()
        return
      }
      if (isTyping) return
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) redo(); else undo()
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        duplicateSelected()
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault()
        if (e.shiftKey) ungroupSelected()
        else if (selectedItems.length > 1) groupSelected()
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
  const hasFiles = (e: React.DragEvent) => hasFilePayload(e.dataTransfer)
  const onDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    dragDepth.current++
    setDragging(true)
  }
  const onDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
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
  const onDrop = async (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    setDropImporting(true)
    try {
      const files = await filesFromDrop(e.dataTransfer)
      if (!files.length) {
        alert(t('파일을 읽지 못했습니다. 사진이나 녹음을 파일 앱에 저장한 뒤 다시 끌어 놓아 주세요.', 'The files could not be read. Save the photo or recording in Files, then drag it here again.'))
        return
      }
      const supported = files.filter((file) => isVideoFile(file) || isImageFile(file) || isAudioFile(file))
      const unsupported = files.filter((file) => !supported.includes(file))
      if (supported.length) await addCategorizedFiles(supported)
      if (unsupported.length) {
        alert(t(`지원하지 않는 파일 ${unsupported.length}개는 추가하지 않았습니다:\n${unsupported.map((file) => file.name).join('\n')}`, `${unsupported.length} unsupported file(s) were not added:\n${unsupported.map((file) => file.name).join('\n')}`))
      }
    } finally {
      setDropImporting(false)
    }
  }

  return (
    <div className="app" style={appStyle} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo"><Icon name="brand" /></span>
          <span className="topbar__name">SimpleCut</span>
          <span className="topbar__project" title={activeProjectName || t('저장되지 않은 프로젝트', 'Unsaved project')}>{activeProjectName || t('저장되지 않음', 'Unsaved')}</span>
        </div>
        <div className="topbar__actions">
          <span className={`save-status save-status--${saveStatus}`} role="status">
            {manualSaveStatus === 'saving' ? t('프로젝트 저장 중…', 'Saving project…') : manualSaveStatus === 'saved' ? t('프로젝트 저장됨', 'Project saved') : manualSaveStatus === 'error' ? t('저장 실패', 'Save failed') : saveStatus === 'saving' ? t('자동 저장 중…', 'Autosaving…') : saveStatus === 'saved' && lastSavedAt ? `${t('자동 저장됨', 'Autosaved')} · ${new Date(lastSavedAt).toLocaleTimeString(language === 'ko' ? 'ko-KR' : 'en-US', { hour: '2-digit', minute: '2-digit' })}` : saveStatus === 'error' ? t('자동 저장 실패', 'Autosave failed') : ''}
          </span>
          <button className={`iconbtn iconbtn--sm${mediaPanelOpen ? ' iconbtn--on' : ''}`} onClick={toggleMediaPanel} aria-label={t('왼쪽 미디어 패널 열기·닫기', 'Toggle left media panel')}><Icon name="library" /></button>
          <button className="btn btn--sm topbar__project-menu" onClick={() => setShowProjectHome(true)} title={t('프로젝트 홈·저장·열기', 'Project home, save, and open')} aria-label={t('프로젝트 홈 열기', 'Open project home')}><Icon name="project" /><span>{t('프로젝트', 'Project')}</span></button>
          <button className={`iconbtn iconbtn--sm${inspectorOpen ? ' iconbtn--on' : ''}`} onClick={toggleInspector} aria-label={t('오른쪽 편집 패널 열기·닫기', 'Toggle right inspector')}><Icon name="panel" /></button>
          <ThemePicker />
          <button className="iconbtn iconbtn--sm topbar__help" onClick={() => setShowHelp(true)} aria-label={t('도움말 열기', 'Open help')}><Icon name="help" /></button>
          <button className="btn btn--sm topbar__showcase" onClick={() => { setPlaying(false); setShowShowcasePreview(true) }} disabled={total <= 0}
            title={t('편집 손잡이 없이 완제품과 플랫폼 화면 확인', 'Review the final result and platform layouts without editing handles')}>
            <Icon name="screen" />{t('미리보기', 'Preview')}
          </button>
          <button className="btn btn--primary" onClick={() => setShowExport(true)} disabled={!hasClips}>
            {t('내보내기', 'Export')}
          </button>
        </div>
        <input ref={fileRef} type="file" accept={MEDIA_ACCEPT} multiple hidden
          onChange={(e) => { if (e.target.files) void addCategorizedFiles(Array.from(e.target.files)); e.target.value = '' }} />
        <input ref={overlayRef} type="file" accept={VISUAL_ACCEPT} multiple hidden
          onChange={(e) => { if (e.target.files) addOverlayFiles(e.target.files); e.target.value = '' }} />
        <input ref={audioRef} type="file" accept={AUDIO_ACCEPT} multiple hidden
          onChange={(e) => { if (e.target.files) addAudioFiles(e.target.files); e.target.value = '' }} />
        <input ref={libraryRef} type="file" accept={MEDIA_ACCEPT} multiple hidden
          onChange={(e) => { if (e.target.files) void importMediaFiles(e.target.files); e.target.value = '' }} />
      </header>

      <main className={`stage${inspectorOpen ? '' : ' stage--inspector-hidden'}${mediaPanelOpen ? '' : ' stage--media-hidden'}`}>
        {mediaPanelOpen && <MediaPanel
          onClose={() => setMediaPanelOpen(false)}
          onImport={() => libraryRef.current?.click()}
        />}
        <section className="stage__preview">
          {!showShowcasePreview
            ? <Preview onOpenCrop={() => { setPlaying(false); setShowCropEditor(true) }} />
            : <div className="preview preview--suspended" aria-hidden="true" />}
          <div className="transport">
            <button
              className="iconbtn iconbtn--play"
              onClick={() => setPlaying(!isPlaying)}
              disabled={!hasContent}
              aria-label={isPlaying ? t('일시정지', 'Pause') : t('재생', 'Play')}
            >
              <Icon name={isPlaying ? 'pause' : 'play'} />
            </button>
            <button
              className={`iconbtn${loop ? ' iconbtn--on' : ''}`}
              onClick={() => setLoop(!loop)}
              aria-label={t('반복 재생', 'Loop playback')}
            >
              <Icon name="repeat" />
            </button>
            <div className="transport__time">
              {formatTimeFine(playhead)} <span>/ {formatTime(total)}</span>
            </div>
            <div className="transport__spacer" />
            <button className="btn btn--sm" onClick={splitAtPlayhead} disabled={!hasClips} title={t('단축키: S', 'Shortcut: S')}><Icon name="split" />{t('분할', 'Split')}</button>
            <button className="btn btn--sm" onClick={addBackground}><Icon name="palette" />{t('배경', 'Background')}</button>
            <button className="btn btn--sm" onClick={addText}><Icon name="text" />{t('텍스트', 'Text')}</button>
            <button className="btn btn--sm" onClick={() => setShowStickers(true)}><Icon name="heart" />{t('스티커', 'Sticker')}</button>
            <button className="btn btn--sm" onClick={() => setShowShapes(true)}><Icon name="shape" />{t('도형', 'Shape')}</button>
            <button className="iconbtn" onClick={undo} disabled={!canUndo} aria-label={t('실행 취소', 'Undo')}><Icon name="undo" /></button>
            <button className="iconbtn" onClick={redo} disabled={!canRedo} aria-label={t('다시 실행', 'Redo')}><Icon name="redo" /></button>
            <button className="btn btn--sm" onClick={duplicateSelected} disabled={!selection} title={t('단축키: ⌘D', 'Shortcut: ⌘D')}><Icon name="copy" />{t('복제', 'Duplicate')}</button>
            <button className="btn btn--sm btn--danger" onClick={deleteSelected} disabled={!selection} title={t('단축키: Delete', 'Shortcut: Delete')}><Icon name="trash" />{t('삭제', 'Delete')}</button>
          </div>
        </section>
        {inspectorOpen && <Inspector onOpenCrop={() => { setPlaying(false); setShowCropEditor(true) }} />}
        {inspectorOpen && <div className="resizer resizer--v" onPointerDown={startResize('w')} title={t('패널 너비 조절', 'Resize panel')} />}
      </main>

      <div className="resizer resizer--h" onPointerDown={startResize('h')} title={t('타임라인 높이 조절', 'Resize timeline')} />
      <Timeline />

      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
      {showShowcasePreview && <ShowcasePreviewDialog projectName={activeProjectName} onClose={() => setShowShowcasePreview(false)} />}
      {showCropEditor && <CropDialog onClose={() => setShowCropEditor(false)} />}
      {showShapes && <ShapePicker onClose={() => setShowShapes(false)} onSelect={(kind) => {
        addShape(kind)
        setShowShapes(false)
        setInspectorOpen(true)
        if (window.innerWidth <= 860) setMediaPanelOpen(false)
      }} />}
      {showStickers && <StickerPicker onClose={() => setShowStickers(false)} onSelect={(kind) => {
        addSticker(kind)
        setShowStickers(false)
        setInspectorOpen(true)
        if (window.innerWidth <= 860) setMediaPanelOpen(false)
      }} />}
      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
      {showProjectHome && <ProjectHome
        activeName={activeProjectName}
        lastProjectName={lastProjectName}
        autosave={restorable}
        hasContent={hasContent}
        saveStatus={saveStatus}
        onClose={() => setShowProjectHome(false)}
        onNew={startNewProject}
        onOpen={openProject}
        onRestore={restore}
        onSave={saveCurrentProject}
        onSaveAs={() => { setShowProjectHome(false); setProjectDialogMode('saveAs') }}
        onManageFiles={() => { setShowProjectHome(false); setProjectDialogMode('manage') }}
      />}
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

      {restorable && !hasContent && !showProjectHome && (
        <div className="restore-banner">
          <span>{t('이전에 작업하던 프로젝트가 있어요. 복원할까요?', 'A previous autosave is available. Restore it?')}</span>
          <button className="btn btn--sm btn--primary" onClick={restore}>{t('복원', 'Restore')}</button>
          <button className="btn btn--sm" onClick={() => setRestorable(null)}>{t('새로 시작', 'Start new')}</button>
        </div>
      )}

      {(dragging || dropImporting) && (
        <div className="dropzone" role="status" aria-live="polite">
          <div className="dropzone__inner">
            <Icon name="download" />
            <p>{dropImporting ? t('파일을 가져오는 중…', 'Importing files…') : t('사진·영상·음성을 놓으세요', 'Drop photos, videos, or audio')}</p>
            <small>{dropImporting ? t('파일을 안전하게 읽고 있습니다', 'Reading files safely') : t('사진 앱·음성 메모·파일 앱·Finder에서 바로 추가할 수 있습니다', 'Add directly from Photos, Voice Memos, Files, or Finder')}</small>
          </div>
        </div>
      )}
    </div>
  )
}
