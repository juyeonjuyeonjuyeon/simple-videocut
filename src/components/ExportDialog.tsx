import { useEffect, useState } from 'react'
import { useEditor } from '../store'
import { exportVideo } from '../ffmpeg/exporter'
import { projectDuration, formatTime } from '../utils/time'
import { saveBlob, keepAwake } from '../utils/io'
import type { ExportHeight } from '../types'

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

export default function ExportDialog({ onClose }: { onClose: () => void }) {
  const clips = useEditor((s) => s.clips)
  const texts = useEditor((s) => s.texts)
  const overlays = useEditor((s) => s.overlays)
  const audios = useEditor((s) => s.audios)
  const backgrounds = useEditor((s) => s.backgrounds)
  const aspectRatio = useEditor((s) => s.aspectRatio)
  const exportSettings = useEditor((s) => s.exportSettings)
  const setExportSettings = useEditor((s) => s.setExportSettings)

  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [error, setError] = useState('')

  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const duration = projectDuration(clips, overlays, audios, texts, backgrounds)
  const fullName = `${exportSettings.filename || 'simplecut'}.${exportSettings.format}`

  const run = async () => {
    if (url) { URL.revokeObjectURL(url); setUrl(null) }
    setPhase('running')
    setProgress(0)
    setStatus('엔진 로딩 중… (최초 1회는 시간이 걸립니다)')
    setError('')
    const releaseWake = await keepAwake()
    try {
      const out = await exportVideo({
        clips,
        texts,
        overlays,
        audios,
        backgrounds,
        aspect: aspectRatio,
        height: exportSettings.height,
        format: exportSettings.format,
        onProgress: (r) => {
          setProgress(r)
          setStatus(`렌더링 중… ${Math.round(r * 100)}%`)
        },
        onLog: (line) => {
          if (line.includes('frame=')) setStatus(line.trim().slice(0, 60))
        },
      })
      setBlob(out)
      setUrl(URL.createObjectURL(out))
      setPhase('done')
      setStatus(`완료! 크기 ${(out.size / 1024 / 1024).toFixed(1)} MB`)
    } catch (e) {
      console.error(e)
      setError((e as Error).message || '내보내기에 실패했습니다.')
      setPhase('error')
    } finally {
      releaseWake()
    }
  }

  const save = async () => {
    if (!blob) return
    try {
      const where = await saveBlob(blob, fullName)
      setStatus(where === 'saved' ? '저장 위치에 저장했습니다.' : '다운로드 폴더에 저장했습니다.')
    } catch {
      /* user cancelled */
    }
  }

  return (
    <div className="modal" onClick={phase === 'running' ? undefined : onClose}>
      <div className="modal__panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>영상 내보내기</h2>
          {phase !== 'running' && <button className="iconbtn" onClick={onClose} aria-label="닫기">✕</button>}
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
            <div className="modal__hint">⚠️ 고해상도는 브라우저에서 렌더링이 오래 걸릴 수 있어요.</div>
          )}
        </div>

        <div className="modal__note">메인 트랙과 자막, 오버레이, 배경, 음악이 모두 결과물에 합성됩니다.</div>

        {phase === 'running' && (
          <div className="progress">
            <div className="progress__bar"><div className="progress__fill" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <div className="progress__status">{status}</div>
            <div className="modal__hint">📵 변환 중 화면이 꺼지지 않도록 유지합니다(지원 기기). 탭을 닫지 마세요.</div>
          </div>
        )}

        {phase === 'error' && <div className="modal__error">⚠️ {error}</div>}

        {phase === 'done' && url && (
          <div className="modal__done">
            <video src={url} controls className="modal__preview" />
            <div className="modal__status">{status}</div>
          </div>
        )}

        <div className="modal__actions">
          {phase === 'idle' && (
            <button className="btn btn--primary btn--lg" onClick={run} disabled={clips.length === 0}>내보내기 시작</button>
          )}
          {phase === 'running' && <button className="btn btn--lg" disabled>처리 중…</button>}
          {phase === 'error' && <button className="btn btn--primary btn--lg" onClick={run}>다시 시도</button>}
          {phase === 'done' && (
            <button className="btn btn--primary btn--lg" onClick={save}>⬇ 저장하기</button>
          )}
        </div>
      </div>
    </div>
  )
}
