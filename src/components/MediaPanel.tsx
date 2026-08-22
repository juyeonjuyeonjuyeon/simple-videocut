import { useMemo, useState } from 'react'
import { useEditor } from '../store'
import type { MediaAsset, ShapeKind } from '../types'
import { audioLength, clipStartOffsets, clipTimelineDuration, formatTime, overlayLength } from '../utils/time'
import Icon from './Icon'
import ShapeIcon from './ShapeIcon'
import { useLanguage } from '../i18n'

interface Props {
  onClose: () => void
  onImport: () => void
  onImportVisual: () => void
  onImportAudio: () => void
}

type MediaFilter = 'all' | 'video' | 'image' | 'audio'
type PanelTab = 'library' | 'timeline'

export default function MediaPanel({ onClose, onImport, onImportVisual, onImportAudio }: Props) {
  const { t } = useLanguage()
  const library = useEditor((s) => s.mediaLibrary)
  const clips = useEditor((s) => s.clips)
  const overlays = useEditor((s) => s.overlays)
  const audios = useEditor((s) => s.audios)
  const backgrounds = useEditor((s) => s.backgrounds)
  const selection = useEditor((s) => s.selection)
  const select = useEditor((s) => s.select)
  const setPlayhead = useEditor((s) => s.setPlayhead)
  const addToTimeline = useEditor((s) => s.addMediaAssetToTimeline)
  const renameAsset = useEditor((s) => s.renameMediaAsset)
  const removeAsset = useEditor((s) => s.removeMediaAsset)
  const [tab, setTab] = useState<PanelTab>('library')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<MediaFilter>('all')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [focusedAsset, setFocusedAsset] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const offsets = clipStartOffsets(clips)

  const usageRows = useMemo(() => [
    ...clips.map((item, index) => ({ type: 'clip' as const, id: item.id, assetId: item.assetId, name: item.name, kind: item.kind, label: t('메인', 'Main'), start: offsets[index], length: clipTimelineDuration(item), src: item.src, color: item.bgColor })),
    ...overlays.map((item) => ({ type: 'overlay' as const, id: item.id, assetId: item.assetId, name: item.name, kind: item.kind, shapeKind: item.shape?.kind, label: item.shape ? t('도형', 'Shape') : t('레이어', 'Layer'), start: item.start, length: overlayLength(item), src: item.src, color: item.shape?.fillColor })),
    ...audios.map((item) => ({ type: 'audio' as const, id: item.id, assetId: item.assetId, name: item.name, kind: 'audio' as const, label: t('오디오', 'Audio'), start: item.start, length: audioLength(item), src: item.src, color: undefined })),
    ...backgrounds.map((item) => ({ type: 'background' as const, id: item.id, assetId: item.assetId, name: item.name, kind: item.kind, label: t('배경', 'Background'), start: item.start, length: clipTimelineDuration(item), src: item.src, color: item.bgColor })),
  ], [audios, backgrounds, clips, offsets, overlays, t])

  const visibleAssets = useMemo(() => library.filter((asset) => {
    const matchesKind = filter === 'all' || asset.kind === filter
    return matchesKind && asset.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  }), [filter, library, query])
  const visibleUsage = useMemo(() => usageRows.filter((item) => {
    const matchesKind = filter === 'all' || item.kind === filter
    return matchesKind && item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  }), [filter, query, usageRows])

  const usageCount = (asset: MediaAsset) => usageRows.filter((item) => item.assetId === asset.id).length
  const beginRename = (asset: MediaAsset) => { setRenaming(asset.id); setNameDraft(asset.name) }
  const commitRename = (asset: MediaAsset) => {
    renameAsset(asset.id, nameDraft)
    setRenaming(null)
  }
  const remove = (asset: MediaAsset) => {
    const uses = usageCount(asset)
    const suffix = uses ? t(`\n타임라인에서 사용 중인 ${uses}개 항목은 그대로 유지됩니다.`, `\n${uses} item(s) already used on the timeline will remain.`) : ''
    if (!confirm(t(`보관함에서 '${asset.name}' 파일을 제거할까요?${suffix}`, `Remove '${asset.name}' from the media bin?${suffix}`))) return
    removeAsset(asset.id)
    if (focusedAsset === asset.id) setFocusedAsset(null)
  }

  const mediaThumb = (item: { kind: string; src: string; color?: string; shapeKind?: ShapeKind }) => (
    <span className="media-row__thumb" style={item.kind === 'color' ? { background: item.color || '#000' } : undefined}>
      {item.shapeKind ? <ShapeIcon kind={item.shapeKind} /> : item.kind === 'image' ? <img src={item.src} alt="" /> : null}
      {!item.shapeKind && item.kind !== 'image' && item.kind !== 'color' && <Icon name={item.kind === 'audio' ? 'music' : 'video'} />}
    </span>
  )

  return (
    <aside className="media-panel" aria-label={t('프로젝트 미디어', 'Project media')}>
      <div className="media-panel__head">
        <div><b>{t('미디어', 'Media')}</b><small>{t(`${library.length}개 보관 · ${usageRows.length}개 사용`, `${library.length} in bin · ${usageRows.length} in use`)}</small></div>
        <button className="iconbtn iconbtn--sm" onClick={onClose} aria-label={t('미디어 패널 닫기', 'Close media panel')}><Icon name="close" /></button>
      </div>

      <div className="media-panel__add">
        <button className="btn btn--primary media-panel__import" onClick={onImport}><Icon name="plus" />{t('모든 미디어 가져오기', 'Import any media')}</button>
        <button className="btn btn--sm" onClick={onImportVisual}><Icon name="image" />{t('사진·영상', 'Photos · video')}</button>
        <button className="btn btn--sm" onClick={onImportAudio}><Icon name="music" />{t('녹음·오디오', 'Recordings · audio')}</button>
      </div>

      <div className="media-panel__tabs" role="tablist" aria-label={t('미디어 보기', 'Media view')}>
        <button role="tab" aria-selected={tab === 'library'} className={tab === 'library' ? 'is-active' : ''} onClick={() => setTab('library')}>{t('보관함', 'Media bin')}</button>
        <button role="tab" aria-selected={tab === 'timeline'} className={tab === 'timeline' ? 'is-active' : ''} onClick={() => setTab('timeline')}>{t('사용 중', 'In use')}</button>
      </div>

      <label className="media-panel__search">
        <Icon name="search" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('미디어 이름 찾기', 'Search media')} aria-label={t('미디어 이름 찾기', 'Search media')} />
      </label>
      <div className="media-panel__tools">
        <div className="media-panel__filters" aria-label={t('미디어 종류', 'Media type')}>
          {([['all', t('전체', 'All')], ['video', t('영상', 'Video')], ['image', t('이미지', 'Image')], ['audio', t('오디오', 'Audio')]] as const).map(([value, label]) => (
            <button key={value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label}</button>
          ))}
        </div>
        <button className="iconbtn iconbtn--xs" onClick={() => setView((current) => current === 'grid' ? 'list' : 'grid')}
          aria-label={view === 'grid' ? t('목록으로 보기', 'List view') : t('격자로 보기', 'Grid view')}>
          <Icon name={view === 'grid' ? 'list' : 'grid'} />
        </button>
      </div>

      {tab === 'library' ? (
        <div className={`media-panel__list media-panel__list--${view}`}>
          {visibleAssets.map((asset) => {
            const focused = focusedAsset === asset.id
            const uses = usageCount(asset)
            return (
              <article key={asset.id} className={`media-asset${focused ? ' media-asset--focused' : ''}`}
                title={t('두 번 눌러 기본 트랙에 추가', 'Double-click to add to the main track')}
                onClick={() => setFocusedAsset(asset.id)} onDoubleClick={(event) => {
                  if ((event.target as HTMLElement).closest('button,input')) return
                  addToTimeline(asset.id, 'auto')
                }}>
                {mediaThumb(asset)}
                <div className="media-asset__copy">
                  {renaming === asset.id ? (
                    <input className="media-asset__rename" value={nameDraft} autoFocus aria-label={t('미디어 이름', 'Media name')}
                      onClick={(event) => event.stopPropagation()} onChange={(event) => setNameDraft(event.target.value)}
                      onBlur={() => commitRename(asset)} onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename(asset)
                        if (event.key === 'Escape') setRenaming(null)
                      }} />
                  ) : <b title={asset.name}>{asset.name}</b>}
                  <small>{asset.kind === 'video' ? t('영상', 'Video') : asset.kind === 'image' ? t('이미지', 'Image') : t('오디오', 'Audio')} · {formatTime(asset.duration)}{uses ? t(` · ${uses}회 사용`, ` · used ${uses}×`) : ''}</small>
                </div>
                <div className="media-asset__actions">
                  {asset.kind === 'audio' ? (
                    <button className="btn btn--xs btn--primary" onClick={(event) => { event.stopPropagation(); addToTimeline(asset.id) }}>{t('타임라인에 추가', 'Add to timeline')}</button>
                  ) : <>
                    <button className="btn btn--xs btn--primary" onClick={(event) => { event.stopPropagation(); addToTimeline(asset.id, 'main') }}>{t('메인에 추가', 'Add to main')}</button>
                    <button className="btn btn--xs" onClick={(event) => { event.stopPropagation(); addToTimeline(asset.id, 'overlay') }}>{t('레이어에 추가', 'Add as layer')}</button>
                  </>}
                  <button className="media-asset__text-action" onClick={(event) => { event.stopPropagation(); beginRename(asset) }}>{t('이름 변경', 'Rename')}</button>
                  <button className="media-asset__text-action media-asset__text-action--danger" onClick={(event) => { event.stopPropagation(); remove(asset) }}>{t('제거', 'Remove')}</button>
                </div>
              </article>
            )
          })}
          {!visibleAssets.length && <div className="media-panel__empty">{query || filter !== 'all' ? t('조건에 맞는 파일이 없습니다.', 'No files match your filters.') : <>{t('가져온 미디어가 없습니다.', 'No media has been imported.')}<br />{t('위 버튼을 누르거나 앱 화면에 파일을 끌어 놓으세요.', 'Use the button above or drop files anywhere in the app.')}</>}</div>}
        </div>
      ) : (
        <div className={`media-panel__list media-panel__list--${view}`}>
          {visibleUsage.map((item) => {
            const selected = selection?.type === item.type && selection.id === item.id
            return (
              <button key={`${item.type}:${item.id}`} className={`media-row${selected ? ' media-row--selected' : ''}`} onClick={() => {
                select({ type: item.type, id: item.id })
                setPlayhead(item.start)
              }}>
                {mediaThumb(item)}
                <span className="media-row__name" title={item.name}>{item.name}</span>
                <span className="media-row__meta">{item.label} · {formatTime(item.length)}</span>
              </button>
            )
          })}
          {!visibleUsage.length && <div className="media-panel__empty">{query || filter !== 'all' ? t('조건에 맞는 항목이 없습니다.', 'No items match your filters.') : t('타임라인에서 사용 중인 미디어가 없습니다.', 'No media is currently used on the timeline.')}</div>}
        </div>
      )}
    </aside>
  )
}
