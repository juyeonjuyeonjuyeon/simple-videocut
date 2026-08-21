import { useMemo, useState } from 'react'
import { useEditor } from '../store'
import { clipStartOffsets } from '../utils/time'
import Icon from './Icon'

interface Props {
  onClose: () => void
  onPickFiles: () => void
  onPickOverlay: () => void
  onPickAudio: () => void
}

export default function MediaPanel({ onClose, onPickFiles, onPickOverlay, onPickAudio }: Props) {
  const clips = useEditor((s) => s.clips)
  const overlays = useEditor((s) => s.overlays)
  const audios = useEditor((s) => s.audios)
  const select = useEditor((s) => s.select)
  const setPlayhead = useEditor((s) => s.setPlayhead)
  const [query, setQuery] = useState('')
  const offsets = clipStartOffsets(clips)
  const rows = useMemo(() => [
    ...clips.map((item, index) => ({ type: 'clip' as const, id: item.id, name: item.name, kind: item.kind, label: '메인', start: offsets[index] })),
    ...overlays.map((item) => ({ type: 'overlay' as const, id: item.id, name: item.name, kind: item.kind, label: '오버레이', start: item.start })),
    ...audios.map((item) => ({ type: 'audio' as const, id: item.id, name: item.name, kind: 'audio' as const, label: '음악', start: item.start })),
  ].filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [audios, clips, offsets, overlays, query])

  return (
    <aside className="media-panel" aria-label="프로젝트 미디어">
      <div className="media-panel__head">
        <b>프로젝트 미디어</b>
        <button className="iconbtn iconbtn--sm" onClick={onClose} aria-label="미디어 패널 닫기"><Icon name="close" /></button>
      </div>
      <div className="media-panel__add">
        <button className="btn btn--primary" onClick={onPickFiles}><Icon name="plus" />파일 추가</button>
        <button className="btn btn--sm" onClick={onPickOverlay}><Icon name="layers" />오버레이</button>
        <button className="btn btn--sm" onClick={onPickAudio}><Icon name="music" />음악</button>
      </div>
      <label className="media-panel__search">
        <Icon name="search" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="파일 이름 찾기" />
      </label>
      <div className="media-panel__list">
        {rows.map((item) => (
          <button key={`${item.type}:${item.id}`} className="media-row" onClick={() => {
            select({ type: item.type, id: item.id })
            setPlayhead(item.start)
          }}>
            <span className="media-row__icon"><Icon name={item.kind === 'audio' ? 'music' : item.kind === 'image' ? 'image' : 'video'} /></span>
            <span className="media-row__name">{item.name}</span>
            <span className="media-row__track">{item.label}</span>
          </button>
        ))}
        {!rows.length && <div className="media-panel__empty">{query ? '찾는 파일이 없습니다.' : '추가된 파일이 없습니다.'}</div>}
      </div>
      <p className="media-panel__hint">항목을 누르면 타임라인 위치와 편집 패널이 함께 열립니다.</p>
    </aside>
  )
}
