import { useEffect, useMemo, useState } from 'react'
import { useEditor } from '../store'
import Icon from './Icon'
import { formatClock, formatTimeFine } from '../utils/time'
import { translate, useLanguage } from '../i18n'

export default function CaptionDialog({ onClose }: { onClose: () => void }) {
  useLanguage()
  const tracks = useEditor((state) => state.captionTracks)
  const playhead = useEditor((state) => state.playhead)
  const select = useEditor((state) => state.select)
  const setPlayhead = useEditor((state) => state.setPlayhead)
  const addTrack = useEditor((state) => state.addCaptionTrack)
  const updateTrack = useEditor((state) => state.updateCaptionTrack)
  const removeTrack = useEditor((state) => state.removeCaptionTrack)
  const addCue = useEditor((state) => state.addCaptionCue)
  const updateCue = useEditor((state) => state.updateCaptionCue)
  const removeCue = useEditor((state) => state.removeCaptionCue)
  const selection = useEditor((state) => state.selection)
  const selectedTrackId = selection?.type === 'caption'
    ? tracks.find((track) => track.cues.some((cue) => cue.id === selection.id))?.id
    : undefined
  const [activeTrackId, setActiveTrackId] = useState(() => selectedTrackId ?? tracks[0]?.id ?? '')

  useEffect(() => {
    if (selectedTrackId) setActiveTrackId(selectedTrackId)
    else if (!tracks.some((track) => track.id === activeTrackId)) setActiveTrackId(tracks[0]?.id ?? '')
  }, [activeTrackId, selectedTrackId, tracks])

  const track = tracks.find((candidate) => candidate.id === activeTrackId) ?? tracks[0]
  const cues = useMemo(() => track ? [...track.cues].sort((a, b) => a.start - b.start || a.end - b.end) : [], [track])
  const createTrack = () => {
    const id = addTrack()
    setActiveTrackId(id)
  }
  const createCue = () => {
    if (!track) {
      const id = addTrack()
      setActiveTrackId(id)
      const cueId = useEditor.getState().addCaptionCue(id, playhead)
      if (cueId) select({ type: 'caption', id: cueId })
      return
    }
    const cueId = addCue(track.id, playhead)
    if (cueId) select({ type: 'caption', id: cueId })
  }

  return (
    <div className="modal caption-dialog" onClick={onClose}>
      <div className="modal__panel caption-dialog__panel" onClick={(event) => event.stopPropagation()}>
        <div className="modal__head">
          <div><h2>{translate('자막', 'Captions')}</h2><small>{translate('시간 순서대로 자막을 작성하고 바로 이동할 수 있습니다.', 'Write captions in time order and jump to each cue.')}</small></div>
          <button className="iconbtn" onClick={onClose} aria-label={translate('닫기', 'Close')}><Icon name="close" /></button>
        </div>

        <div className="caption-dialog__toolbar">
          <div className="caption-dialog__tracks" role="tablist" aria-label={translate('자막 트랙', 'Caption tracks')}>
            {tracks.map((candidate) => (
              <button key={candidate.id} role="tab" aria-selected={candidate.id === track?.id}
                className={candidate.id === track?.id ? 'is-active' : ''} onClick={() => setActiveTrackId(candidate.id)}>
                {candidate.name}<span>{candidate.cues.length}</span>
              </button>
            ))}
            <button className="caption-dialog__add-track" onClick={createTrack}><Icon name="plus" />{translate('트랙', 'Track')}</button>
          </div>
          <button className="btn btn--primary" onClick={createCue} disabled={Boolean(track?.locked)}><Icon name="plus" />{translate('현재 위치에 자막', 'Caption at playhead')}</button>
        </div>

        {track ? <>
          <div className="caption-dialog__track-settings">
            <input value={track.name} aria-label={translate('자막 트랙 이름', 'Caption track name')}
              onChange={(event) => updateTrack(track.id, { name: event.target.value })} />
            <select value={track.language} aria-label={translate('자막 언어', 'Caption language')}
              onChange={(event) => updateTrack(track.id, { language: event.target.value })}>
              <option value="und">{translate('언어 지정 안 함', 'Language not specified')}</option>
              <option value="ko">{translate('한국어', 'Korean')}</option>
              <option value="en">English</option>
            </select>
            <label className="switch"><input type="checkbox" checked={track.hidden} onChange={(event) => updateTrack(track.id, { hidden: event.target.checked })} /><span>{translate('숨김', 'Hidden')}</span></label>
            <label className="switch"><input type="checkbox" checked={track.locked} onChange={(event) => updateTrack(track.id, { locked: event.target.checked })} /><span>{translate('잠금', 'Locked')}</span></label>
            <button className="iconbtn iconbtn--sm" aria-label={translate('자막 트랙 삭제', 'Delete caption track')} title={translate('자막 트랙 삭제', 'Delete caption track')} onClick={() => {
              if (confirm(translate(`'${track.name}' 트랙과 자막 ${track.cues.length}개를 삭제할까요?`, `Delete '${track.name}' and its ${track.cues.length} captions?`))) removeTrack(track.id)
            }}><Icon name="trash" /></button>
          </div>

          <div className="caption-list" aria-label={translate('자막 목록', 'Caption list')}>
            {cues.length ? cues.map((cue, index) => {
              const selected = selection?.type === 'caption' && selection.id === cue.id
              return (
                <article key={cue.id} className={`caption-row${selected ? ' caption-row--selected' : ''}`} onClick={() => select({ type: 'caption', id: cue.id })}>
                  <button className="caption-row__index" onClick={(event) => { event.stopPropagation(); select({ type: 'caption', id: cue.id }); setPlayhead(cue.start) }}
                    title={translate('이 자막 시작으로 이동', 'Jump to this caption')}>
                    <b>{index + 1}</b><span>{formatTimeFine(cue.start)}</span>
                  </button>
                  <textarea rows={2} value={cue.text} disabled={track.locked} aria-label={translate(`${index + 1}번 자막`, `Caption ${index + 1}`)}
                    onFocus={() => select({ type: 'caption', id: cue.id })} onChange={(event) => updateCue(track.id, cue.id, { text: event.target.value })} />
                  <div className="caption-row__timing">
                    <label><span>{translate('시작', 'Start')}</span><input type="text" value={formatClock(cue.start)} readOnly /></label>
                    <label><span>{translate('종료', 'End')}</span><input type="text" value={formatClock(cue.end)} readOnly /></label>
                  </div>
                  <button className="iconbtn iconbtn--sm" disabled={track.locked} aria-label={translate(`${index + 1}번 자막 삭제`, `Delete caption ${index + 1}`)}
                    onClick={(event) => { event.stopPropagation(); removeCue(track.id, cue.id) }}><Icon name="trash" /></button>
                </article>
              )
            }) : <div className="caption-list__empty"><Icon name="comment" /><b>{translate('아직 자막이 없습니다.', 'No captions yet.')}</b><span>{translate('재생 헤드를 원하는 위치에 놓고 자막을 추가하세요.', 'Place the playhead, then add a caption.')}</span><button className="btn btn--primary" onClick={createCue}>{translate('첫 자막 추가', 'Add first caption')}</button></div>}
          </div>
        </> : <div className="caption-list__empty"><Icon name="comment" /><b>{translate('자막 트랙을 만들어 시작하세요.', 'Create a caption track to begin.')}</b><button className="btn btn--primary" onClick={createTrack}>{translate('자막 트랙 만들기', 'Create caption track')}</button></div>}
      </div>
    </div>
  )
}
