import { useMemo, useState } from 'react'
import { useEditor } from '../store'
import { audioLength, clipStartOffsets, clipTimelineDuration, formatTime, overlayLength } from '../utils/time'
import Icon from './Icon'

interface Props {
  onClose: () => void
  onPickFiles: () => void
  onPickOverlay: () => void
  onPickAudio: () => void
}

type MediaFilter = 'all' | 'video' | 'image' | 'audio'

export default function MediaPanel({ onClose, onPickFiles, onPickOverlay, onPickAudio }: Props) {
  const clips = useEditor((s) => s.clips)
  const overlays = useEditor((s) => s.overlays)
  const audios = useEditor((s) => s.audios)
  const backgrounds = useEditor((s) => s.backgrounds)
  const selection = useEditor((s) => s.selection)
  const select = useEditor((s) => s.select)
  const setPlayhead = useEditor((s) => s.setPlayhead)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<MediaFilter>('all')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const offsets = clipStartOffsets(clips)
  const rows = useMemo(() => [
    ...clips.map((item, index) => ({ type: 'clip' as const, id: item.id, name: item.name, kind: item.kind, label: '메인', start: offsets[index], length: clipTimelineDuration(item), src: item.src, color: item.bgColor })),
    ...overlays.map((item) => ({ type: 'overlay' as const, id: item.id, name: item.name, kind: item.kind, label: '레이어', start: item.start, length: overlayLength(item), src: item.src, color: undefined })),
    ...audios.map((item) => ({ type: 'audio' as const, id: item.id, name: item.name, kind: 'audio' as const, label: '오디오', start: item.start, length: audioLength(item), src: item.src, color: undefined })),
    ...backgrounds.map((item) => ({ type: 'background' as const, id: item.id, name: item.name, kind: item.kind, label: '배경', start: item.start, length: clipTimelineDuration(item), src: item.src, color: item.bgColor })),
  ].filter((item) => {
    const matchesKind = filter === 'all' || item.kind === filter
    return matchesKind && item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  }), [audios, backgrounds, clips, filter, offsets, overlays, query])

  return (
    <aside className="media-panel" aria-label="프로젝트 미디어">
      <div className="media-panel__head">
        <div><b>미디어</b><small>{rows.length}개 항목</small></div>
        <button className="iconbtn iconbtn--sm" onClick={onClose} aria-label="미디어 패널 닫기"><Icon name="close" /></button>
      </div>
      <div className="media-panel__add">
        <button className="btn btn--primary" onClick={onPickFiles}><Icon name="plus" />파일 가져오기</button>
        <button className="btn btn--sm" onClick={onPickOverlay}><Icon name="layers" />레이어로 추가</button>
        <button className="btn btn--sm" onClick={onPickAudio}><Icon name="music" />오디오 추가</button>
      </div>
      <label className="media-panel__search">
        <Icon name="search" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="파일 이름 찾기" />
      </label>
      <div className="media-panel__tools">
        <div className="media-panel__filters" aria-label="미디어 종류">
          {([['all', '전체'], ['video', '영상'], ['image', '이미지'], ['audio', '오디오']] as const).map(([value, label]) => (
            <button key={value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label}</button>
          ))}
        </div>
        <button className="iconbtn iconbtn--xs" onClick={() => setView((current) => current === 'grid' ? 'list' : 'grid')}
          title={view === 'grid' ? '목록으로 보기' : '격자로 보기'} aria-label={view === 'grid' ? '목록으로 보기' : '격자로 보기'}>
          <Icon name={view === 'grid' ? 'list' : 'grid'} />
        </button>
      </div>
      <div className={`media-panel__list media-panel__list--${view}`}>
        {rows.map((item) => {
          const selected = selection?.type === item.type && selection.id === item.id
          return (
            <button key={`${item.type}:${item.id}`} className={`media-row${selected ? ' media-row--selected' : ''}`} onClick={() => {
              select({ type: item.type, id: item.id })
              setPlayhead(item.start)
            }}>
              <span className="media-row__thumb" style={item.kind === 'color' ? { background: item.color || '#000' } : undefined}>
                {item.kind === 'image' && <img src={item.src} alt="" />}
                {item.kind !== 'image' && item.kind !== 'color' && <Icon name={item.kind === 'audio' ? 'music' : 'video'} />}
              </span>
              <span className="media-row__name" title={item.name}>{item.name}</span>
              <span className="media-row__meta">{item.label} · {formatTime(item.length)}</span>
            </button>
          )
        })}
        {!rows.length && <div className="media-panel__empty">{query || filter !== 'all' ? '조건에 맞는 파일이 없습니다.' : '파일을 가져오면 이곳에서 관리할 수 있습니다.'}</div>}
      </div>
      <p className="media-panel__hint">항목을 선택하면 타임라인 위치와 오른쪽 편집 패널이 함께 열립니다.</p>
    </aside>
  )
}
