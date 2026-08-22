import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from '../store'
import { useLanguage } from '../i18n'
import { formatTimeFine } from '../utils/time'
import { saveBlob } from '../utils/io'
import { parseSubtitles, serializeSrt } from '../utils/subtitles'
import { TEXT_STYLE_OPTIONS, type TextStylePreset } from '../utils/text-style'
import Icon from './Icon'

interface Props {
  projectName: string | null
  onClose: () => void
  onImported: () => void
}

const SAMPLE = `1\n00:00:00,000 --> 00:00:02,500\n첫 번째 자막\n\n2\n00:00:02,500 --> 00:00:05,000\n두 번째 자막`

function safeName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'simplecut'
}

export default function CaptionDialog({ projectName, onClose, onImported }: Props) {
  const { language, t } = useLanguage()
  const texts = useEditor((state) => state.texts)
  const playhead = useEditor((state) => state.playhead)
  const addCaptions = useEditor((state) => state.addCaptions)
  const [source, setSource] = useState('')
  const [sourceName, setSourceName] = useState('')
  const [fromPlayhead, setFromPlayhead] = useState(false)
  const [replace, setReplace] = useState(false)
  const [style, setStyle] = useState<TextStylePreset>('caption')
  const [status, setStatus] = useState<'idle' | 'reading' | 'exporting' | 'error'>('idle')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const cues = useMemo(() => parseSubtitles(source), [source])
  const captionCount = texts.filter((item) => item.role === 'caption').length

  useEffect(() => { closeRef.current?.focus() }, [])

  const openFile = async (file?: File) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      setError(t('자막 파일은 2MB 이하만 열 수 있습니다.', 'Subtitle files must be 2MB or smaller.'))
      setStatus('error')
      return
    }
    setStatus('reading')
    setError('')
    try {
      setSource(await file.text())
      setSourceName(file.name)
      setStatus('idle')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('자막 파일을 읽지 못했습니다.', 'Could not read the subtitle file.'))
      setStatus('error')
    }
  }

  const apply = () => {
    if (!cues.length) return
    addCaptions(cues, { offset: fromPlayhead ? playhead : 0, replace, style })
    onImported()
  }

  const exportCaptions = async () => {
    const srt = serializeSrt(texts)
    if (!srt) return
    setStatus('exporting')
    setError('')
    try {
      await saveBlob(new Blob([srt], { type: 'application/x-subrip;charset=utf-8' }), `${safeName(projectName || 'simplecut')}-subtitles.srt`)
      setStatus('idle')
    } catch (reason) {
      if ((reason as DOMException)?.name === 'AbortError') { setStatus('idle'); return }
      setError(reason instanceof Error ? reason.message : t('자막 저장에 실패했습니다.', 'Could not save subtitles.'))
      setStatus('error')
    }
  }

  return (
    <div className="modal caption-dialog" onClick={onClose}>
      <section className="modal__panel caption-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="caption-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal__head">
          <div>
            <h2 id="caption-title">{t('자막 가져오기·내보내기', 'Import and export subtitles')}</h2>
            <p className="caption-dialog__lead">{t('SRT·WebVTT 타임코드를 편집 가능한 자막 레이어로 바꿉니다.', 'Turn SRT or WebVTT timecodes into editable caption layers.')}</p>
          </div>
          <button ref={closeRef} className="iconbtn" onClick={onClose} aria-label={t('자막 창 닫기', 'Close subtitle dialog')}><Icon name="close" /></button>
        </div>

        <div className="caption-dialog__import-row">
          <button className="btn" type="button" onClick={() => fileRef.current?.click()}><Icon name="upload" />{t('SRT·VTT 파일 선택', 'Choose SRT or VTT')}</button>
          <span>{sourceName || t('선택한 파일 없음', 'No file selected')}</span>
          <input ref={fileRef} hidden type="file" accept=".srt,.vtt,text/vtt,application/x-subrip,text/plain" onChange={(event) => { void openFile(event.target.files?.[0]); event.target.value = '' }} />
        </div>

        <label className="modal__field">
          <span>{t('자막 내용', 'Subtitle content')}</span>
          <textarea className="textarea caption-dialog__source" value={source} rows={8} placeholder={SAMPLE} onChange={(event) => { setSource(event.target.value); setSourceName(''); setStatus('idle'); setError('') }} />
        </label>

        <div className={`caption-dialog__summary${source && !cues.length ? ' is-error' : ''}`} role="status">
          {source ? (cues.length
            ? t(`${cues.length}개 자막 · ${formatTimeFine(cues[0].start)}–${formatTimeFine(cues[cues.length - 1].end)}`, `${cues.length} captions · ${formatTimeFine(cues[0].start)}–${formatTimeFine(cues[cues.length - 1].end)}`)
            : t('읽을 수 있는 타임코드가 없습니다. SRT 또는 WebVTT 형식을 확인하세요.', 'No valid timecodes found. Check the SRT or WebVTT format.'))
            : t('파일을 선택하거나 자막 내용을 붙여 넣으세요.', 'Choose a file or paste subtitle content.')}
        </div>

        <fieldset className="caption-dialog__fieldset">
          <legend>{t('자막 스타일', 'Caption style')}</legend>
          <div className="caption-dialog__styles" role="radiogroup">
            {TEXT_STYLE_OPTIONS.filter((option) => ['caption', 'clean', 'yellow', 'strawberry'].includes(option.value)).map((option) => (
              <button key={option.value} type="button" role="radio" aria-checked={style === option.value} className={style === option.value ? 'is-active' : ''} onClick={() => setStyle(option.value)}>
                <span style={{ color: option.patch.color, background: option.patch.box ? option.patch.boxColor : 'transparent' }}>가Aa</span>
                <small>{language === 'ko' ? option.label : option.labelEn}</small>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="caption-dialog__options">
          <label className="switch"><input type="checkbox" checked={fromPlayhead} onChange={(event) => setFromPlayhead(event.target.checked)} /><span>{t(`현재 위치(${formatTimeFine(playhead)})부터 시작`, `Start at playhead (${formatTimeFine(playhead)})`)}</span></label>
          <label className="switch"><input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} /><span>{t('기존에 가져온 자막 교체', 'Replace previously imported captions')}</span></label>
        </div>

        <div className="modal__note">{t('가져온 뒤에는 타임라인에서 각 문장의 길이·위치를 조절하고 오른쪽 패널에서 내용과 글꼴을 바꿀 수 있습니다. 일반 제목 텍스트는 교체·SRT 내보내기 대상에 포함되지 않습니다.', 'After import, adjust each cue on the timeline and edit its content and font in the inspector. Ordinary title text is never replaced or included in SRT export.')}</div>
        {error && <div className="modal__error"><Icon name="warning" />{error}</div>}

        <div className="caption-dialog__actions">
          <button className="btn" type="button" disabled={!captionCount || status === 'exporting'} onClick={() => void exportCaptions()}><Icon name="download" />{status === 'exporting' ? t('저장 중…', 'Saving…') : t(`기존 자막 ${captionCount}개 SRT 저장`, `Save ${captionCount} captions as SRT`)}</button>
          <span />
          <button className="btn" type="button" onClick={onClose}>{t('취소', 'Cancel')}</button>
          <button className="btn btn--primary" type="button" disabled={!cues.length || status === 'reading'} onClick={apply}>{t(`${cues.length}개 가져오기`, `Import ${cues.length}`)}</button>
        </div>
      </section>
    </div>
  )
}

