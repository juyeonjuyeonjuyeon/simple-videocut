import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useEditor } from '../store'
import type { Clip, TextOverlay, Overlay, AudioClip, Background, Crop, PositionKeyframe, KeyframeEasing, OverlayBorderStyle, OverlayMaskShape, CaptionCue, CaptionTrack } from '../types'
import { NO_CROP } from '../types'
import { formatTime, formatClock, parseClock, clipTimelineDuration, overlayLength, audioLength, totalDuration, exactDurationPatch } from '../utils/time'
import { rotateBy } from '../utils/transform'
import Icon from './Icon'
import { keyframeAt, positionAt } from '../utils/motion'
import { normalizeVisualOrder } from '../utils/layers'
import FontPicker from './FontPicker'
import { maskPathData, OVERLAY_STYLE_DEFAULTS, resolveOverlayStyle } from '../utils/overlay-style'
import { resolveShapeStyle, SHAPE_OPTIONS, SHAPE_STYLE_DEFAULTS } from '../utils/shape'
import ShapeIcon from './ShapeIcon'
import { translate, useLanguage } from '../i18n'
import { DEFAULT_BACKGROUND_REMOVAL_SENSITIVITY } from '../utils/background-removal'

type Patch = Partial<Pick<Clip & Overlay,
  'rotate' | 'flipH' | 'flipV' | 'crop' | 'speed' | 'volume' | 'muted' | 'repeat' |
  'timelineDuration' | 'fadeIn' | 'fadeOut' | 'opacity' | 'locked' | 'hidden' | 'scaleY' | 'aspectLocked' |
  'canvasX' | 'canvasY' | 'canvasScale' | 'canvasScaleY' | 'canvasAspectLocked' | 'canvasAngle' |
  'backgroundRemovalEnabled' | 'backgroundRemovalSensitivity' |
  'borderWidth' | 'borderColor' | 'borderStyle' | 'shadowEnabled' | 'shadowColor' | 'shadowOpacity' |
  'shadowBlur' | 'shadowX' | 'shadowY' | 'maskShape'>>

type InspectorTab = 'basic' | 'transform' | 'style' | 'time' | 'audio'
interface InspectorTabOption { id: InspectorTab; label: string }

function InspectorTabs({ tabs, active, onChange }: {
  tabs: InspectorTabOption[]; active: InspectorTab; onChange: (tab: InspectorTab) => void
}) {
  return (
    <div className="inspector-tabs" role="tablist" aria-label={translate('속성 종류', 'Property categories')}>
      {tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" aria-selected={active === tab.id}
          className={active === tab.id ? 'is-active' : ''} onClick={() => onChange(tab.id)}>{tab.label}</button>
      ))}
    </div>
  )
}

function InspectorBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="inspector-block">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

const decimalsOf = (step: number) => {
  const s = String(step)
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

// Unified value control: slider + numeric input + −/＋ steppers, all editing one value.
function Range({ label, badge, value, min, max, step, unit = '', disabled, onChange }: {
  label: string; badge?: ReactNode; value: number; min: number; max: number; step: number
  unit?: string; disabled?: boolean; onChange: (v: number) => void
}) {
  const dec = decimalsOf(step)
  const fmt = (v: number) => Number(v.toFixed(dec))
  const clamp = (v: number) => Math.max(min, Math.min(max, v))
  const set = (v: number) => { if (Number.isFinite(v)) onChange(clamp(fmt(v))) }
  return (
    <div className={`ctl${disabled ? ' ctl--off' : ''}`}>
      <div className="ctl__label"><span>{label}</span>{badge != null && <b>{badge}</b>}</div>
      <div className="ctl__row">
        <input className="ctl__range" type="range" min={min} max={max} step={step} value={value} disabled={disabled}
          onChange={(e) => set(Number(e.target.value))} />
        <div className="stepper">
          <button type="button" className="step" disabled={disabled} onClick={() => set(value - step)} aria-label={translate('감소', 'Decrease')}>−</button>
          <input className="num num--step" type="number" min={min} max={max} step={step} value={fmt(value)} disabled={disabled}
            onChange={(e) => set(Number(e.target.value))} />
          <button type="button" className="step" disabled={disabled} onClick={() => set(value + step)} aria-label={translate('증가', 'Increase')}>＋</button>
        </div>
        {unit && <span className="unit">{unit}</span>}
      </div>
    </div>
  )
}

function BackgroundRemovalRow({ enabled, sensitivity, onPatch }: {
  enabled?: boolean
  sensitivity?: number
  onPatch: (patch: Patch) => void
}) {
  const value = sensitivity ?? DEFAULT_BACKGROUND_REMOVAL_SENSITIVITY
  return (
    <div className="inspector__group background-removal-control">
      <button type="button" className={`btn${enabled ? ' btn--on' : ' btn--primary'}`}
        aria-pressed={Boolean(enabled)}
        onClick={() => onPatch(enabled
          ? { backgroundRemovalEnabled: false }
          : { backgroundRemovalEnabled: true, backgroundRemovalSensitivity: value })}>
        <Icon name="removeBackground" />
        {enabled ? translate('배경 제거 해제', 'Restore background') : translate('배경 자동 제거', 'Remove background')}
      </button>
      {enabled && <Range label={translate('민감도', 'Sensitivity')} value={value} min={0} max={100} step={1} unit="%"
        onChange={(backgroundRemovalSensitivity) => onPatch({ backgroundRemovalSensitivity })} />}
      <div className="inspector__hint">{enabled
        ? translate('민감도를 높이면 가장자리와 비슷한 색을 더 넓게 제거합니다. 원본 파일은 변경되지 않습니다.', 'Higher sensitivity removes a wider range of edge-like colours. The source file is unchanged.')
        : translate('이미지 가장자리의 배경색을 자동 감지해 투명하게 만듭니다.', 'Automatically detects edge background colours and makes them transparent.')}</div>
    </div>
  )
}

// Open-ended numeric control (no slider): −/＋ steppers + numeric input.
function Stepper({ label, badge, value, min = 0, max = Infinity, step, unit, fixed = 2, onChange, extra }: {
  label: string; badge?: ReactNode; value: number; min?: number; max?: number; step: number
  unit?: string; fixed?: number; onChange: (v: number) => void; extra?: ReactNode
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v))
  const set = (v: number) => { if (Number.isFinite(v)) onChange(clamp(v)) }
  return (
    <div className="ctl">
      <div className="ctl__label"><span>{label}</span>{badge != null && <b>{badge}</b>}</div>
      <div className="ctl__row">
        <div className="stepper">
          <button type="button" className="step" onClick={() => set(value - step)} aria-label={translate('감소', 'Decrease')}>−</button>
          <input className="num num--step" type="number" min={min} step={step} value={Number(value.toFixed(fixed))}
            onChange={(e) => set(Number(e.target.value))} />
          <button type="button" className="step" onClick={() => set(value + step)} aria-label={translate('증가', 'Increase')}>＋</button>
        </div>
        {unit && <span className="unit">{unit}</span>}
        {extra}
      </div>
    </div>
  )
}

// Editable timecode field showing [H:]MM:SS.ss; commits on blur / Enter.
function TimeField({ seconds, onChange }: { seconds: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft == null) return
    const v = parseClock(draft)
    if (isFinite(v)) onChange(v)
    setDraft(null)
  }
  return (
    <input
      className="num num--time"
      value={draft ?? formatClock(seconds)}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') setDraft(null) }}
    />
  )
}

// Duration control: timecode field (hh:mm:ss.ss) flanked by −/＋ steppers.
function DurationRow({ seconds, onSet }: { seconds: number; onSet: (target: number) => void }) {
  return (
    <div className="ctl">
      <div className="ctl__label"><span>{translate('시간 길이', 'Duration')}</span><b>{formatTime(seconds)}</b></div>
      <div className="ctl__row">
        <div className="stepper">
          <button type="button" className="step" onClick={() => onSet(Math.max(0.1, seconds - 1))} aria-label={translate('감소', 'Decrease')}>−</button>
          <TimeField seconds={seconds} onChange={(v) => onSet(Math.max(0.1, v))} />
          <button type="button" className="step" onClick={() => onSet(seconds + 1)} aria-label={translate('증가', 'Increase')}>＋</button>
        </div>
        <span className="unit">{translate('시:분:초', 'h:m:s')}</span>
      </div>
    </div>
  )
}

// Standard text-alignment glyphs drawn as stacked bars.
const ALIGN_ROWS = [1, 0.62, 0.85, 0.5]
function AlignIcon({ a }: { a: TextOverlay['align'] }) {
  const W = 16, pad = 2.5, maxW = W - pad * 2
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {ALIGN_ROWS.map((w, i) => {
        const lw = a === 'justify' ? maxW : maxW * w
        const y = 3 + i * 3.1
        const x = a === 'center' ? (W - lw) / 2 : a === 'right' ? W - pad - lw : pad
        return <rect key={i} x={x} y={y} width={lw} height={1.7} rx={0.85} fill="currentColor" />
      })}
    </svg>
  )
}

const MASK_OPTIONS: Array<{ value: OverlayMaskShape; label: string; labelEn: string }> = [
  { value: 'none', label: '사각형', labelEn: 'Rectangle' },
  { value: 'rounded', label: '둥근 사각형', labelEn: 'Rounded' },
  { value: 'circle', label: '원', labelEn: 'Circle' },
  { value: 'ellipse', label: '타원', labelEn: 'Ellipse' },
  { value: 'heart', label: '하트', labelEn: 'Heart' },
  { value: 'star', label: '별', labelEn: 'Star' },
  { value: 'hexagon', label: '육각형', labelEn: 'Hexagon' },
]

function MaskIcon({ shape }: { shape: OverlayMaskShape }) {
  return (
    <svg viewBox="0 0 36 28" aria-hidden="true" focusable="false">
      <path d={maskPathData(shape, 34, 26, 1)} />
    </svg>
  )
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="style-color">
      <span>{label}</span>
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
      <code>{value.toUpperCase()}</code>
    </label>
  )
}

function RepeatRow({ repeat, onPatch }: { repeat: number; onPatch: (p: { repeat: number }) => void }) {
  return (
    <Stepper label={translate('반복 늘이기', 'Repeat')} badge={`×${repeat}`} value={repeat} min={1} max={99} step={1} fixed={0}
      onChange={(v) => onPatch({ repeat: Math.round(v) })} />
  )
}

function NameField({ icon, name, onChange }: { icon: ReactNode; name: string; onChange: (v: string) => void }) {
  return (
    <div className="namefield">
      <span className="namefield__icon">{icon}</span>
      <input className="namefield__input" value={name} spellCheck={false}
        onChange={(e) => onChange(e.target.value)} aria-label={translate('이름', 'Name')} />
    </div>
  )
}

// ---- shared control rows ----
function TransformRow({ rotate, flipH, flipV, onPatch }: { rotate: 0 | 90 | 180 | 270; flipH: boolean; flipV: boolean; onPatch: (p: Patch) => void }) {
  return (
    <div className="inspector__group">
      <div className="field__label"><span>{translate('회전 · 반전', 'Rotate · Flip')}</span><b>{rotate}°</b></div>
      <div className="btnrow">
        <button className="btn btn--sm" onClick={() => onPatch({ rotate: rotateBy(rotate, 90) })}><Icon name="rotate" />90°</button>
        <button className={`btn btn--sm${flipH ? ' btn--on' : ''}`} onClick={() => onPatch({ flipH: !flipH })}><Icon name="flipH" />{translate('좌우', 'Horizontal')}</button>
        <button className={`btn btn--sm${flipV ? ' btn--on' : ''}`} onClick={() => onPatch({ flipV: !flipV })}><Icon name="flipV" />{translate('상하', 'Vertical')}</button>
      </div>
    </div>
  )
}

function CropRow({ crop, onPatch, onOpen }: { crop: Crop; onPatch: (p: Patch) => void; onOpen: () => void }) {
  const cropped = crop.top || crop.right || crop.bottom || crop.left
  const kept = Math.round((1 - crop.left - crop.right) * (1 - crop.top - crop.bottom) * 100)
  return (
    <div className="inspector__group">
      <div className="field__label">
        <span>{translate('자르기 (크롭)', 'Crop')}</span>
        {cropped ? <button className="linkbtn" onClick={() => onPatch({ crop: NO_CROP })}>{translate('초기화', 'Reset')}</button> : null}
      </div>
      <div className="inspector__hint">{cropped ? translate(`원본의 약 ${kept}% 영역을 사용 중입니다.`, `Using about ${kept}% of the original.`) : translate('현재 원본 전체를 사용 중입니다.', 'Using the full original.')}</div>
      <button className="btn btn--primary" onClick={onOpen}><Icon name="crop" />{translate('자르기 편집창 열기', 'Open crop editor')}</button>
    </div>
  )
}

function SpeedRow({ speed, onPatch }: { speed: number; onPatch: (p: Patch) => void }) {
  return (
    <div className="inspector__group">
      <Range label={translate('재생 속도', 'Playback speed')} value={speed} min={0.1} max={4} step={0.1} unit="×" onChange={(v) => onPatch({ speed: v })} />
    </div>
  )
}

function VolumeRow({ volume, muted, onPatch, label }: { volume: number; muted: boolean; onPatch: (p: Patch) => void; label?: string }) {
  const resolvedLabel = label ?? translate('음량', 'Volume')
  return (
    <div className="inspector__group">
      <Range label={`${resolvedLabel}${volume > 1 && !muted ? translate(' (증폭)', ' (boost)') : ''}`} value={Math.round(volume * 100)} min={0} max={200} step={1} unit="%"
        disabled={muted} onChange={(v) => onPatch({ volume: v / 100 })} />
      <label className="switch">
        <input type="checkbox" checked={muted} onChange={(e) => onPatch({ muted: e.target.checked })} />
        <span>{translate('음소거', 'Mute')}</span>
      </label>
    </div>
  )
}

function FadeRow({ length, fadeIn = 0, fadeOut = 0, onPatch, label }: {
  length: number; fadeIn?: number; fadeOut?: number; onPatch: (p: Patch) => void; label?: string
}) {
  const max = Math.max(0.1, Math.min(10, length / 2))
  const resolvedLabel = label ?? translate('페이드', 'Fade')
  return (
    <div className="inspector__group">
      <div className="field__label"><span>{resolvedLabel}</span><b>{fadeIn || fadeOut ? translate('적용됨', 'Applied') : translate('없음', 'None')}</b></div>
      <Range label={translate('시작', 'In')} value={fadeIn} min={0} max={max} step={0.1} unit={translate('초', 's')} onChange={(value) => onPatch({ fadeIn: value })} />
      <Range label={translate('끝', 'Out')} value={fadeOut} min={0} max={max} step={0.1} unit={translate('초', 's')} onChange={(value) => onPatch({ fadeOut: value })} />
    </div>
  )
}

function LayerStateRow({ opacity = 1, locked = false, hidden = false, onPatch, onCenter }: {
  opacity?: number; locked?: boolean; hidden?: boolean; onPatch: (p: Patch) => void
  onCenter?: (axis: 'x' | 'y' | 'both') => void
}) {
  return (
    <div className="inspector__group">
      <Range label={translate('레이어 불투명도', 'Layer opacity')} value={Math.round(opacity * 100)} min={0} max={100} step={1} unit="%"
        onChange={(value) => onPatch({ opacity: value / 100 })} />
      <div className="btnrow">
        <button className={`btn btn--sm${locked ? ' btn--on' : ''}`} onClick={() => onPatch({ locked: !locked })}>{locked ? translate('잠금 해제', 'Unlock') : translate('레이어 잠금', 'Lock layer')}</button>
        <button className={`btn btn--sm${hidden ? ' btn--on' : ''}`} onClick={() => onPatch({ hidden: !hidden })}>{hidden ? translate('표시', 'Show') : translate('숨기기', 'Hide')}</button>
      </div>
      {onCenter && <div className="btnrow">
        <button className="btn btn--sm" onClick={() => onCenter('x')}>{translate('가로 중앙', 'Center horizontally')}</button>
        <button className="btn btn--sm" onClick={() => onCenter('y')}>{translate('세로 중앙', 'Center vertically')}</button>
        <button className="btn btn--sm" onClick={() => onCenter('both')}>{translate('정중앙', 'Center')}</button>
      </div>}
    </div>
  )
}

function PositionKeyframeRow({ frames = [], localTime, onToggle, onClear, onSeek, onEasing }: {
  frames?: PositionKeyframe[]; localTime: number; onToggle: () => void; onClear: () => void
  onSeek: (frame: PositionKeyframe) => void
  onEasing: (id: string, easing: KeyframeEasing) => void
}) {
  const ordered = [...frames].sort((a, b) => a.time - b.time)
  const active = keyframeAt(ordered, localTime)
  const previous = [...ordered].reverse().find((frame) => frame.time < localTime - 0.04)
  const next = ordered.find((frame) => frame.time > localTime + 0.04)
  return (
    <div className="inspector__group keyframes">
      <div className="field__label">
        <span>{translate('위치 키프레임', 'Position keyframes')}</span>
        <b>{ordered.length ? translate(`${ordered.length}개`, `${ordered.length}`) : translate('없음', 'None')}</b>
      </div>
      <div className="keyframes__controls">
        <button className="btn btn--sm" disabled={!previous} onClick={() => previous && onSeek(previous)} aria-label={translate('이전 키프레임', 'Previous keyframe')}>←</button>
        <button className={`btn btn--sm keyframes__toggle${active ? ' btn--on' : ''}`} onClick={onToggle}
          title={active ? translate('현재 키프레임 삭제', 'Delete current keyframe') : translate('현재 위치에 키프레임 추가', 'Add keyframe here')}>
          <span className="keyframes__diamond" />{active ? translate('현재 점 삭제', 'Delete current') : translate('현재 점 추가', 'Add current')}
        </button>
        <button className="btn btn--sm" disabled={!next} onClick={() => next && onSeek(next)} aria-label={translate('다음 키프레임', 'Next keyframe')}>→</button>
      </div>
      {active && (
        <label className="keyframes__easing">
          <span>{translate('다음 점까지 움직임', 'Motion to next point')}</span>
          <select value={active.easing} onChange={(event) => onEasing(active.id, event.target.value as KeyframeEasing)}>
            <option value="ease-in-out">{translate('부드럽게', 'Smooth')}</option>
            <option value="linear">{translate('일정하게', 'Linear')}</option>
          </select>
        </label>
      )}
      {ordered.length > 0 && <button className="linkbtn keyframes__clear" onClick={onClear}>{translate('위치 움직임 모두 지우기', 'Clear all position motion')}</button>}
      <div className="inspector__hint">{translate('첫 점을 추가한 뒤 재생 헤드를 옮겨 화면에서 레이어를 움직이면 다음 점이 자동으로 생깁니다.', 'Add the first point, move the playhead, then drag the layer in the preview to create the next point automatically.')}</div>
    </div>
  )
}

// ---- main clip ----
function ClipInspector({ clip, tab, onOpenCrop }: { clip: Clip; tab: InspectorTab; onOpenCrop: () => void }) {
  const update = useEditor((s) => s.updateClip)
  const move = useEditor((s) => s.moveClip)
  const remove = useEditor((s) => s.removeClip)
  const toOverlay = useEditor((s) => s.moveClipToOverlay)
  const toBackground = useEditor((s) => s.moveClipToBackground)
  const clips = useEditor((s) => s.clips)
  const idx = clips.findIndex((c) => c.id === clip.id)
  const patch = (p: Patch) => update(clip.id, p)
  const icon = <Icon name={clip.kind === 'color' ? 'palette' : clip.kind === 'image' ? 'image' : 'video'} />

  if (clip.kind === 'color') {
    return (
      <div className="inspector__body">
        {tab === 'basic' && <>
          <InspectorBlock title={translate('기본 정보', 'Basic info')}>
            <div className="inspector__group">
              <NameField icon={icon} name={clip.name} onChange={(v) => update(clip.id, { name: v })} />
              <div className="inspector__hint">{translate('단색 배경', 'Solid background')} · {translate('길이', 'Duration')} {formatTime(clipTimelineDuration(clip))}</div>
            </div>
          </InspectorBlock>
          <InspectorBlock title={translate('색상', 'Color')}>
            <div className="inspector__group inspector__row">
              <label className="field__label"><span>{translate('배경 색상', 'Background color')}</span></label>
              <input type="color" value={clip.bgColor ?? '#000000'} onChange={(e) => update(clip.id, { bgColor: e.target.value })} />
            </div>
          </InspectorBlock>
          <InspectorBlock title={translate('트랙 위치', 'Track position')}>
            <div className="inspector__group btnrow">
              <button className="btn" disabled={idx <= 0} onClick={() => move(clip.id, -1)}>← {translate('앞으로', 'Earlier')}</button>
              <button className="btn" disabled={idx >= clips.length - 1} onClick={() => move(clip.id, 1)}>{translate('뒤로', 'Later')} →</button>
            </div>
          </InspectorBlock>
          <button className="btn btn--danger" onClick={() => remove(clip.id)}>{translate('배경 삭제', 'Delete background')}</button>
        </>}
        {tab === 'time' && <>
          <InspectorBlock title={translate('길이', 'Duration')}>
            <div className="inspector__group">
              <Range label={translate('길이', 'Duration')} badge={formatTime(clip.trimEnd)} value={Math.min(clip.trimEnd, 60)} min={0.5} max={60} step={0.5} unit={translate('초', 's')}
                onChange={(v) => update(clip.id, { trimEnd: v })} />
            </div>
          </InspectorBlock>
          <InspectorBlock title={translate('시작과 끝', 'Start and end')}><FadeRow length={clipTimelineDuration(clip)} fadeIn={clip.fadeIn} fadeOut={clip.fadeOut} onPatch={patch} label={translate('화면 페이드', 'Visual fade')} /></InspectorBlock>
          <InspectorBlock title={translate('반복', 'Repeat')}><RepeatRow repeat={clip.repeat} onPatch={patch} /></InspectorBlock>
        </>}
      </div>
    )
  }

  return (
    <div className="inspector__body">
      {tab === 'basic' && <>
        <InspectorBlock title={translate('기본 정보', 'Basic info')}>
          <div className="inspector__group">
            <NameField icon={icon} name={clip.name} onChange={(v) => update(clip.id, { name: v })} />
            <div className="inspector__hint">{translate('길이', 'Duration')} {formatTime(clipTimelineDuration(clip))} · {translate('원본', 'Source')} {formatTime(clip.duration)}</div>
          </div>
        </InspectorBlock>
        <InspectorBlock title={translate('트랙 위치', 'Track position')}>
          <div className="inspector__group btnrow">
            <button className="btn" disabled={idx <= 0} onClick={() => move(clip.id, -1)}>← {translate('앞으로', 'Earlier')}</button>
            <button className="btn" disabled={idx >= clips.length - 1} onClick={() => move(clip.id, 1)}>{translate('뒤로', 'Later')} →</button>
          </div>
          <button className="btn" onClick={() => toOverlay(clip.id)}><Icon name="layers" />{translate('오버레이 레이어로 이동', 'Move to overlay layer')}</button>
          <button className="btn" onClick={() => toBackground(clip.id)}><Icon name="palette" />{translate('배경 레이어로 이동', 'Move to background layer')}</button>
        </InspectorBlock>
        <button className="btn btn--danger" onClick={() => remove(clip.id)}>{translate('클립 삭제', 'Delete clip')}</button>
      </>}
      {tab === 'transform' && <>
        <InspectorBlock title={translate('캔버스 위치와 크기', 'Canvas position and size')}>
          <div className="inspector__group">
            <Range label={translate('가로 위치', 'Horizontal position')} value={Math.round((clip.canvasX ?? 0.5) * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => update(clip.id, { canvasX: v / 100 })} />
            <Range label={translate('세로 위치', 'Vertical position')} value={Math.round((clip.canvasY ?? 0.5) * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => update(clip.id, { canvasY: v / 100 })} />
            <Range label={translate('크기', 'Size')} value={Math.round((clip.canvasScale ?? 1) * 100)} min={5} max={300} step={1} unit="%" onChange={(v) => update(clip.id, { canvasScale: v / 100 })} />
            {!(clip.canvasAspectLocked ?? true) && <Range label={translate('세로 크기', 'Height')} value={Math.round((clip.canvasScaleY ?? clip.canvasScale ?? 1) * 100)} min={5} max={300} step={1} unit="%" onChange={(v) => update(clip.id, { canvasScaleY: v / 100 })} />}
            <Range label={translate('자유 회전', 'Free rotation')} value={clip.canvasAngle ?? 0} min={-180} max={180} step={1} unit="°" onChange={(v) => update(clip.id, { canvasAngle: v })} />
            <button className={`btn btn--sm${clip.canvasAspectLocked ?? true ? ' btn--on' : ''}`} onClick={() => update(clip.id, clip.canvasAspectLocked ?? true
              ? { canvasAspectLocked: false, canvasScaleY: clip.canvasScale ?? 1 }
              : { canvasAspectLocked: true, canvasScaleY: undefined })}>
              <Icon name={clip.canvasAspectLocked ?? true ? 'lock' : 'unlock'} />{translate('비율', 'Aspect')} {clip.canvasAspectLocked ?? true ? translate('고정', 'Locked') : translate('자유', 'Free')}
            </button>
            <div className="btnrow">
              <button className="btn btn--sm" onClick={() => update(clip.id, { canvasX: 0.5, canvasY: 0.5 })}>{translate('정중앙', 'Center')}</button>
              <button className="btn btn--sm" onClick={() => update(clip.id, { canvasX: 0.5, canvasY: 0.5, canvasScale: 1, canvasScaleY: undefined, canvasAspectLocked: true, canvasAngle: 0 })}>{translate('캔버스에 맞춤', 'Fit to canvas')}</button>
            </div>
            <div className="inspector__hint">{translate('미리보기에서도 직접 이동·크기·회전을 조절할 수 있습니다.', 'You can also move, resize, and rotate directly in the preview.')}</div>
          </div>
        </InspectorBlock>
        <InspectorBlock title={translate('회전과 반전', 'Rotate and flip')}><TransformRow rotate={clip.rotate} flipH={clip.flipH} flipV={clip.flipV} onPatch={patch} /></InspectorBlock>
        <InspectorBlock title={translate('자르기', 'Crop')}><CropRow crop={clip.crop} onPatch={patch} onOpen={onOpenCrop} /></InspectorBlock>
      </>}
      {tab === 'style' && clip.kind === 'image' && <InspectorBlock title={translate('배경 제거', 'Remove background')}>
        <BackgroundRemovalRow enabled={clip.backgroundRemovalEnabled} sensitivity={clip.backgroundRemovalSensitivity} onPatch={patch} />
      </InspectorBlock>}
      {tab === 'time' && <>
        <InspectorBlock title={translate('트림', 'Trim')}>
          <div className="inspector__group">
            <Range label={translate('시작 트림', 'Trim start')} badge={formatTime(clip.trimStart)} value={clip.trimStart} min={0} max={clip.duration} step={0.1} unit={translate('초', 's')}
              onChange={(v) => update(clip.id, { trimStart: Math.min(v, clip.trimEnd - 0.1) })} />
            <Range label={translate('끝 트림', 'Trim end')} badge={formatTime(clip.trimEnd)} value={clip.trimEnd} min={0} max={clip.duration} step={0.1} unit={translate('초', 's')}
              onChange={(v) => update(clip.id, { trimEnd: Math.max(v, clip.trimStart + 0.1) })} />
          </div>
        </InspectorBlock>
        {clip.kind === 'video' && <InspectorBlock title={translate('속도', 'Speed')}><SpeedRow speed={clip.speed} onPatch={patch} /></InspectorBlock>}
        <InspectorBlock title={translate('페이드', 'Fade')}><FadeRow length={clipTimelineDuration(clip)} fadeIn={clip.fadeIn} fadeOut={clip.fadeOut} onPatch={patch} label={translate('화면·소리 페이드', 'Video and audio fade')} /></InspectorBlock>
        <InspectorBlock title={translate('길이와 반복', 'Duration and repeat')}>
          <RepeatRow repeat={clip.repeat} onPatch={patch} />
          <DurationRow seconds={clipTimelineDuration(clip)} onSet={(t) => update(clip.id, exactDurationPatch((clip.trimEnd - clip.trimStart) / clip.speed, t))} />
        </InspectorBlock>
      </>}
      {tab === 'audio' && clip.kind === 'video' && <InspectorBlock title={translate('클립 오디오', 'Clip audio')}><VolumeRow volume={clip.volume} muted={clip.muted} onPatch={patch} /></InspectorBlock>}
    </div>
  )
}

// ---- overlay ----
function OverlayInspector({ ov, tab, onOpenCrop }: { ov: Overlay; tab: InspectorTab; onOpenCrop: () => void }) {
  const update = useEditor((s) => s.updateOverlay)
  const updatePosition = useEditor((s) => s.updateLayerPosition)
  const togglePositionKeyframe = useEditor((s) => s.togglePositionKeyframe)
  const clearPositionKeyframes = useEditor((s) => s.clearPositionKeyframes)
  const setPositionKeyframeEasing = useEditor((s) => s.setPositionKeyframeEasing)
  const setPlayhead = useEditor((s) => s.setPlayhead)
  const playhead = useEditor((s) => s.playhead)
  const raise = useEditor((s) => s.raiseOverlay)
  const remove = useEditor((s) => s.removeOverlay)
  const toMain = useEditor((s) => s.moveOverlayToMain)
  const overlays = useEditor((s) => s.overlays)
  const texts = useEditor((s) => s.texts)
  const storedVisualOrder = useEditor((s) => s.visualOrder)
  const visualOrder = normalizeVisualOrder(overlays, texts, storedVisualOrder)
  const idx = visualOrder.findIndex((item) => item.type === 'overlay' && item.id === ov.id)
  const patch = (p: Patch) => update(ov.id, p)
  const localTime = Math.max(0, Math.min(playhead - ov.start, overlayLength(ov)))
  const position = positionAt(ov, localTime)
  const visualStyle = resolveOverlayStyle(ov)
  const shapeStyle = ov.shape ? resolveShapeStyle(ov.shape) : null

  return (
    <div className="inspector__body">
      {tab === 'basic' && <>
        <InspectorBlock title={translate('기본 정보', 'Basic info')}>
          <div className="inspector__group">
            <NameField icon={<Icon name={ov.shape ? 'shape' : ov.kind === 'image' ? 'image' : 'layers'} />} name={ov.name} onChange={(v) => update(ov.id, { name: v })} />
            <div className="inspector__hint">{ov.shape ? translate('도형', 'Shape') : translate('레이어', 'Layer')} · {translate('길이', 'Duration')} {formatTime(overlayLength(ov))}</div>
          </div>
        </InspectorBlock>
        <InspectorBlock title={translate('레이어 상태', 'Layer state')}>
          <LayerStateRow opacity={ov.opacity} locked={ov.locked} hidden={ov.hidden} onPatch={patch}
            onCenter={(axis) => updatePosition('overlay', ov.id, { ...(axis !== 'y' ? { x: 0.5 } : {}), ...(axis !== 'x' ? { y: 0.5 } : {}) })} />
        </InspectorBlock>
        <InspectorBlock title={translate('레이어 위치', 'Layer order')}>
          <div className="inspector__group btnrow">
            <button className="btn" disabled={idx <= 0} onClick={() => raise(ov.id, -1)}>▼ {translate('아래로', 'Down')}</button>
            <button className="btn" disabled={idx >= visualOrder.length - 1} onClick={() => raise(ov.id, 1)}>{translate('위로', 'Up')} ▲</button>
          </div>
          {!ov.shape && <button className="btn" onClick={() => toMain(ov.id)}><Icon name="video" />{translate('메인 트랙으로 이동', 'Move to main track')}</button>}
        </InspectorBlock>
        <button className="btn btn--danger" onClick={() => remove(ov.id)}>{translate('레이어 삭제', 'Delete layer')}</button>
      </>}
      {tab === 'transform' && <>
        <InspectorBlock title={translate('위치와 크기', 'Position and size')}>
          <div className="inspector__group">
            <Range label={translate('가로 위치', 'Horizontal position')} value={Math.round(position.x * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => updatePosition('overlay', ov.id, { x: v / 100 })} />
            <Range label={translate('세로 위치', 'Vertical position')} value={Math.round(position.y * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => updatePosition('overlay', ov.id, { y: v / 100 })} />
            <Range label={translate('가로 크기', 'Width')} value={Math.round(ov.scale * 100)} min={10} max={100} step={1} unit="%" onChange={(v) => update(ov.id, { scale: v / 100 })} />
            {ov.scaleY != null && !(ov.aspectLocked ?? true) && <Range label={translate('세로 크기', 'Height')} value={Math.round(ov.scaleY * 100)} min={5} max={100} step={1} unit="%" onChange={(v) => update(ov.id, { scaleY: v / 100 })} />}
            <button className={`btn btn--sm${ov.aspectLocked ?? true ? ' btn--on' : ''}`} onClick={() => update(ov.id, ov.aspectLocked ?? true
              ? { aspectLocked: false }
              : { aspectLocked: true, scaleY: undefined })}>
              <Icon name={ov.aspectLocked ?? true ? 'lock' : 'unlock'} />{translate('비율', 'Aspect')} {ov.aspectLocked ?? true ? translate('고정', 'Locked') : translate('자유', 'Free')}
            </button>
          </div>
        </InspectorBlock>
        <InspectorBlock title={translate('회전과 반전', 'Rotate and flip')}>
          <TransformRow rotate={ov.rotate} flipH={ov.flipH} flipV={ov.flipV} onPatch={patch} />
          <div className="inspector__group"><Range label={translate('자유 회전', 'Free rotation')} value={ov.angle || 0} min={-180} max={180} step={1} unit="°" onChange={(v) => update(ov.id, { angle: v })} /></div>
        </InspectorBlock>
        {!ov.shape && <InspectorBlock title={translate('자르기', 'Crop')}><CropRow crop={ov.crop} onPatch={patch} onOpen={onOpenCrop} /></InspectorBlock>}
        <InspectorBlock title={translate('움직임', 'Motion')}>
          <PositionKeyframeRow frames={ov.positionKeyframes} localTime={localTime}
            onToggle={() => togglePositionKeyframe('overlay', ov.id)}
            onClear={() => clearPositionKeyframes('overlay', ov.id)}
            onSeek={(frame) => setPlayhead(ov.start + frame.time)}
            onEasing={(keyframeId, easing) => setPositionKeyframeEasing('overlay', ov.id, keyframeId, easing)} />
        </InspectorBlock>
      </>}
      {tab === 'style' && <>
        {!shapeStyle && ov.kind === 'image' && <InspectorBlock title={translate('배경 제거', 'Remove background')}>
          <BackgroundRemovalRow enabled={ov.backgroundRemovalEnabled} sensitivity={ov.backgroundRemovalSensitivity} onPatch={patch} />
        </InspectorBlock>}
        {shapeStyle ? <InspectorBlock title={translate('도형', 'Shape')}>
          <div className="shape-style-picker" role="radiogroup" aria-label={translate('도형 종류', 'Shape type')}>
            {SHAPE_OPTIONS.map((option) => (
              <button type="button" role="radio" aria-checked={shapeStyle.kind === option.value} key={option.value}
                className={shapeStyle.kind === option.value ? 'is-active' : ''}
                onClick={() => update(ov.id, { shape: { ...shapeStyle, kind: option.value }, name: translate(`${option.label} 도형`, `${option.labelEn} shape`) })}>
                <ShapeIcon kind={option.value} />
                <span>{translate(option.label, option.labelEn)}</span>
              </button>
            ))}
          </div>
          <div className="inspector__group">
            <ColorControl label={translate('채우기 색상', 'Fill color')} value={shapeStyle.fillColor} onChange={(fillColor) => update(ov.id, { shape: { ...shapeStyle, fillColor } })} />
            <Range label={translate('채우기 불투명도', 'Fill opacity')} value={Math.round(shapeStyle.fillOpacity * 100)} min={0} max={100} step={1} unit="%"
              onChange={(fillOpacity) => update(ov.id, { shape: { ...shapeStyle, fillOpacity: fillOpacity / 100 } })} />
            {shapeStyle.kind === 'rectangle' && <Range label={translate('모서리 둥글기', 'Corner radius')} value={Math.round(shapeStyle.cornerRadius * 200)} min={0} max={100} step={1} unit="%"
              onChange={(cornerRadius) => update(ov.id, { shape: { ...shapeStyle, cornerRadius: cornerRadius / 200 } })} />}
          </div>
        </InspectorBlock> : <InspectorBlock title={translate('마스크 모양', 'Mask shape')}>
          <div className="mask-picker" role="radiogroup" aria-label={translate('오버레이 마스크 모양', 'Overlay mask shape')}>
            {MASK_OPTIONS.map((option) => (
              <button type="button" role="radio" aria-checked={visualStyle.maskShape === option.value} key={option.value}
                className={visualStyle.maskShape === option.value ? 'is-active' : ''}
                onClick={() => update(ov.id, { maskShape: option.value })}>
                <MaskIcon shape={option.value} />
                <span>{translate(option.label, option.labelEn)}</span>
              </button>
            ))}
          </div>
          <div className="inspector__hint">{translate('마스크는 원본을 지우지 않고 보이는 모양만 바꿉니다.', 'Masks change only the visible shape without altering the source.')}</div>
        </InspectorBlock>}
        <InspectorBlock title={translate('테두리', 'Border')}>
          <div className="inspector__group">
            <Range label={translate('굵기', 'Width')} value={Math.round(visualStyle.borderWidth * 720)} min={0} max={40} step={1} unit="px"
              onChange={(value) => update(ov.id, { borderWidth: value / 720 })} />
            <ColorControl label={translate('색상', 'Color')} value={visualStyle.borderColor} onChange={(borderColor) => update(ov.id, { borderColor })} />
            <label className="style-select">
              <span>{translate('선 스타일', 'Line style')}</span>
              <select value={visualStyle.borderStyle} onChange={(event) => update(ov.id, { borderStyle: event.target.value as OverlayBorderStyle })}>
                <option value="solid">{translate('실선', 'Solid')}</option>
                <option value="dashed">{translate('긴 점선', 'Dashed')}</option>
                <option value="dotted">{translate('둥근 점선', 'Dotted')}</option>
                <option value="double">{translate('이중선', 'Double')}</option>
              </select>
            </label>
          </div>
        </InspectorBlock>
        <InspectorBlock title={translate('그림자', 'Shadow')}>
          <div className="inspector__group">
            <label className="switch">
              <input type="checkbox" checked={visualStyle.shadowEnabled} onChange={(event) => update(ov.id, { shadowEnabled: event.target.checked })} />
              <span>{translate('그림자 사용', 'Enable shadow')}</span>
            </label>
            {visualStyle.shadowEnabled && <>
              <ColorControl label={translate('색상', 'Color')} value={visualStyle.shadowColor} onChange={(shadowColor) => update(ov.id, { shadowColor })} />
              <Range label={translate('불투명도', 'Opacity')} value={Math.round(visualStyle.shadowOpacity * 100)} min={0} max={100} step={1} unit="%"
                onChange={(value) => update(ov.id, { shadowOpacity: value / 100 })} />
              <Range label={translate('흐림', 'Blur')} value={Math.round(visualStyle.shadowBlur * 720)} min={0} max={40} step={1} unit="px"
                onChange={(value) => update(ov.id, { shadowBlur: value / 720 })} />
              <Range label={translate('가로 위치', 'Horizontal offset')} value={Math.round(visualStyle.shadowX * 720)} min={-40} max={40} step={1} unit="px"
                onChange={(value) => update(ov.id, { shadowX: value / 720 })} />
              <Range label={translate('세로 위치', 'Vertical offset')} value={Math.round(visualStyle.shadowY * 720)} min={-40} max={40} step={1} unit="px"
                onChange={(value) => update(ov.id, { shadowY: value / 720 })} />
            </>}
          </div>
        </InspectorBlock>
        <button className="btn" onClick={() => update(ov.id, shapeStyle
          ? { ...OVERLAY_STYLE_DEFAULTS, shape: { ...SHAPE_STYLE_DEFAULTS, kind: shapeStyle.kind } }
          : { ...OVERLAY_STYLE_DEFAULTS })}>{translate('스타일 초기화', 'Reset style')}</button>
      </>}
      {tab === 'time' && <>
        {!ov.shape && <InspectorBlock title={translate('트림', 'Trim')}>
          <div className="inspector__group">
            <Range label={translate('시작 트림', 'Trim start')} badge={formatTime(ov.trimStart)} value={ov.trimStart} min={0} max={ov.duration} step={0.1} unit={translate('초', 's')}
              onChange={(v) => update(ov.id, { trimStart: Math.min(v, ov.trimEnd - 0.1) })} />
            <Range label={translate('끝 트림', 'Trim end')} badge={formatTime(ov.trimEnd)} value={ov.trimEnd} min={0} max={ov.duration} step={0.1} unit={translate('초', 's')}
              onChange={(v) => update(ov.id, { trimEnd: Math.max(v, ov.trimStart + 0.1) })} />
          </div>
        </InspectorBlock>}
        {!ov.shape && ov.kind === 'video' && <InspectorBlock title={translate('속도', 'Speed')}><SpeedRow speed={ov.speed} onPatch={patch} /></InspectorBlock>}
        <InspectorBlock title={translate('페이드', 'Fade')}><FadeRow length={overlayLength(ov)} fadeIn={ov.fadeIn} fadeOut={ov.fadeOut} onPatch={patch} label={translate('화면·소리 페이드', 'Video and audio fade')} /></InspectorBlock>
        <InspectorBlock title={ov.shape ? translate('길이', 'Duration') : translate('길이와 반복', 'Duration and repeat')}>
          {!ov.shape && <RepeatRow repeat={ov.repeat} onPatch={patch} />}
          <DurationRow seconds={overlayLength(ov)} onSet={(t) => update(ov.id, exactDurationPatch((ov.trimEnd - ov.trimStart) / ov.speed, t))} />
        </InspectorBlock>
      </>}
      {tab === 'audio' && ov.kind === 'video' && <InspectorBlock title={translate('레이어 오디오', 'Layer audio')}><VolumeRow volume={ov.volume} muted={ov.muted} onPatch={patch} /></InspectorBlock>}
    </div>
  )
}

// ---- audio ----
function AudioInspector({ audio, tab }: { audio: AudioClip; tab: InspectorTab }) {
  const update = useEditor((s) => s.updateAudio)
  const remove = useEditor((s) => s.removeAudio)
  const clips = useEditor((s) => s.clips)
  const base = audio.trimEnd - audio.trimStart
  const mainLength = totalDuration(clips)

  return (
    <div className="inspector__body">
      {tab === 'basic' && <>
        <InspectorBlock title={translate('기본 정보', 'Basic info')}>
          <div className="inspector__group">
            <NameField icon={<Icon name="music" />} name={audio.name} onChange={(v) => update(audio.id, { name: v })} />
            <div className="inspector__hint">{translate('오디오', 'Audio')} · {translate('길이', 'Duration')} {formatTime(audioLength(audio))} · {translate('원본', 'Source')} {formatTime(audio.duration)}</div>
          </div>
        </InspectorBlock>
        <InspectorBlock title={translate('음량', 'Volume')}><VolumeRow volume={audio.volume} muted={audio.muted} onPatch={(p) => update(audio.id, p)} /></InspectorBlock>
        <InspectorBlock title={translate('페이드', 'Fade')}><FadeRow length={audioLength(audio)} fadeIn={audio.fadeIn} fadeOut={audio.fadeOut} onPatch={(p) => update(audio.id, p)} label={translate('소리 페이드', 'Audio fade')} /></InspectorBlock>
        <button className="btn btn--danger" onClick={() => remove(audio.id)}>{translate('오디오 삭제', 'Delete audio')}</button>
      </>}
      {tab === 'time' && <>
        <InspectorBlock title={translate('트림', 'Trim')}>
          <div className="inspector__group">
            <Range label={translate('시작 트림', 'Trim start')} badge={formatTime(audio.trimStart)} value={audio.trimStart} min={0} max={audio.duration} step={0.1} unit={translate('초', 's')}
              onChange={(v) => update(audio.id, { trimStart: Math.min(v, audio.trimEnd - 0.1) })} />
            <Range label={translate('끝 트림', 'Trim end')} badge={formatTime(audio.trimEnd)} value={audio.trimEnd} min={0} max={audio.duration} step={0.1} unit={translate('초', 's')}
              onChange={(v) => update(audio.id, { trimEnd: Math.max(v, audio.trimStart + 0.1) })} />
          </div>
        </InspectorBlock>
        <InspectorBlock title={translate('길이와 반복', 'Duration and repeat')}>
          <RepeatRow repeat={audio.repeat} onPatch={(p) => update(audio.id, p)} />
          {mainLength > 0 && <button className="btn btn--sm" onClick={() => update(audio.id, { start: 0, ...exactDurationPatch(Math.max(0.1, base), mainLength) })}>{translate('메인 트랙 전체 길이에 맞춤', 'Fit to full main track')}</button>}
          <DurationRow seconds={audioLength(audio)} onSet={(t) => update(audio.id, exactDurationPatch(Math.max(0.1, base), t))} />
        </InspectorBlock>
      </>}
    </div>
  )
}

// ---- text ----
const ALIGNS: TextOverlay['align'][] = ['left', 'center', 'right', 'justify']
function TextInspector({ text, tab }: { text: TextOverlay; tab: InspectorTab }) {
  const update = useEditor((s) => s.updateText)
  const updatePosition = useEditor((s) => s.updateLayerPosition)
  const togglePositionKeyframe = useEditor((s) => s.togglePositionKeyframe)
  const clearPositionKeyframes = useEditor((s) => s.clearPositionKeyframes)
  const setPositionKeyframeEasing = useEditor((s) => s.setPositionKeyframeEasing)
  const setPlayhead = useEditor((s) => s.setPlayhead)
  const playhead = useEditor((s) => s.playhead)
  const remove = useEditor((s) => s.removeText)
  const raise = useEditor((s) => s.raiseText)
  const texts = useEditor((s) => s.texts)
  const overlays = useEditor((s) => s.overlays)
  const storedVisualOrder = useEditor((s) => s.visualOrder)
  const visualOrder = normalizeVisualOrder(overlays, texts, storedVisualOrder)
  const idx = visualOrder.findIndex((item) => item.type === 'text' && item.id === text.id)
  const set = (p: Partial<TextOverlay>) => update(text.id, p)
  const localTime = Math.max(0, Math.min(playhead - text.start, text.end - text.start))
  const position = positionAt(text, localTime)

  return (
    <div className="inspector__body">
      {tab === 'basic' && <>
        <InspectorBlock title={translate('내용', 'Content')}>
          <div className="inspector__group"><textarea className="textarea" rows={3} value={text.text} onChange={(e) => set({ text: e.target.value })} aria-label={translate('텍스트 내용', 'Text content')} /></div>
        </InspectorBlock>
        <InspectorBlock title={translate('글꼴', 'Font')}>
          <div className="inspector__group"><FontPicker value={text.font} onChange={(font) => set({ font })} /></div>
        </InspectorBlock>
        <InspectorBlock title={translate('정렬', 'Alignment')}>
          <div className="inspector__group"><div className="chips">{ALIGNS.map((align) => (
            <button key={align} className={`chip chip--icon${text.align === align ? ' chip--on' : ''}`} aria-label={{ left: translate('왼쪽 정렬', 'Align left'), center: translate('가운데 정렬', 'Align center'), right: translate('오른쪽 정렬', 'Align right'), justify: translate('양쪽 정렬', 'Justify') }[align]} onClick={() => set({ align })}><AlignIcon a={align} /></button>
          ))}</div></div>
        </InspectorBlock>
        <button className="btn btn--danger" onClick={() => remove(text.id)}>{translate('텍스트 삭제', 'Delete text')}</button>
      </>}
      {tab === 'transform' && <>
        <InspectorBlock title={translate('위치와 크기', 'Position and size')}>
          <div className="inspector__group">
            <Range label={translate('가로 위치', 'Horizontal position')} value={Math.round(position.x * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => updatePosition('text', text.id, { x: v / 100 })} />
            <Range label={translate('세로 위치', 'Vertical position')} value={Math.round(position.y * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => updatePosition('text', text.id, { y: v / 100 })} />
            <Range label={translate('글자 크기', 'Text size')} value={Math.round(text.size * 1000)} min={20} max={400} step={5} onChange={(v) => set({ size: v / 1000 })} />
            <Range label={translate('회전', 'Rotation')} value={text.angle || 0} min={-180} max={180} step={1} unit="°" onChange={(v) => set({ angle: v })} />
            <div className="inspector__hint">{translate('미리보기에서 직접 이동·크기·회전을 조절할 수도 있습니다.', 'You can also adjust position, size, and rotation directly in the preview.')}</div>
          </div>
        </InspectorBlock>
        <InspectorBlock title={translate('레이어 상태', 'Layer state')}>
          <LayerStateRow opacity={text.opacity} locked={text.locked} hidden={text.hidden} onPatch={(patch) => set(patch as Partial<TextOverlay>)} onCenter={(axis) => updatePosition('text', text.id, { ...(axis !== 'y' ? { x: 0.5 } : {}), ...(axis !== 'x' ? { y: 0.5 } : {}) })} />
        </InspectorBlock>
        <InspectorBlock title={translate('움직임', 'Motion')}>
          <PositionKeyframeRow frames={text.positionKeyframes} localTime={localTime} onToggle={() => togglePositionKeyframe('text', text.id)} onClear={() => clearPositionKeyframes('text', text.id)} onSeek={(frame) => setPlayhead(text.start + frame.time)} onEasing={(keyframeId, easing) => setPositionKeyframeEasing('text', text.id, keyframeId, easing)} />
        </InspectorBlock>
        <InspectorBlock title={translate('레이어 순서', 'Layer order')}>
          <div className="inspector__group btnrow"><button className="btn" disabled={idx <= 0} onClick={() => raise(text.id, -1)}>▼ {translate('아래로', 'Down')}</button><button className="btn" disabled={idx >= visualOrder.length - 1} onClick={() => raise(text.id, 1)}>{translate('위로', 'Up')} ▲</button></div>
        </InspectorBlock>
      </>}
      {tab === 'style' && <>
        <InspectorBlock title={translate('글자색', 'Text color')}>
          <div className="inspector__group"><div className="inspector__row"><label className="field__label"><span>{translate('색상', 'Color')}</span></label><input type="color" value={text.color} onChange={(e) => set({ color: e.target.value })} /></div><Range label={translate('불투명도', 'Opacity')} value={Math.round(text.colorAlpha * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => set({ colorAlpha: v / 100 })} /></div>
        </InspectorBlock>
        <InspectorBlock title={translate('배경 박스', 'Background box')}>
          <div className="inspector__group"><label className="switch"><input type="checkbox" checked={text.box} onChange={(e) => set({ box: e.target.checked })} /><span>{translate('배경 박스 사용', 'Use background box')}</span></label>{text.box && <><div className="inspector__row"><label className="field__label"><span>{translate('배경색', 'Background color')}</span></label><input type="color" value={text.boxColor} onChange={(e) => set({ boxColor: e.target.value })} /></div><Range label={translate('불투명도', 'Opacity')} value={Math.round(text.boxAlpha * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => set({ boxAlpha: v / 100 })} /></>}</div>
        </InspectorBlock>
        <InspectorBlock title={translate('테두리', 'Outline')}>
          <div className="inspector__group"><Range label={translate('두께', 'Width')} value={Number((text.strokeWidth * 100).toFixed(1))} min={0} max={15} step={0.1} onChange={(v) => set({ strokeWidth: v / 100 })} />{text.strokeWidth > 0 && <div className="inspector__row"><label className="field__label"><span>{translate('색상', 'Color')}</span></label><input type="color" value={text.strokeColor} onChange={(e) => set({ strokeColor: e.target.value })} /></div>}</div>
        </InspectorBlock>
        <InspectorBlock title={translate('그림자', 'Shadow')}>
          <div className="inspector__group"><label className="switch"><input type="checkbox" checked={text.shadow} onChange={(e) => set({ shadow: e.target.checked })} /><span>{translate('그림자 사용', 'Enable shadow')}</span></label>{text.shadow && <><div className="inspector__row"><label className="field__label"><span>{translate('색상', 'Color')}</span></label><input type="color" value={text.shadowColor} onChange={(e) => set({ shadowColor: e.target.value })} /></div><Range label={translate('번짐', 'Blur')} value={Math.round(text.shadowBlur * 100)} min={0} max={40} step={1} unit="%" onChange={(v) => set({ shadowBlur: v / 100 })} /><Range label={translate('거리', 'Distance')} value={Math.round(text.shadowDist * 100)} min={0} max={30} step={1} unit="%" onChange={(v) => set({ shadowDist: v / 100 })} /></>}</div>
        </InspectorBlock>
      </>}
      {tab === 'time' && <>
        <InspectorBlock title={translate('길이', 'Duration')}><DurationRow seconds={text.end - text.start} onSet={(duration) => set({ end: text.start + duration })} /></InspectorBlock>
        <InspectorBlock title={translate('페이드', 'Fade')}><FadeRow length={text.end - text.start} fadeIn={text.fadeIn} fadeOut={text.fadeOut} onPatch={(patch) => set(patch as Partial<TextOverlay>)} label={translate('텍스트 페이드', 'Text fade')} /></InspectorBlock>
      </>}
    </div>
  )
}

// ---- dedicated caption cue ----
function CaptionInspector({ track, cue, tab }: { track: CaptionTrack; cue: CaptionCue; tab: InspectorTab }) {
  const updateTrack = useEditor((s) => s.updateCaptionTrack)
  const updateCue = useEditor((s) => s.updateCaptionCue)
  const removeCue = useEditor((s) => s.removeCaptionCue)
  const setPlayhead = useEditor((s) => s.setPlayhead)
  const setCue = (patch: Partial<Omit<CaptionCue, 'id'>>) => updateCue(track.id, cue.id, patch)

  return (
    <div className="inspector__body">
      {tab === 'basic' && <>
        <InspectorBlock title={translate('자막 내용', 'Caption text')}>
          <div className="inspector__group">
            <textarea className="textarea" rows={4} value={cue.text} disabled={track.locked}
              onChange={(event) => setCue({ text: event.target.value })} aria-label={translate('자막 내용', 'Caption text')} />
            <div className="inspector__hint">{translate('일반 텍스트와 달리 자막은 전용 트랙의 시간 순서대로 관리됩니다.', 'Unlike free text, captions are managed in time order on a dedicated track.')}</div>
          </div>
        </InspectorBlock>
        <InspectorBlock title={translate('자막 트랙', 'Caption track')}>
          <div className="inspector__group">
            <NameField icon={<Icon name="text" />} name={track.name} onChange={(name) => updateTrack(track.id, { name })} />
            <label className="style-select">
              <span>{translate('언어', 'Language')}</span>
              <select value={track.language} onChange={(event) => updateTrack(track.id, { language: event.target.value })}>
                <option value="und">{translate('지정 안 함', 'Not specified')}</option>
                <option value="ko">{translate('한국어', 'Korean')}</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="switch"><input type="checkbox" checked={track.hidden} onChange={(event) => updateTrack(track.id, { hidden: event.target.checked })} /><span>{translate('자막 트랙 숨기기', 'Hide caption track')}</span></label>
            <label className="switch"><input type="checkbox" checked={track.locked} onChange={(event) => updateTrack(track.id, { locked: event.target.checked })} /><span>{translate('자막 트랙 잠그기', 'Lock caption track')}</span></label>
          </div>
        </InspectorBlock>
        <button className="btn btn--danger" disabled={track.locked} onClick={() => removeCue(track.id, cue.id)}>{translate('이 자막 삭제', 'Delete this caption')}</button>
      </>}
      {tab === 'time' && <>
        <InspectorBlock title={translate('표시 시간', 'Timing')}>
          <div className="inspector__group">
            <div className="field__label"><span>{translate('시작', 'Start')}</span><TimeField seconds={cue.start} onChange={(start) => setCue({ start: Math.max(0, Math.min(start, cue.end - 0.05)) })} /></div>
            <div className="field__label"><span>{translate('종료', 'End')}</span><TimeField seconds={cue.end} onChange={(end) => setCue({ end: Math.max(cue.start + 0.05, end) })} /></div>
            <DurationRow seconds={cue.end - cue.start} onSet={(duration) => setCue({ end: cue.start + duration })} />
            <button className="btn btn--sm" onClick={() => setPlayhead(cue.start)}>{translate('시작 위치로 이동', 'Go to caption start')}</button>
          </div>
        </InspectorBlock>
      </>}
    </div>
  )
}

// ---- background layer ----
function BackgroundInspector({ bg, tab }: { bg: Background; tab: InspectorTab }) {
  const update = useEditor((s) => s.updateBackground)
  const remove = useEditor((s) => s.removeBackground)
  const raise = useEditor((s) => s.raiseBackground)
  const toMain = useEditor((s) => s.moveBackgroundToMain)
  const backgrounds = useEditor((s) => s.backgrounds)
  const idx = backgrounds.findIndex((b) => b.id === bg.id)
  const patch = (p: Patch) => update(bg.id, p)

  return (
    <div className="inspector__body">
      {tab === 'basic' && <>
        <InspectorBlock title={translate('기본 정보', 'Basic info')}>
          <div className="inspector__group"><NameField icon={<Icon name="palette" />} name={bg.name} onChange={(v) => update(bg.id, { name: v })} /><div className="inspector__hint">{translate('배경 레이어', 'Background layer')} · {translate('길이', 'Duration')} {formatTime(clipTimelineDuration(bg))}</div></div>
        </InspectorBlock>
        {bg.kind === 'color' && <InspectorBlock title={translate('색상', 'Color')}><div className="inspector__group inspector__row"><label className="field__label"><span>{translate('배경 색상', 'Background color')}</span></label><input type="color" value={bg.bgColor ?? '#000000'} onChange={(e) => update(bg.id, { bgColor: e.target.value })} /></div></InspectorBlock>}
        {bg.kind === 'image' && <InspectorBlock title={translate('배경 제거', 'Remove background')}><BackgroundRemovalRow enabled={bg.backgroundRemovalEnabled} sensitivity={bg.backgroundRemovalSensitivity} onPatch={patch} /></InspectorBlock>}
        {bg.kind === 'video' && <InspectorBlock title={translate('오디오', 'Audio')}><VolumeRow volume={bg.volume} muted={bg.muted} onPatch={patch} /></InspectorBlock>}
        <InspectorBlock title={translate('레이어 상태', 'Layer state')}><LayerStateRow opacity={bg.opacity} locked={bg.locked} hidden={bg.hidden} onPatch={patch} /></InspectorBlock>
        <InspectorBlock title={translate('레이어 위치', 'Layer order')}><div className="inspector__group btnrow"><button className="btn" disabled={idx <= 0} onClick={() => raise(bg.id, -1)}>▼ {translate('아래로', 'Down')}</button><button className="btn" disabled={idx >= backgrounds.length - 1} onClick={() => raise(bg.id, 1)}>{translate('위로', 'Up')} ▲</button></div><button className="btn" onClick={() => toMain(bg.id)}><Icon name="video" />{translate('메인 트랙으로 이동', 'Move to main track')}</button></InspectorBlock>
        <button className="btn btn--danger" onClick={() => remove(bg.id)}>{translate('배경 삭제', 'Delete background')}</button>
      </>}
      {tab === 'time' && <>
        {bg.kind !== 'color' && <InspectorBlock title={translate('트림', 'Trim')}><div className="inspector__group"><Range label={translate('시작 트림', 'Trim start')} badge={formatTime(bg.trimStart)} value={bg.trimStart} min={0} max={bg.duration} step={0.1} unit={translate('초', 's')} onChange={(v) => update(bg.id, { trimStart: Math.min(v, bg.trimEnd - 0.1) })} /><Range label={translate('끝 트림', 'Trim end')} badge={formatTime(bg.trimEnd)} value={bg.trimEnd} min={0} max={bg.duration} step={0.1} unit={translate('초', 's')} onChange={(v) => update(bg.id, { trimEnd: Math.max(v, bg.trimStart + 0.1) })} /></div></InspectorBlock>}
        <InspectorBlock title={translate('페이드', 'Fade')}><FadeRow length={clipTimelineDuration(bg)} fadeIn={bg.fadeIn} fadeOut={bg.fadeOut} onPatch={patch} label={translate('배경 페이드', 'Background fade')} /></InspectorBlock>
        <InspectorBlock title={translate('길이와 반복', 'Duration and repeat')}><RepeatRow repeat={bg.repeat} onPatch={patch} /><DurationRow seconds={clipTimelineDuration(bg)} onSet={(duration) => update(bg.id, exactDurationPatch((bg.trimEnd - bg.trimStart) / bg.speed, duration))} /></InspectorBlock>
      </>}
    </div>
  )
}

export default function Inspector({ onOpenCrop }: { onOpenCrop: () => void }) {
  const { t } = useLanguage()
  const selection = useEditor((s) => s.selection)
  const selectedItems = useEditor((s) => s.selectedItems)
  const clips = useEditor((s) => s.clips)
  const overlays = useEditor((s) => s.overlays)
  const audios = useEditor((s) => s.audios)
  const texts = useEditor((s) => s.texts)
  const captionTracks = useEditor((s) => s.captionTracks)
  const backgrounds = useEditor((s) => s.backgrounds)
  const aspectRatio = useEditor((s) => s.aspectRatio)
  const setAspectRatio = useEditor((s) => s.setAspectRatio)
  const groupSelected = useEditor((s) => s.groupSelected)
  const ungroupSelected = useEditor((s) => s.ungroupSelected)
  const deleteSelected = useEditor((s) => s.deleteSelected)
  const groups = useEditor((s) => s.groups)
  const [activeTab, setActiveTab] = useState<InspectorTab>('basic')

  const selClip = selection?.type === 'clip' ? clips.find((c) => c.id === selection.id) : null
  const selOverlay = selection?.type === 'overlay' ? overlays.find((o) => o.id === selection.id) : null
  const selAudio = selection?.type === 'audio' ? audios.find((a) => a.id === selection.id) : null
  const selText = selection?.type === 'text' ? texts.find((t) => t.id === selection.id) : null
  const selCaption = selection?.type === 'caption'
    ? captionTracks.flatMap((track) => track.cues.map((cue) => ({ track, cue }))).find((entry) => entry.cue.id === selection.id) ?? null
    : null
  const selBg = selection?.type === 'background' ? backgrounds.find((b) => b.id === selection.id) : null
  const contextTitle = selectedItems.length > 1 ? t(`${selectedItems.length}개 항목 선택됨`, `${selectedItems.length} items selected`)
    : selClip?.name || selOverlay?.name || selAudio?.name || (selText ? t('텍스트', 'Text') : '') || (selCaption ? t('자막', 'Caption') : '') || selBg?.name || t('캔버스', 'Canvas')
  const groupedSelection = selectedItems.some((item) => groups.some((group) => group.members.some((member) => member.type === item.type && member.id === item.id)))
  const activeSelectionGroup = groups.find((group) => selectedItems.length > 1 && selectedItems.every((item) =>
    group.members.some((member) => member.type === item.type && member.id === item.id)))
  const inspectorTabs: InspectorTabOption[] = useMemo(() => selCaption
    ? [{ id: 'basic', label: t('자막', 'Caption') }, { id: 'time', label: t('시간', 'Timing') }]
    : selText
      ? [{ id: 'basic', label: t('내용', 'Content') }, { id: 'style', label: t('스타일', 'Style') }, { id: 'transform', label: t('배치', 'Layout') }, { id: 'time', label: t('시간', 'Timing') }]
    : selAudio
      ? [{ id: 'basic', label: t('오디오', 'Audio') }, { id: 'time', label: t('시간', 'Timing') }]
      : selOverlay
        ? [{ id: 'basic', label: t('기본', 'Basic') }, { id: 'transform', label: t('변형', 'Transform') }, { id: 'style', label: t('스타일', 'Style') }, { id: 'time', label: t('시간', 'Timing') }, ...(selOverlay.kind === 'video' ? [{ id: 'audio' as const, label: t('오디오', 'Audio') }] : [])]
        : selClip
          ? [{ id: 'basic', label: t('기본', 'Basic') }, ...(selClip.kind === 'color' ? [] : [{ id: 'transform' as const, label: t('변형', 'Transform') }]), ...(selClip.kind === 'image' ? [{ id: 'style' as const, label: t('스타일', 'Style') }] : []), { id: 'time', label: t('시간', 'Timing') }, ...(selClip.kind === 'video' ? [{ id: 'audio' as const, label: t('오디오', 'Audio') }] : [])]
          : selBg
            ? [{ id: 'basic', label: t('기본', 'Basic') }, { id: 'time', label: t('시간', 'Timing') }]
            : [], [selAudio, selBg, selCaption, selClip, selOverlay, selText, t])
  const selectionKey = selection ? `${selection.type}:${selection.id}` : 'canvas'
  useEffect(() => { setActiveTab('basic') }, [selectionKey])
  useEffect(() => {
    if (inspectorTabs.length && !inspectorTabs.some((tab) => tab.id === activeTab)) setActiveTab(inspectorTabs[0].id)
  }, [activeTab, inspectorTabs])

  return (
    <aside className="inspector">
      <div className="inspector__context">
        <small>{selection ? translate('선택 항목 편집', 'Edit selection') : translate('프로젝트 설정', 'Project settings')}</small>
        <b title={contextTitle}>{contextTitle}</b>
      </div>
      {!selection && <details className="inspector__section" open>
        <summary>{translate('캔버스', 'Canvas')}</summary>
        <div className="inspector__group">
          <div className="field__label"><span>{translate('화면 비율', 'Aspect ratio')}</span></div>
          <div className="chips">
            {(['16:9', '9:16', '1:1'] as const).map((r) => (
              <button key={r} className={`chip${aspectRatio === r ? ' chip--on' : ''}`} onClick={() => setAspectRatio(r)}>{r}</button>
            ))}
          </div>
        </div>
      </details>}
      {selection && selectedItems.length <= 1 && <InspectorTabs tabs={inspectorTabs} active={activeTab} onChange={setActiveTab} />}
      {!selection && <hr className="inspector__sep" />}
      {selectedItems.length > 1 ? (
        <div className="inspector__body inspector__multi">
          <div className="inspector__hint">{activeSelectionGroup
            ? translate(`'${activeSelectionGroup.name}'으로 연결된 항목입니다. 이동하거나 메인 클립 길이를 바꾸면 연결된 항목이 함께 조정됩니다.`, `These items belong to '${activeSelectionGroup.name}'. Moving them or changing the main clip duration adjusts linked items together.`)
            : translate('선택한 항목은 타임라인에서 함께 이동할 수 있습니다. 그룹으로 묶으면 다음 편집에서도 관계가 유지됩니다.', 'Selected items can move together on the timeline. Group them to keep the relationship for future edits.')}</div>
          {!activeSelectionGroup && <button className="btn btn--primary" onClick={groupSelected}>{translate('선택 항목 그룹 만들기', 'Group selected items')}</button>}
          {groupedSelection && <button className="btn" onClick={ungroupSelected}>{translate('그룹 해제', 'Ungroup')}</button>}
          <button className="btn btn--danger" onClick={deleteSelected}>{translate('선택 항목 삭제', 'Delete selected items')}</button>
        </div>
      ) : selClip ? (
        <ClipInspector clip={selClip} tab={activeTab} onOpenCrop={onOpenCrop} />
      ) : selOverlay ? (
        <OverlayInspector ov={selOverlay} tab={activeTab} onOpenCrop={onOpenCrop} />
      ) : selAudio ? (
        <AudioInspector audio={selAudio} tab={activeTab} />
      ) : selText ? (
        <TextInspector text={selText} tab={activeTab} />
      ) : selCaption ? (
        <CaptionInspector track={selCaption.track} cue={selCaption.cue} tab={activeTab} />
      ) : selBg ? (
        <BackgroundInspector bg={selBg} tab={activeTab} />
      ) : (
        <div className="inspector__empty">{translate('타임라인이나 미리보기에서 항목을 선택하면', 'Select an item in the timeline or preview')}<br />{translate('여기서 편집할 수 있어요.', 'to edit it here.')}</div>
      )}
    </aside>
  )
}
