import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../store'
import { cancelExport, discardNativeExport, exportVideo, isNativeExportFile, saveNativeExport } from '../ffmpeg/exporter'
import type { NativeExportFile } from '../ffmpeg/exporter'
import { projectDuration, formatTime } from '../utils/time'
import { saveBlob, keepAwake } from '../utils/io'
import type { ExportHeight } from '../types'
import Icon from './Icon'

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
      reject(new Error('생성된 영상이 비어 있습니다.'))
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
    const timer = window.setTimeout(() => finish(new Error('생성된 영상을 확인하는 데 시간이 너무 오래 걸립니다.')), 15000)
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    video.onloadeddata = () => {
      window.clearTimeout(timer)
      if (!Number.isFinite(video.duration) || video.duration <= 0 || video.videoWidth <= 0 || video.videoHeight <= 0) {
        finish(new Error('생성된 영상이 올바른 MP4/WebM 파일이 아닙니다.'))
      } else finish()
    }
    video.onerror = () => {
      window.clearTimeout(timer)
      finish(new Error('생성된 영상을 이 기기에서 재생할 수 없습니다.'))
    }
    video.src = src
  })
}

export default function ExportDialog({ onClose }: { onClose: () => void }) {
  const desktop = Boolean(window.simplecutDesktop)
  const clips = useEditor((s) => s.clips)
  const texts = useEditor((s) => s.texts)
  const overlays = useEditor((s) => s.overlays)
  const audios = useEditor((s) => s.audios)
  const backgrounds = useEditor((s) => s.backgrounds)
  const visualOrder = useEditor((s) => s.visualOrder)
  const aspectRatio = useEditor((s) => s.aspectRatio)
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
    setStatus(desktop ? '네이티브 렌더링 엔진 준비 중…' : '엔진 로딩 중… (최초 1회는 시간이 걸립니다)')
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
        height: exportSettings.height,
        format: exportSettings.format,
        onProgress: (r) => {
          setProgress(r)
          setStatus(`렌더링 중… ${Math.round(r * 100)}%`)
        },
        onLog: (line) => { if (/error|failed/i.test(line)) console.warn(line) },
      })
      setProgress(0.98)
      if (isNativeExportFile(out)) {
        setNativeFile(out)
      } else {
        setStatus('파일 재생 가능 여부 확인 중…')
        await validateVideoBlob(out)
        setBlob(out)
        setUrl(URL.createObjectURL(out))
      }
      setPhase('done')
      setProgress(1)
      setStatus(`완료! 크기 ${(out.size / 1024 / 1024).toFixed(1)} MB`)
    } catch (e) {
      console.error(e)
      if (cancelRequested.current) {
        setPhase('idle')
        setStatus('렌더링을 취소했습니다.')
      } else {
        setError((e as Error).message || '내보내기에 실패했습니다.')
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
    setStatus('렌더링 취소 중…')
    cancelExport()
  }

  const save = async () => {
    if (!blob && !nativeFile) return
    try {
      if (nativeFile) {
        const where = await saveNativeExport(nativeFile, fullName)
        setStatus(where === 'saved' ? '저장 위치에 저장했습니다.' : '저장을 취소했습니다.')
      } else if (blob) {
        const where = await saveBlob(blob, fullName)
        setStatus(where === 'saved' ? '저장 위치에 저장했습니다.' : '다운로드 폴더에 저장했습니다.')
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setStatus(`저장 실패: ${(error as Error).message}`)
    }
  }

  return (
    <div className="modal" onClick={phase === 'running' ? undefined : onClose}>
      <div className="modal__panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>영상 내보내기</h2>
          {phase !== 'running' && <button className="iconbtn" onClick={onClose} aria-label="닫기"><Icon name="close" /></button>}
        </div>

        <div className="modal__row"><span>화면 비율</span><b>{aspectRatio}</b></div>
        <div className="modal__row"><span>전체 길이</span><b>{formatTime(duration)}</b></div>

        <div className="modal__field">
          <span>파일 이름</span>
          <div className="filename">
            <input className="filename__input" value={exportSettings.filename} disabled={phase === 'running'}
              onChange={(e) => setExportSettings({ filename: e.target.value.replace(/[\\/:*?"<>|]/g, '') })} />
            <span className="filename__ext">.{exportSettings.format}</span>
          </div>
        </div>

        <div className="modal__field">
          <span>형식</span>
          <div className="chips">
            {FORMATS.map((f) => (
              <button key={f.v} className={`chip${exportSettings.format === f.v ? ' chip--on' : ''}`}
                disabled={phase === 'running'} onClick={() => setExportSettings({ format: f.v })}>{f.label}</button>
            ))}
          </div>
        </div>

        <div className="modal__field">
          <span>해상도</span>
          <div className="chips">
            {RESOLUTIONS.map((r) => (
              <button key={r.h} className={`chip${exportSettings.height === r.h ? ' chip--on' : ''}`}
                disabled={phase === 'running'} onClick={() => setExportSettings({ height: r.h })}>{r.label}</button>
            ))}
          </div>
          {exportSettings.height >= 1440 && (
            <div className="modal__hint"><Icon name="warning" />{desktop ? '4K 출력은 원본 길이와 효과에 따라 시간이 걸릴 수 있어요.' : '고해상도는 브라우저에서 렌더링이 오래 걸릴 수 있어요.'}</div>
          )}
        </div>

        <div className="modal__note">메인 트랙과 자막, 오버레이, 배경, 음악이 모두 결과물에 합성됩니다.</div>

        {phase === 'running' && (
          <div className="progress">
            <div className={`progress__bar${progress === 0 ? ' progress__bar--indeterminate' : ''}`}><div className="progress__fill" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <div className="progress__status">{status}</div>
            <div className="modal__hint"><Icon name="screen" />{desktop ? '컴퓨터의 네이티브 FFmpeg로 렌더링하고 있습니다. 앱을 종료하지 마세요.' : '변환 중 화면이 꺼지지 않도록 유지합니다(지원 기기). 탭을 닫지 마세요.'}</div>
          </div>
        )}

        {phase === 'error' && <div className="modal__error"><Icon name="warning" />{error}</div>}

        {phase === 'done' && (url || nativeFile) && (
          <div className="modal__done">
            {url ? <video src={url} controls className="modal__preview" /> : <div className="modal__native-file"><Icon name="video" />{nativeFile?.format.toUpperCase()} 파일 생성과 검증이 완료됐습니다.</div>}
            <div className="modal__status">{status}</div>
          </div>
        )}

        <div className="modal__actions">
          {phase === 'idle' && (
            <button className="btn btn--primary btn--lg" onClick={run} disabled={clips.length === 0}>내보내기 시작</button>
          )}
          {phase === 'running' && <button className="btn btn--lg btn--danger" onClick={cancel} disabled={cancelling}>{cancelling ? '취소 중…' : '렌더링 취소'}</button>}
          {phase === 'error' && <button className="btn btn--primary btn--lg" onClick={run}>다시 시도</button>}
          {phase === 'done' && (
            <button className="btn btn--primary btn--lg" onClick={save}><Icon name="download" />저장하기</button>
          )}
        </div>
      </div>
    </div>
  )
}
