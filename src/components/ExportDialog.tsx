import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../store'
import { cancelExport, discardNativeExport, exportVideo, isNativeExportFile, saveNativeExport } from '../ffmpeg/exporter'
import type { NativeExportFile } from '../ffmpeg/exporter'
import { projectDuration, formatTime } from '../utils/time'
import { saveBlob, keepAwake } from '../utils/io'
import type { ExportHeight } from '../types'
import Icon from './Icon'
import { localizedErrorMessage, translate, useLanguage } from '../i18n'
import { canvasLabel } from '../utils/canvas'

const RESOLUTIONS: { h: ExportHeight; label: string }[] = [
  { h: 480, label: '480p' },
  { h: 720, label: '720p HD' },
  { h: 1080, label: '1080p FHD' },
  { h: 1440, label: '1440p 2K' },
  { h: 2160, label: '2160p 4K' },
]
const FORMATS: { v: 'mp4' | 'webm'; label: string }[] = [
  { v: 'mp4', label: 'MP4 (.mp4)' },
  { v: 'webm', label: 'WebM (.webm)' },
]

function validateVideoBlob(blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    if (blob.size === 0) {
      reject(new Error(translate('생성된 영상이 비어 있습니다.', 'The rendered video is empty.')))
      return
    }
    const src = URL.createObjectURL(blob)
    const video = document.createElement('video')
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(src)
      if (error) reject(error)
      else resolve()
    }
    const timer = window.setTimeout(() => finish(new Error(translate('생성된 영상을 확인하는 데 시간이 너무 오래 걸립니다.', 'Validating the rendered video took too long.'))), 15000)
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    video.onloadeddata = () => {
      window.clearTimeout(timer)
      if (!Number.isFinite(video.duration) || video.duration <= 0 || video.videoWidth <= 0 || video.videoHeight <= 0) {
        finish(new Error(translate('생성된 영상이 올바른 MP4/WebM 파일이 아닙니다.', 'The rendered video is not a valid MP4/WebM file.')))
      } else finish()
    }
    video.onerror = () => {
      window.clearTimeout(timer)
      finish(new Error(translate('생성된 영상을 이 기기에서 재생할 수 없습니다.', 'This device cannot play the rendered video.')))
    }
    video.src = src
  })
}

export default function ExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  const desktop = Boolean(window.simplecutDesktop)
  const clips = useEditor((s) => s.clips)
  const texts = useEditor((s) => s.texts)
  const overlays = useEditor((s) => s.overlays)
  const audios = useEditor((s) => s.audios)
  const backgrounds = useEditor((s) => s.backgrounds)
  const visualOrder = useEditor((s) => s.visualOrder)
  const aspectRatio = useEditor((s) => s.aspectRatio)
  const canvasWidth = useEditor((s) => s.canvasWidth)
  const canvasHeight = useEditor((s) => s.canvasHeight)
  const exportSettings = useEditor((s) => s.exportSettings)
  const setExportSettings = useEditor((s) => s.setExportSettings)

  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [nativeFile, setNativeFile] = useState<NativeExportFile | null>(null)
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const cancelRequested = useRef(false)

  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  useEffect(() => () => { if (nativeFile) void discardNativeExport(nativeFile) }, [nativeFile])

  const duration = projectDuration(clips, overlays, audios, texts, backgrounds)
  const fullName = `${exportSettings.filename || 'simplecut'}.${exportSettings.format}`

  const run = async () => {
    if (url) { URL.revokeObjectURL(url); setUrl(null) }
    if (nativeFile) { await discardNativeExport(nativeFile); setNativeFile(null) }
    setBlob(null)
    setPhase('running')
    setProgress(0)
    setStatus(desktop ? t('네이티브 렌더링 엔진 준비 중…', 'Preparing the native rendering engine…') : t('엔진 로딩 중… (최초 1회는 시간이 걸립니다)', 'Loading the engine… The first run may take a moment.'))
    setError('')
    setCancelling(false)
    cancelRequested.current = false
    const releaseWake = await keepAwake()
    try {
      const out = await exportVideo({
        clips,
        texts,
        overlays,
        audios,
        backgrounds,
        visualOrder,
        aspect: aspectRatio,
        canvasWidth,
        canvasHeight,
        height: exportSettings.height,
        format: exportSettings.format,
        onProgress: (r) => {
          setProgress(r)
          setStatus(t(`렌더링 중… ${Math.round(r * 100)}%`, `Rendering… ${Math.round(r * 100)}%`))
        },
        onLog: (line) => { if (/error|failed/i.test(line)) console.warn(line) },
      })
      setProgress(0.98)
      if (isNativeExportFile(out)) {
        setNativeFile(out)
      } else {
        setStatus(t('파일 재생 가능 여부 확인 중…', 'Checking file playback compatibility…'))
        await validateVideoBlob(out)
        setBlob(out)
        setUrl(URL.createObjectURL(out))
      }
      setPhase('done')
      setProgress(1)
      setStatus(t(`완료! 크기 ${(out.size / 1024 / 1024).toFixed(1)} MB`, `Complete! ${(out.size / 1024 / 1024).toFixed(1)} MB`))
    } catch (e) {
      console.error(e)
      if (cancelRequested.current) {
        setPhase('idle')
        setStatus(t('렌더링을 취소했습니다.', 'Rendering cancelled.'))
      } else {
        setError(localizedErrorMessage(e, '내보내기에 실패했습니다.', 'Export failed.'))
        setPhase('error')
      }
    } finally {
      setCancelling(false)
      releaseWake()
    }
  }

  const cancel = () => {
    cancelRequested.current = true
    setCancelling(true)
    setStatus(t('렌더링 취소 중…', 'Cancelling render…'))
    cancelExport()
  }

  const save = async () => {
    if (!blob && !nativeFile) return
    try {
      if (nativeFile) {
        const where = await saveNativeExport(nativeFile, fullName)
        setStatus(where === 'saved' ? t('저장 위치에 저장했습니다.', 'Saved to the selected location.') : t('저장을 취소했습니다.', 'Save cancelled.'))
      } else if (blob) {
        const where = await saveBlob(blob, fullName)
        setStatus(where === 'saved' ? t('저장 위치에 저장했습니다.', 'Saved to the selected location.') : t('다운로드 폴더에 저장했습니다.', 'Saved to Downloads.'))
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setStatus(t('저장 실패: ', 'Save failed: ') + localizedErrorMessage(error, '알 수 없는 오류', 'Unknown error'))
    }
  }

  return (
    <div className="modal" onClick={phase === 'running' ? undefined : onClose}>
      <div className="modal__panel" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title" aria-busy={phase === 'running' || undefined} onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2 id="export-dialog-title">{t('영상 내보내기', 'Export video')}</h2>
          {phase !== 'running' && <button className="iconbtn" onClick={onClose} aria-label={t('닫기', 'Close')}><Icon name="close" /></button>}
        </div>

        <div className="modal__row"><span>{t('화면 비율', 'Aspect ratio')}</span><b>{canvasLabel(aspectRatio, { width: canvasWidth, height: canvasHeight })}</b></div>
        <div className="modal__row"><span>{t('출력 크기', 'Output size')}</span><b>{canvasWidth} × {canvasHeight} px</b></div>
        <div className="modal__row"><span>{t('전체 길이', 'Total duration')}</span><b>{formatTime(duration)}</b></div>

        <div className="modal__field">
          <span>{t('파일 이름', 'File name')}</span>
          <div className="filename">
            <input className="filename__input" value={exportSettings.filename} disabled={phase === 'running'}
              onChange={(e) => setExportSettings({ filename: e.target.value.replace(/[\\/:*?"<>|]/g, '') })} />
            <span className="filename__ext">.{exportSettings.format}</span>
          </div>
        </div>

        <div className="modal__field">
          <span>{t('형식', 'Format')}</span>
          <div className="chips">
            {FORMATS.map((f) => (
              <button key={f.v} className={`chip${exportSettings.format === f.v ? ' chip--on' : ''}`}
                disabled={phase === 'running'} onClick={() => setExportSettings({ format: f.v })}>{f.label}</button>
            ))}
          </div>
        </div>

        <div className="modal__field">
          <span>{t('해상도', 'Resolution')}</span>
          <div className="chips">
            {RESOLUTIONS.map((r) => (
              <button key={r.h} className={`chip${exportSettings.height === r.h ? ' chip--on' : ''}`}
                disabled={phase === 'running'} onClick={() => setExportSettings({ height: r.h })}>{r.label}</button>
            ))}
          </div>
          {exportSettings.height >= 1440 && (
            <div className="modal__hint"><Icon name="warning" />{desktop ? t('4K 출력은 원본 길이와 효과에 따라 시간이 걸릴 수 있어요.', '4K export may take time depending on source length and effects.') : t('고해상도는 브라우저에서 렌더링이 오래 걸릴 수 있어요.', 'High-resolution rendering may take longer in a browser.')}</div>
          )}
        </div>

        <div className="modal__note">{t('메인 트랙과 자막, 오버레이, 배경, 음악이 모두 결과물에 합성됩니다.', 'The main track, text, overlays, backgrounds, and music will all be composited into the result.')}</div>

        {phase === 'running' && (
          <div className="progress">
            <div className={`progress__bar${progress === 0 ? ' progress__bar--indeterminate' : ''}`}><div className="progress__fill" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <div className="progress__status" role="status" aria-live="polite">{status}</div>
            <div className="modal__hint"><Icon name="screen" />{desktop ? t('컴퓨터의 네이티브 FFmpeg로 렌더링하고 있습니다. 앱을 종료하지 마세요.', 'Rendering with native FFmpeg. Do not quit the app.') : t('변환 중 화면이 꺼지지 않도록 유지합니다(지원 기기). 탭을 닫지 마세요.', 'Keeping the screen awake when supported. Do not close this tab.')}</div>
          </div>
        )}

        {phase === 'error' && <div className="modal__error" role="alert"><Icon name="warning" />{error}</div>}

        {phase === 'done' && (url || nativeFile) && (
          <div className="modal__done">
            {url ? <video src={url} controls className="modal__preview" /> : <div className="modal__native-file"><Icon name="video" />{t(`${nativeFile?.format.toUpperCase()} 파일 생성과 검증이 완료됐습니다.`, `${nativeFile?.format.toUpperCase()} file created and verified.`)}</div>}
            <div className="modal__status">{status}</div>
          </div>
        )}

        <div className="modal__actions">
          {phase === 'idle' && (
            <button className="btn btn--primary btn--lg" onClick={run} disabled={clips.length === 0}>{t('내보내기 시작', 'Start export')}</button>
          )}
          {phase === 'running' && <button className="btn btn--lg btn--danger" onClick={cancel} disabled={cancelling}>{cancelling ? t('취소 중…', 'Cancelling…') : t('렌더링 취소', 'Cancel rendering')}</button>}
          {phase === 'error' && <button className="btn btn--primary btn--lg" onClick={run}>{t('다시 시도', 'Try again')}</button>}
          {phase === 'done' && (
            <button className="btn btn--primary btn--lg" onClick={save}><Icon name="download" />{t('저장하기', 'Save')}</button>
          )}
        </div>
      </div>
    </div>
  )
}
