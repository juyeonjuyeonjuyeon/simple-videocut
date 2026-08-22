import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useEditor } from '../store'
import { formatTimeFine, projectDuration } from '../utils/time'
import { useLanguage } from '../i18n'
import Icon from './Icon'
import Preview from './Preview'

type PreviewMode = 'clean' | 'youtube' | 'shorts' | 'tiktok' | 'reels'

const MODE_RATIO: Record<PreviewMode, number | null> = {
  clean: null,
  youtube: 16 / 9,
  shorts: 9 / 16,
  tiktok: 9 / 16,
  reels: 9 / 16,
}

const PROJECT_RATIO = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 } as const

function fitBox(width: number, height: number, ratio: number) {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  let nextWidth = width
  let nextHeight = nextWidth / ratio
  if (nextHeight > height) {
    nextHeight = height
    nextWidth = nextHeight * ratio
  }
  return { width: Math.floor(nextWidth), height: Math.floor(nextHeight) }
}

function SocialRail({ mode, shareLabel }: { mode: Exclude<PreviewMode, 'clean' | 'youtube'>; shareLabel: string }) {
  const shortCounts = mode === 'reels' ? ['2.1만', '412'] : mode === 'tiktok' ? ['12.4K', '328'] : ['1.8만', '245']
  return (
    <div className="platform-ui__rail">
      <span className="platform-ui__avatar"><Icon name="user" /></span>
      <span><Icon name="heart" /><small>{shortCounts[0]}</small></span>
      <span><Icon name="comment" /><small>{shortCounts[1]}</small></span>
      <span><Icon name="share" /><small>{shareLabel}</small></span>
      <span><Icon name="more" /></span>
    </div>
  )
}

function PlatformUi({ mode, title, playhead, duration, isPlaying }: { mode: PreviewMode; title: string; playhead: number; duration: number; isPlaying: boolean }) {
  const { t } = useLanguage()
  if (mode === 'clean') return null
  if (mode === 'youtube') {
    return (
      <div className="platform-ui platform-ui--youtube" aria-hidden="true">
        <div className="platform-ui__youtube-title">{title}</div>
        <div className="platform-ui__youtube-controls">
          <Icon name={isPlaying ? 'pause' : 'play'} />
          <span className="platform-ui__youtube-progress"><i style={{ width: `${duration > 0 ? (playhead / duration) * 100 : 0}%` }} /></span>
          <span>{formatTimeFine(playhead)} / {formatTimeFine(duration)}</span>
          <Icon name="settings" />
          <Icon name="screen" />
        </div>
      </div>
    )
  }
  return (
    <div className={`platform-ui platform-ui--${mode}`} aria-hidden="true">
      <div className="platform-ui__top">
        {mode === 'tiktok' ? <><span>{t('팔로잉', 'Following')}</span><b>{t('추천', 'For You')}</b></> : mode === 'shorts' ? <b>Shorts</b> : <b>Reels</b>}
        <Icon name={mode === 'shorts' ? 'search' : mode === 'reels' ? 'video' : 'search'} />
      </div>
      <SocialRail mode={mode} shareLabel={t('공유', 'Share')} />
      <div className="platform-ui__caption">
        <b>{t('@내_계정', '@my_account')}</b>
        <span>{title}</span>
        <small><Icon name="music" /> {t('원본 오디오', 'Original audio')}</small>
      </div>
      <div className="platform-ui__home" />
    </div>
  )
}

export default function ShowcasePreviewDialog({ projectName, onClose }: { projectName?: string | null; onClose: () => void }) {
  const { t } = useLanguage()
  const aspectRatio = useEditor((state) => state.aspectRatio)
  const clips = useEditor((state) => state.clips)
  const overlays = useEditor((state) => state.overlays)
  const audios = useEditor((state) => state.audios)
  const texts = useEditor((state) => state.texts)
  const backgrounds = useEditor((state) => state.backgrounds)
  const playhead = useEditor((state) => state.playhead)
  const isPlaying = useEditor((state) => state.isPlaying)
  const loop = useEditor((state) => state.loop)
  const setPlayhead = useEditor((state) => state.setPlayhead)
  const setPlaying = useEditor((state) => state.setPlaying)
  const setLoop = useEditor((state) => state.setLoop)
  const [mode, setMode] = useState<PreviewMode>('clean')
  const [showUi, setShowUi] = useState(true)
  const [showSafeZone, setShowSafeZone] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const ratio = MODE_RATIO[mode] ?? PROJECT_RATIO[aspectRatio]
  const [deviceBox, setDeviceBox] = useState({ width: 0, height: 0 })
  const duration = projectDuration(clips, overlays, audios, texts, backgrounds)
  const expectedRatio = mode === 'youtube' ? '16:9' : mode === 'clean' ? null : '9:16'
  const ratioMismatch = expectedRatio != null && aspectRatio !== expectedRatio
  const title = projectName || t('내 영상', 'My video')

  const close = () => {
    setPlaying(false)
    onClose()
  }

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const measure = () => setDeviceBox(fitBox(stage.clientWidth, stage.clientHeight, ratio))
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    measure()
    return () => observer.disconnect()
  }, [ratio])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      if (event.code === 'Space') {
        event.preventDefault()
        setPlaying(!useEditor.getState().isPlaying)
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const delta = event.key === 'ArrowLeft' ? -5 : 5
        setPlaying(false)
        setPlayhead(Math.max(0, Math.min(duration, useEditor.getState().playhead + delta)))
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        setPlaying(false)
        setPlayhead(event.key === 'Home' ? 0 : duration)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      setPlaying(false)
    }
  }, [duration, setPlaying, setPlayhead])

  const modeLabels: Array<{ id: PreviewMode; label: string }> = [
    { id: 'clean', label: t('완제품', 'Final') },
    { id: 'youtube', label: 'YouTube' },
    { id: 'shorts', label: 'Shorts' },
    { id: 'tiktok', label: 'TikTok' },
    { id: 'reels', label: 'Reels' },
  ]
  const deviceStyle = {
    width: deviceBox.width,
    height: deviceBox.height,
    ['--preview-device-ratio' as string]: ratio,
  } as CSSProperties

  return (
    <div className="showcase-preview" role="dialog" aria-modal="true" aria-labelledby="showcase-preview-title">
      <section className="showcase-preview__panel">
        <header className="showcase-preview__head">
          <div className="showcase-preview__heading">
            <h2 id="showcase-preview-title">{t('완제품 미리보기', 'Final preview')}</h2>
            <p>{t('편집 손잡이 없이 결과와 플랫폼 가림 영역을 확인합니다.', 'Review the result and platform overlays without editing handles.')}</p>
          </div>
          <div className="showcase-preview__modes" role="tablist" aria-label={t('미리보기 환경', 'Preview environment')}>
            {modeLabels.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={mode === item.id}
                className={mode === item.id ? 'is-active' : ''}
                onClick={() => { setPlaying(false); setMode(item.id) }}>{item.label}</button>
            ))}
          </div>
          <div className="showcase-preview__options">
            <button type="button" className={`btn btn--sm${showUi ? ' btn--on' : ''}`} disabled={mode === 'clean'}
              aria-pressed={mode !== 'clean' && showUi} onClick={() => setShowUi((value) => !value)}>
              <Icon name="eye" />{t('앱 UI', 'App UI')}
            </button>
            <button type="button" className={`btn btn--sm${showSafeZone ? ' btn--on' : ''}`} disabled={mode === 'clean'}
              aria-pressed={mode !== 'clean' && showSafeZone} onClick={() => setShowSafeZone((value) => !value)}>
              <Icon name="grid" />{t('안전 영역', 'Safe zone')}
            </button>
            <button type="button" className="iconbtn" onClick={close} aria-label={t('미리보기 닫기', 'Close preview')}><Icon name="close" /></button>
          </div>
        </header>

        <div className="showcase-preview__workspace">
          <div className="showcase-preview__stage" ref={stageRef}>
            <div className={`showcase-preview__device showcase-preview__device--${mode}`} style={deviceStyle}>
              <div className="showcase-preview__canvas"><Preview presentation onOpenCrop={() => {}} /></div>
              {showUi && <PlatformUi mode={mode} title={title} playhead={playhead} duration={duration} isPlaying={isPlaying} />}
              {showSafeZone && mode !== 'clean' && (
                <div className={`platform-safe-zone platform-safe-zone--${mode}`} aria-hidden="true">
                  <span>{t('중요 콘텐츠 안전 영역', 'Safe area for key content')}</span>
                </div>
              )}
            </div>
          </div>
          <aside className="showcase-preview__status" aria-live="polite">
            <span>{mode === 'clean' ? t('내보낼 화면만 표시 중', 'Showing export canvas only') : t('플랫폼 UI 모의 보기', 'Simulated platform UI')}</span>
            {ratioMismatch
              ? <b>{t(`${mode === 'youtube' ? 'YouTube 영상' : mode === 'shorts' ? 'YouTube Shorts' : mode === 'tiktok' ? 'TikTok' : 'Instagram Reels'}은 ${expectedRatio} 화면을 권장합니다. 현재 프로젝트는 ${aspectRatio}입니다.`, `${mode === 'youtube' ? 'YouTube video' : mode === 'shorts' ? 'YouTube Shorts' : mode === 'tiktok' ? 'TikTok' : 'Instagram Reels'} works best at ${expectedRatio}; this project is ${aspectRatio}.`)}</b>
              : mode !== 'clean' && <b>{t(`${expectedRatio} 화면 비율이 맞습니다.`, `The ${expectedRatio} aspect ratio matches.`)}</b>}
            <small>{t('실제 버튼 위치는 앱 버전·기기·계정 상태에 따라 조금 달라질 수 있습니다.', 'Actual controls may vary slightly by app version, device, and account state.')}</small>
          </aside>
        </div>

        <footer className="showcase-preview__transport">
          <button type="button" className="iconbtn iconbtn--play" onClick={() => setPlaying(!isPlaying)} disabled={duration <= 0}
            aria-label={isPlaying ? t('일시정지', 'Pause') : t('재생', 'Play')}><Icon name={isPlaying ? 'pause' : 'play'} /></button>
          <button type="button" className={`iconbtn${loop ? ' iconbtn--on' : ''}`} onClick={() => setLoop(!loop)} aria-label={t('반복 재생', 'Loop playback')}><Icon name="repeat" /></button>
          <button type="button" className="btn btn--sm" onClick={() => { setPlaying(false); setPlayhead(0) }} disabled={playhead <= 0}>{t('처음부터', 'From start')}</button>
          <span className="showcase-preview__time">{formatTimeFine(playhead)} <i>/ {formatTimeFine(duration)}</i></span>
          <input type="range" min={0} max={Math.max(0.01, duration)} step={1 / 30} value={Math.min(playhead, duration)}
            onChange={(event) => { setPlaying(false); setPlayhead(Number(event.target.value)) }} aria-label={t('미리보기 재생 위치', 'Preview play position')} />
          <span className="showcase-preview__shortcut">{t('Space 재생 · ← → 5초 이동', 'Space play · ← → skip 5s')}</span>
        </footer>
      </section>
    </div>
  )
}
