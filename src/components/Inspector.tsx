import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useEditor } from '../store'
import type { Clip, TextOverlay, Overlay, AudioClip, Background, Crop, PositionKeyframe, KeyframeEasing, OverlayBorderStyle, OverlayMaskShape } from '../types'
import { NO_CROP } from '../types'
import { formatTime, formatClock, parseClock, clipTimelineDuration, overlayLength, audioLength, totalDuration, exactDurationPatch } from '../utils/time'
import { rotateBy } from '../utils/transform'
import Icon from './Icon'
import { keyframeAt, positionAt } from '../utils/motion'
import { normalizeVisualOrder } from '../utils/layers'
import FontPicker from './FontPicker'
import { maskPathData, OVERLAY_STYLE_DEFAULTS, resolveOverlayStyle } from '../utils/overlay-style'

type Patch = Partial<Pick<Clip & Overlay,
  'rotate' | 'flipH' | 'flipV' | 'crop' | 'speed' | 'volume' | 'muted' | 'repeat' |
  'timelineDuration' | 'fadeIn' | 'fadeOut' | 'opacity' | 'locked' | 'hidden' | 'scaleY' | 'aspectLocked' |
  'borderWidth' | 'borderColor' | 'borderStyle' | 'shadowEnabled' | 'shadowColor' | 'shadowOpacity' |
  'shadowBlur' | 'shadowX' | 'shadowY' | 'maskShape'>>

type InspectorTab = 'basic' | 'transform' | 'style' | 'time' | 'audio'
interface InspectorTabOption { id: InspectorTab; label: string }

function InspectorTabs({ tabs, active, onChange }: {
  tabs: InspectorTabOption[]; active: InspectorTab; onChange: (tab: InspectorTab) => void
}) {
  return (
    <div className="inspector-tabs" role="tablist" aria-label="속성 종류">
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
          <button type="button" className="step" disabled={disabled} onClick={() => set(value - step)} aria-label="감소">−</button>
          <input className="num num--step" type="number" min={min} max={max} step={step} value={fmt(value)} disabled={disabled}
            onChange={(e) => set(Number(e.target.value))} />
          <button type="button" className="step" disabled={disabled} onClick={() => set(value + step)} aria-label="증가">＋</button>
        </div>
        {unit && <span className="unit">{unit}</span>}
      </div>
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
          <button type="button" className="step" onClick={() => set(value - step)} aria-label="감소">−</button>
          <input className="num num--step" type="number" min={min} step={step} value={Number(value.toFixed(fixed))}
            onChange={(e) => set(Number(e.target.value))} />
          <button type="button" className="step" onClick={() => set(value + step)} aria-label="증가">＋</button>
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
      <div className="ctl__label"><span>시간 길이</span><b>{formatTime(seconds)}</b></div>
      <div className="ctl__row">
        <div className="stepper">
          <button type="button" className="step" onClick={() => onSet(Math.max(0.1, seconds - 1))} aria-label="감소">−</button>
          <TimeField seconds={seconds} onChange={(v) => onSet(Math.max(0.1, v))} />
          <button type="button" className="step" onClick={() => onSet(seconds + 1)} aria-label="증가">＋</button>
        </div>
        <span className="unit">시:분:초</span>
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

const MASK_OPTIONS: Array<{ value: OverlayMaskShape; label: string }> = [
  { value: 'none', label: '사각형' },
  { value: 'rounded', label: '둥근 사각형' },
  { value: 'circle', label: '원' },
  { value: 'ellipse', label: '타원' },
  { value: 'heart', label: '하트' },
  { value: 'star', label: '별' },
  { value: 'hexagon', label: '육각형' },
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
    <Stepper label="반복 늘이기" badge={`×${repeat}`} value={repeat} min={1} max={99} step={1} fixed={0}
      onChange={(v) => onPatch({ repeat: Math.round(v) })} />
  )
}

function NameField({ icon, name, onChange }: { icon: ReactNode; name: string; onChange: (v: string) => void }) {
  return (
    <div className="namefield">
      <span className="namefield__icon">{icon}</span>
      <input className="namefield__input" value={name} spellCheck={false}
        onChange={(e) => onChange(e.target.value)} aria-label="이름" />
    </div>
  )
}

// ---- shared control rows ----
function TransformRow({ rotate, flipH, flipV, onPatch }: { rotate: 0 | 90 | 180 | 270; flipH: boolean; flipV: boolean; onPatch: (p: Patch) => void }) {
  return (
    <div className="inspector__group">
      <div className="field__label"><span>회전 · 반전</span><b>{rotate}°</b></div>
      <div className="btnrow">
        <button className="btn btn--sm" onClick={() => onPatch({ rotate: rotateBy(rotate, 90) })}><Icon name="rotate" />90°</button>
        <button className={`btn btn--sm${flipH ? ' btn--on' : ''}`} onClick={() => onPatch({ flipH: !flipH })}><Icon name="flipH" />좌우</button>
        <button className={`btn btn--sm${flipV ? ' btn--on' : ''}`} onClick={() => onPatch({ flipV: !flipV })}><Icon name="flipV" />상하</button>
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
        <span>자르기 (크롭)</span>
        {cropped ? <button className="linkbtn" onClick={() => onPatch({ crop: NO_CROP })}>초기화</button> : null}
      </div>
      <div className="inspector__hint">{cropped ? `원본의 약 ${kept}% 영역을 사용 중입니다.` : '현재 원본 전체를 사용 중입니다.'}</div>
      <button className="btn btn--primary" onClick={onOpen}><Icon name="crop" />자르기 편집창 열기</button>
    </div>
  )
}

function SpeedRow({ speed, onPatch }: { speed: number; onPatch: (p: Patch) => void }) {
  return (
    <div className="inspector__group">
      <Range label="재생 속도" value={speed} min={0.1} max={4} step={0.1} unit="×" onChange={(v) => onPatch({ speed: v })} />
    </div>
  )
}

function VolumeRow({ volume, muted, onPatch, label = '음량' }: { volume: number; muted: boolean; onPatch: (p: Patch) => void; label?: string }) {
  return (
    <div className="inspector__group">
      <Range label={`${label}${volume > 1 && !muted ? ' (증폭)' : ''}`} value={Math.round(volume * 100)} min={0} max={200} step={1} unit="%"
        disabled={muted} onChange={(v) => onPatch({ volume: v / 100 })} />
      <label className="switch">
        <input type="checkbox" checked={muted} onChange={(e) => onPatch({ muted: e.target.checked })} />
        <span>음소거</span>
      </label>
    </div>
  )
}

function FadeRow({ length, fadeIn = 0, fadeOut = 0, onPatch, label = '페이드' }: {
  length: number; fadeIn?: number; fadeOut?: number; onPatch: (p: Patch) => void; label?: string
}) {
  const max = Math.max(0.1, Math.min(10, length / 2))
  return (
    <div className="inspector__group">
      <div className="field__label"><span>{label}</span><b>{fadeIn || fadeOut ? '적용됨' : '없음'}</b></div>
      <Range label="시작" value={fadeIn} min={0} max={max} step={0.1} unit="초" onChange={(value) => onPatch({ fadeIn: value })} />
      <Range label="끝" value={fadeOut} min={0} max={max} step={0.1} unit="초" onChange={(value) => onPatch({ fadeOut: value })} />
    </div>
  )
}

function LayerStateRow({ opacity = 1, locked = false, hidden = false, onPatch, onCenter }: {
  opacity?: number; locked?: boolean; hidden?: boolean; onPatch: (p: Patch) => void
  onCenter?: (axis: 'x' | 'y' | 'both') => void
}) {
  return (
    <div className="inspector__group">
      <Range label="레이어 불투명도" value={Math.round(opacity * 100)} min={0} max={100} step={1} unit="%"
        onChange={(value) => onPatch({ opacity: value / 100 })} />
      <div className="btnrow">
        <button className={`btn btn--sm${locked ? ' btn--on' : ''}`} onClick={() => onPatch({ locked: !locked })}>{locked ? '잠금 해제' : '레이어 잠금'}</button>
        <button className={`btn btn--sm${hidden ? ' btn--on' : ''}`} onClick={() => onPatch({ hidden: !hidden })}>{hidden ? '표시' : '숨기기'}</button>
      </div>
      {onCenter && <div className="btnrow">
        <button className="btn btn--sm" onClick={() => onCenter('x')}>가로 중앙</button>
        <button className="btn btn--sm" onClick={() => onCenter('y')}>세로 중앙</button>
        <button className="btn btn--sm" onClick={() => onCenter('both')}>정중앙</button>
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
        <span>위치 키프레임</span>
        <b>{ordered.length ? `${ordered.length}개` : '없음'}</b>
      </div>
      <div className="keyframes__controls">
        <button className="btn btn--sm" disabled={!previous} onClick={() => previous && onSeek(previous)} aria-label="이전 키프레임">←</button>
        <button className={`btn btn--sm keyframes__toggle${active ? ' btn--on' : ''}`} onClick={onToggle}
          title={active ? '현재 키프레임 삭제' : '현재 위치에 키프레임 추가'}>
          <span className="keyframes__diamond" />{active ? '현재 점 삭제' : '현재 점 추가'}
        </button>
        <button className="btn btn--sm" disabled={!next} onClick={() => next && onSeek(next)} aria-label="다음 키프레임">→</button>
      </div>
      {active && (
        <label className="keyframes__easing">
          <span>다음 점까지 움직임</span>
          <select value={active.easing} onChange={(event) => onEasing(active.id, event.target.value as KeyframeEasing)}>
            <option value="ease-in-out">부드럽게</option>
            <option value="linear">일정하게</option>
          </select>
        </label>
      )}
      {ordered.length > 0 && <button className="linkbtn keyframes__clear" onClick={onClear}>위치 움직임 모두 지우기</button>}
      <div className="inspector__hint">첫 점을 추가한 뒤 재생 헤드를 옮겨 화면에서 레이어를 움직이면 다음 점이 자동으로 생깁니다.</div>
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
          <InspectorBlock title="기본 정보">
            <div className="inspector__group">
              <NameField icon={icon} name={clip.name} onChange={(v) => update(clip.id, { name: v })} />
              <div className="inspector__hint">단색 배경 · 길이 {formatTime(clipTimelineDuration(clip))}</div>
            </div>
          </InspectorBlock>
          <InspectorBlock title="색상">
            <div className="inspector__group inspector__row">
              <label className="field__label"><span>배경 색상</span></label>
              <input type="color" value={clip.bgColor ?? '#000000'} onChange={(e) => update(clip.id, { bgColor: e.target.value })} />
            </div>
          </InspectorBlock>
          <InspectorBlock title="트랙 위치">
            <div className="inspector__group btnrow">
              <button className="btn" disabled={idx <= 0} onClick={() => move(clip.id, -1)}>← 앞으로</button>
              <button className="btn" disabled={idx >= clips.length - 1} onClick={() => move(clip.id, 1)}>뒤로 →</button>
            </div>
          </InspectorBlock>
          <button className="btn btn--danger" onClick={() => remove(clip.id)}>배경 삭제</button>
        </>}
        {tab === 'time' && <>
          <InspectorBlock title="길이">
            <div className="inspector__group">
              <Range label="길이" badge={formatTime(clip.trimEnd)} value={Math.min(clip.trimEnd, 60)} min={0.5} max={60} step={0.5} unit="초"
                onChange={(v) => update(clip.id, { trimEnd: v })} />
            </div>
          </InspectorBlock>
          <InspectorBlock title="시작과 끝"><FadeRow length={clipTimelineDuration(clip)} fadeIn={clip.fadeIn} fadeOut={clip.fadeOut} onPatch={patch} label="화면 페이드" /></InspectorBlock>
          <InspectorBlock title="반복"><RepeatRow repeat={clip.repeat} onPatch={patch} /></InspectorBlock>
        </>}
      </div>
    )
  }

  return (
    <div className="inspector__body">
      {tab === 'basic' && <>
        <InspectorBlock title="기본 정보">
          <div className="inspector__group">
            <NameField icon={icon} name={clip.name} onChange={(v) => update(clip.id, { name: v })} />
            <div className="inspector__hint">길이 {formatTime(clipTimelineDuration(clip))} · 원본 {formatTime(clip.duration)}</div>
          </div>
        </InspectorBlock>
        <InspectorBlock title="트랙 위치">
          <div className="inspector__group btnrow">
            <button className="btn" disabled={idx <= 0} onClick={() => move(clip.id, -1)}>← 앞으로</button>
            <button className="btn" disabled={idx >= clips.length - 1} onClick={() => move(clip.id, 1)}>뒤로 →</button>
          </div>
          <button className="btn" onClick={() => toOverlay(clip.id)}><Icon name="layers" />오버레이 레이어로 이동</button>
          <button className="btn" onClick={() => toBackground(clip.id)}><Icon name="palette" />배경 레이어로 이동</button>
        </InspectorBlock>
        <button className="btn btn--danger" onClick={() => remove(clip.id)}>클립 삭제</button>
      </>}
      {tab === 'transform' && <>
        <InspectorBlock title="회전과 반전"><TransformRow rotate={clip.rotate} flipH={clip.flipH} flipV={clip.flipV} onPatch={patch} /></InspectorBlock>
        <InspectorBlock title="자르기"><CropRow crop={clip.crop} onPatch={patch} onOpen={onOpenCrop} /></InspectorBlock>
      </>}
      {tab === 'time' && <>
        <InspectorBlock title="트림">
          <div className="inspector__group">
            <Range label="시작 트림" badge={formatTime(clip.trimStart)} value={clip.trimStart} min={0} max={clip.duration} step={0.1} unit="초"
              onChange={(v) => update(clip.id, { trimStart: Math.min(v, clip.trimEnd - 0.1) })} />
            <Range label="끝 트림" badge={formatTime(clip.trimEnd)} value={clip.trimEnd} min={0} max={clip.duration} step={0.1} unit="초"
              onChange={(v) => update(clip.id, { trimEnd: Math.max(v, clip.trimStart + 0.1) })} />
          </div>
        </InspectorBlock>
        {clip.kind === 'video' && <InspectorBlock title="속도"><SpeedRow speed={clip.speed} onPatch={patch} /></InspectorBlock>}
        <InspectorBlock title="페이드"><FadeRow length={clipTimelineDuration(clip)} fadeIn={clip.fadeIn} fadeOut={clip.fadeOut} onPatch={patch} label="화면·소리 페이드" /></InspectorBlock>
        <InspectorBlock title="길이와 반복">
          <RepeatRow repeat={clip.repeat} onPatch={patch} />
          <DurationRow seconds={clipTimelineDuration(clip)} onSet={(t) => update(clip.id, exactDurationPatch((clip.trimEnd - clip.trimStart) / clip.speed, t))} />
        </InspectorBlock>
      </>}
      {tab === 'audio' && clip.kind === 'video' && <InspectorBlock title="클립 오디오"><VolumeRow volume={clip.volume} muted={clip.muted} onPatch={patch} /></InspectorBlock>}
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

  return (
    <div className="inspector__body">
      {tab === 'basic' && <>
        <InspectorBlock title="기본 정보">
          <div className="inspector__group">
            <NameField icon={<Icon name={ov.kind === 'image' ? 'image' : 'layers'} />} name={ov.name} onChange={(v) => update(ov.id, { name: v })} />
            <div className="inspector__hint">레이어 · 길이 {formatTime(overlayLength(ov))}</div>
          </div>
        </InspectorBlock>
        <InspectorBlock title="레이어 상태">
          <LayerStateRow opacity={ov.opacity} locked={ov.locked} hidden={ov.hidden} onPatch={patch}
            onCenter={(axis) => updatePosition('overlay', ov.id, { ...(axis !== 'y' ? { x: 0.5 } : {}), ...(axis !== 'x' ? { y: 0.5 } : {}) })} />
        </InspectorBlock>
        <InspectorBlock title="레이어 위치">
          <div className="inspector__group btnrow">
            <button className="btn" disabled={idx <= 0} onClick={() => raise(ov.id, -1)}>▼ 아래로</button>
            <button className="btn" disabled={idx >= visualOrder.length - 1} onClick={() => raise(ov.id, 1)}>위로 ▲</button>
          </div>
          <button className="btn" onClick={() => toMain(ov.id)}><Icon name="video" />메인 트랙으로 이동</button>
        </InspectorBlock>
        <button className="btn btn--danger" onClick={() => remove(ov.id)}>레이어 삭제</button>
      </>}
      {tab === 'transform' && <>
        <InspectorBlock title="위치와 크기">
          <div className="inspector__group">
            <Range label="가로 위치" value={Math.round(position.x * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => updatePosition('overlay', ov.id, { x: v / 100 })} />
            <Range label="세로 위치" value={Math.round(position.y * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => updatePosition('overlay', ov.id, { y: v / 100 })} />
            <Range label="가로 크기" value={Math.round(ov.scale * 100)} min={10} max={100} step={1} unit="%" onChange={(v) => update(ov.id, { scale: v / 100 })} />
            {ov.scaleY != null && !(ov.aspectLocked ?? true) && <Range label="세로 크기" value={Math.round(ov.scaleY * 100)} min={5} max={100} step={1} unit="%" onChange={(v) => update(ov.id, { scaleY: v / 100 })} />}
            <button className={`btn btn--sm${ov.aspectLocked ?? true ? ' btn--on' : ''}`} onClick={() => update(ov.id, ov.aspectLocked ?? true
              ? { aspectLocked: false }
              : { aspectLocked: true, scaleY: undefined })}>
              <Icon name={ov.aspectLocked ?? true ? 'lock' : 'unlock'} />비율 {ov.aspectLocked ?? true ? '고정' : '자유'}
            </button>
          </div>
        </InspectorBlock>
        <InspectorBlock title="회전과 반전">
          <TransformRow rotate={ov.rotate} flipH={ov.flipH} flipV={ov.flipV} onPatch={patch} />
          <div className="inspector__group"><Range label="자유 회전" value={ov.angle || 0} min={-180} max={180} step={1} unit="°" onChange={(v) => update(ov.id, { angle: v })} /></div>
        </InspectorBlock>
        <InspectorBlock title="자르기"><CropRow crop={ov.crop} onPatch={patch} onOpen={onOpenCrop} /></InspectorBlock>
        <InspectorBlock title="움직임">
          <PositionKeyframeRow frames={ov.positionKeyframes} localTime={localTime}
            onToggle={() => togglePositionKeyframe('overlay', ov.id)}
            onClear={() => clearPositionKeyframes('overlay', ov.id)}
            onSeek={(frame) => setPlayhead(ov.start + frame.time)}
            onEasing={(keyframeId, easing) => setPositionKeyframeEasing('overlay', ov.id, keyframeId, easing)} />
        </InspectorBlock>
      </>}
      {tab === 'style' && <>
        <InspectorBlock title="마스크 모양">
          <div className="mask-picker" role="radiogroup" aria-label="오버레이 마스크 모양">
            {MASK_OPTIONS.map((option) => (
              <button type="button" role="radio" aria-checked={visualStyle.maskShape === option.value} key={option.value}
                className={visualStyle.maskShape === option.value ? 'is-active' : ''}
                onClick={() => update(ov.id, { maskShape: option.value })}>
                <MaskIcon shape={option.value} />
                <span>{option.label}</span>
              </button>
            ))}
          </div>
          <div className="inspector__hint">마스크는 원본을 지우지 않고 보이는 모양만 바꿉니다.</div>
        </InspectorBlock>
        <InspectorBlock title="테두리">
          <div className="inspector__group">
            <Range label="굵기" value={Math.round(visualStyle.borderWidth * 720)} min={0} max={40} step={1} unit="px"
              onChange={(value) => update(ov.id, { borderWidth: value / 720 })} />
            <ColorControl label="색상" value={visualStyle.borderColor} onChange={(borderColor) => update(ov.id, { borderColor })} />
            <label className="style-select">
              <span>선 스타일</span>
              <select value={visualStyle.borderStyle} onChange={(event) => update(ov.id, { borderStyle: event.target.value as OverlayBorderStyle })}>
                <option value="solid">실선</option>
                <option value="dashed">긴 점선</option>
                <option value="dotted">둥근 점선</option>
                <option value="double">이중선</option>
              </select>
            </label>
          </div>
        </InspectorBlock>
        <InspectorBlock title="그림자">
          <div className="inspector__group">
            <label className="switch">
              <input type="checkbox" checked={visualStyle.shadowEnabled} onChange={(event) => update(ov.id, { shadowEnabled: event.target.checked })} />
              <span>그림자 사용</span>
            </label>
            {visualStyle.shadowEnabled && <>
              <ColorControl label="색상" value={visualStyle.shadowColor} onChange={(shadowColor) => update(ov.id, { shadowColor })} />
              <Range label="불투명도" value={Math.round(visualStyle.shadowOpacity * 100)} min={0} max={100} step={1} unit="%"
                onChange={(value) => update(ov.id, { shadowOpacity: value / 100 })} />
              <Range label="흐림" value={Math.round(visualStyle.shadowBlur * 720)} min={0} max={40} step={1} unit="px"
                onChange={(value) => update(ov.id, { shadowBlur: value / 720 })} />
              <Range label="가로 위치" value={Math.round(visualStyle.shadowX * 720)} min={-40} max={40} step={1} unit="px"
                onChange={(value) => update(ov.id, { shadowX: value / 720 })} />
              <Range label="세로 위치" value={Math.round(visualStyle.shadowY * 720)} min={-40} max={40} step={1} unit="px"
                onChange={(value) => update(ov.id, { shadowY: value / 720 })} />
            </>}
          </div>
        </InspectorBlock>
        <button className="btn" onClick={() => update(ov.id, { ...OVERLAY_STYLE_DEFAULTS })}>스타일 초기화</button>
      </>}
      {tab === 'time' && <>
        <InspectorBlock title="트림">
          <div className="inspector__group">
            <Range label="시작 트림" badge={formatTime(ov.trimStart)} value={ov.trimStart} min={0} max={ov.duration} step={0.1} unit="초"
              onChange={(v) => update(ov.id, { trimStart: Math.min(v, ov.trimEnd - 0.1) })} />
            <Range label="끝 트림" badge={formatTime(ov.trimEnd)} value={ov.trimEnd} min={0} max={ov.duration} step={0.1} unit="초"
              onChange={(v) => update(ov.id, { trimEnd: Math.max(v, ov.trimStart + 0.1) })} />
          </div>
        </InspectorBlock>
        {ov.kind === 'video' && <InspectorBlock title="속도"><SpeedRow speed={ov.speed} onPatch={patch} /></InspectorBlock>}
        <InspectorBlock title="페이드"><FadeRow length={overlayLength(ov)} fadeIn={ov.fadeIn} fadeOut={ov.fadeOut} onPatch={patch} label="화면·소리 페이드" /></InspectorBlock>
        <InspectorBlock title="길이와 반복">
          <RepeatRow repeat={ov.repeat} onPatch={patch} />
          <DurationRow seconds={overlayLength(ov)} onSet={(t) => update(ov.id, exactDurationPatch((ov.trimEnd - ov.trimStart) / ov.speed, t))} />
        </InspectorBlock>
      </>}
      {tab === 'audio' && ov.kind === 'video' && <InspectorBlock title="레이어 오디오"><VolumeRow volume={ov.volume} muted={ov.muted} onPatch={patch} /></InspectorBlock>}
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
        <InspectorBlock title="기본 정보">
          <div className="inspector__group">
            <NameField icon={<Icon name="music" />} name={audio.name} onChange={(v) => update(audio.id, { name: v })} />
            <div className="inspector__hint">오디오 · 길이 {formatTime(audioLength(audio))} · 원본 {formatTime(audio.duration)}</div>
          </div>
        </InspectorBlock>
        <InspectorBlock title="음량"><VolumeRow volume={audio.volume} muted={audio.muted} onPatch={(p) => update(audio.id, p)} /></InspectorBlock>
        <InspectorBlock title="페이드"><FadeRow length={audioLength(audio)} fadeIn={audio.fadeIn} fadeOut={audio.fadeOut} onPatch={(p) => update(audio.id, p)} label="소리 페이드" /></InspectorBlock>
        <button className="btn btn--danger" onClick={() => remove(audio.id)}>오디오 삭제</button>
      </>}
      {tab === 'time' && <>
        <InspectorBlock title="트림">
          <div className="inspector__group">
            <Range label="시작 트림" badge={formatTime(audio.trimStart)} value={audio.trimStart} min={0} max={audio.duration} step={0.1} unit="초"
              onChange={(v) => update(audio.id, { trimStart: Math.min(v, audio.trimEnd - 0.1) })} />
            <Range label="끝 트림" badge={formatTime(audio.trimEnd)} value={audio.trimEnd} min={0} max={audio.duration} step={0.1} unit="초"
              onChange={(v) => update(audio.id, { trimEnd: Math.max(v, audio.trimStart + 0.1) })} />
          </div>
        </InspectorBlock>
        <InspectorBlock title="길이와 반복">
          <RepeatRow repeat={audio.repeat} onPatch={(p) => update(audio.id, p)} />
          {mainLength > 0 && <button className="btn btn--sm" onClick={() => update(audio.id, { start: 0, ...exactDurationPatch(Math.max(0.1, base), mainLength) })}>메인 트랙 전체 길이에 맞춤</button>}
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
        <InspectorBlock title="내용">
          <div className="inspector__group"><textarea className="textarea" rows={3} value={text.text} onChange={(e) => set({ text: e.target.value })} aria-label="텍스트 내용" /></div>
        </InspectorBlock>
        <InspectorBlock title="글꼴">
          <div className="inspector__group"><FontPicker value={text.font} onChange={(font) => set({ font })} /></div>
        </InspectorBlock>
        <InspectorBlock title="정렬">
          <div className="inspector__group"><div className="chips">{ALIGNS.map((align) => (
            <button key={align} className={`chip chip--icon${text.align === align ? ' chip--on' : ''}`} aria-label={align} onClick={() => set({ align })}><AlignIcon a={align} /></button>
          ))}</div></div>
        </InspectorBlock>
        <button className="btn btn--danger" onClick={() => remove(text.id)}>텍스트 삭제</button>
      </>}
      {tab === 'transform' && <>
        <InspectorBlock title="위치와 크기">
          <div className="inspector__group">
            <Range label="가로 위치" value={Math.round(position.x * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => updatePosition('text', text.id, { x: v / 100 })} />
            <Range label="세로 위치" value={Math.round(position.y * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => updatePosition('text', text.id, { y: v / 100 })} />
            <Range label="글자 크기" value={Math.round(text.size * 1000)} min={20} max={400} step={5} onChange={(v) => set({ size: v / 1000 })} />
            <Range label="회전" value={text.angle || 0} min={-180} max={180} step={1} unit="°" onChange={(v) => set({ angle: v })} />
            <div className="inspector__hint">미리보기에서 직접 이동·크기·회전을 조절할 수도 있습니다.</div>
          </div>
        </InspectorBlock>
        <InspectorBlock title="레이어 상태">
          <LayerStateRow opacity={text.opacity} locked={text.locked} hidden={text.hidden} onPatch={(patch) => set(patch as Partial<TextOverlay>)} onCenter={(axis) => updatePosition('text', text.id, { ...(axis !== 'y' ? { x: 0.5 } : {}), ...(axis !== 'x' ? { y: 0.5 } : {}) })} />
        </InspectorBlock>
        <InspectorBlock title="움직임">
          <PositionKeyframeRow frames={text.positionKeyframes} localTime={localTime} onToggle={() => togglePositionKeyframe('text', text.id)} onClear={() => clearPositionKeyframes('text', text.id)} onSeek={(frame) => setPlayhead(text.start + frame.time)} onEasing={(keyframeId, easing) => setPositionKeyframeEasing('text', text.id, keyframeId, easing)} />
        </InspectorBlock>
        <InspectorBlock title="레이어 순서">
          <div className="inspector__group btnrow"><button className="btn" disabled={idx <= 0} onClick={() => raise(text.id, -1)}>▼ 아래로</button><button className="btn" disabled={idx >= visualOrder.length - 1} onClick={() => raise(text.id, 1)}>위로 ▲</button></div>
        </InspectorBlock>
      </>}
      {tab === 'style' && <>
        <InspectorBlock title="글자색">
          <div className="inspector__group"><div className="inspector__row"><label className="field__label"><span>색상</span></label><input type="color" value={text.color} onChange={(e) => set({ color: e.target.value })} /></div><Range label="불투명도" value={Math.round(text.colorAlpha * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => set({ colorAlpha: v / 100 })} /></div>
        </InspectorBlock>
        <InspectorBlock title="배경 박스">
          <div className="inspector__group"><label className="switch"><input type="checkbox" checked={text.box} onChange={(e) => set({ box: e.target.checked })} /><span>배경 박스 사용</span></label>{text.box && <><div className="inspector__row"><label className="field__label"><span>배경색</span></label><input type="color" value={text.boxColor} onChange={(e) => set({ boxColor: e.target.value })} /></div><Range label="불투명도" value={Math.round(text.boxAlpha * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => set({ boxAlpha: v / 100 })} /></>}</div>
        </InspectorBlock>
        <InspectorBlock title="테두리">
          <div className="inspector__group"><Range label="두께" value={Number((text.strokeWidth * 100).toFixed(1))} min={0} max={15} step={0.1} onChange={(v) => set({ strokeWidth: v / 100 })} />{text.strokeWidth > 0 && <div className="inspector__row"><label className="field__label"><span>색상</span></label><input type="color" value={text.strokeColor} onChange={(e) => set({ strokeColor: e.target.value })} /></div>}</div>
        </InspectorBlock>
        <InspectorBlock title="그림자">
          <div className="inspector__group"><label className="switch"><input type="checkbox" checked={text.shadow} onChange={(e) => set({ shadow: e.target.checked })} /><span>그림자 사용</span></label>{text.shadow && <><div className="inspector__row"><label className="field__label"><span>색상</span></label><input type="color" value={text.shadowColor} onChange={(e) => set({ shadowColor: e.target.value })} /></div><Range label="번짐" value={Math.round(text.shadowBlur * 100)} min={0} max={40} step={1} unit="%" onChange={(v) => set({ shadowBlur: v / 100 })} /><Range label="거리" value={Math.round(text.shadowDist * 100)} min={0} max={30} step={1} unit="%" onChange={(v) => set({ shadowDist: v / 100 })} /></>}</div>
        </InspectorBlock>
      </>}
      {tab === 'time' && <>
        <InspectorBlock title="길이"><DurationRow seconds={text.end - text.start} onSet={(duration) => set({ end: text.start + duration })} /></InspectorBlock>
        <InspectorBlock title="페이드"><FadeRow length={text.end - text.start} fadeIn={text.fadeIn} fadeOut={text.fadeOut} onPatch={(patch) => set(patch as Partial<TextOverlay>)} label="텍스트 페이드" /></InspectorBlock>
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
        <InspectorBlock title="기본 정보">
          <div className="inspector__group"><NameField icon={<Icon name="palette" />} name={bg.name} onChange={(v) => update(bg.id, { name: v })} /><div className="inspector__hint">배경 레이어 · 길이 {formatTime(clipTimelineDuration(bg))}</div></div>
        </InspectorBlock>
        {bg.kind === 'color' && <InspectorBlock title="색상"><div className="inspector__group inspector__row"><label className="field__label"><span>배경 색상</span></label><input type="color" value={bg.bgColor ?? '#000000'} onChange={(e) => update(bg.id, { bgColor: e.target.value })} /></div></InspectorBlock>}
        {bg.kind === 'video' && <InspectorBlock title="오디오"><VolumeRow volume={bg.volume} muted={bg.muted} onPatch={patch} /></InspectorBlock>}
        <InspectorBlock title="레이어 상태"><LayerStateRow opacity={bg.opacity} locked={bg.locked} hidden={bg.hidden} onPatch={patch} /></InspectorBlock>
        <InspectorBlock title="레이어 위치"><div className="inspector__group btnrow"><button className="btn" disabled={idx <= 0} onClick={() => raise(bg.id, -1)}>▼ 아래로</button><button className="btn" disabled={idx >= backgrounds.length - 1} onClick={() => raise(bg.id, 1)}>위로 ▲</button></div><button className="btn" onClick={() => toMain(bg.id)}><Icon name="video" />메인 트랙으로 이동</button></InspectorBlock>
        <button className="btn btn--danger" onClick={() => remove(bg.id)}>배경 삭제</button>
      </>}
      {tab === 'time' && <>
        {bg.kind !== 'color' && <InspectorBlock title="트림"><div className="inspector__group"><Range label="시작 트림" badge={formatTime(bg.trimStart)} value={bg.trimStart} min={0} max={bg.duration} step={0.1} unit="초" onChange={(v) => update(bg.id, { trimStart: Math.min(v, bg.trimEnd - 0.1) })} /><Range label="끝 트림" badge={formatTime(bg.trimEnd)} value={bg.trimEnd} min={0} max={bg.duration} step={0.1} unit="초" onChange={(v) => update(bg.id, { trimEnd: Math.max(v, bg.trimStart + 0.1) })} /></div></InspectorBlock>}
        <InspectorBlock title="페이드"><FadeRow length={clipTimelineDuration(bg)} fadeIn={bg.fadeIn} fadeOut={bg.fadeOut} onPatch={patch} label="배경 페이드" /></InspectorBlock>
        <InspectorBlock title="길이와 반복"><RepeatRow repeat={bg.repeat} onPatch={patch} /><DurationRow seconds={clipTimelineDuration(bg)} onSet={(duration) => update(bg.id, exactDurationPatch((bg.trimEnd - bg.trimStart) / bg.speed, duration))} /></InspectorBlock>
      </>}
    </div>
  )
}

export default function Inspector({ onOpenCrop }: { onOpenCrop: () => void }) {
  const selection = useEditor((s) => s.selection)
  const selectedItems = useEditor((s) => s.selectedItems)
  const clips = useEditor((s) => s.clips)
  const overlays = useEditor((s) => s.overlays)
  const audios = useEditor((s) => s.audios)
  const texts = useEditor((s) => s.texts)
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
  const selBg = selection?.type === 'background' ? backgrounds.find((b) => b.id === selection.id) : null
  const contextTitle = selectedItems.length > 1 ? `${selectedItems.length}개 항목 선택됨`
    : selClip?.name || selOverlay?.name || selAudio?.name || (selText ? '텍스트' : '') || selBg?.name || '캔버스'
  const groupedSelection = selectedItems.some((item) => groups.some((group) => group.members.some((member) => member.type === item.type && member.id === item.id)))
  const activeSelectionGroup = groups.find((group) => selectedItems.length > 1 && selectedItems.every((item) =>
    group.members.some((member) => member.type === item.type && member.id === item.id)))
  const inspectorTabs: InspectorTabOption[] = useMemo(() => selText
    ? [{ id: 'basic', label: '내용' }, { id: 'style', label: '스타일' }, { id: 'transform', label: '배치' }, { id: 'time', label: '시간' }]
    : selAudio
      ? [{ id: 'basic', label: '오디오' }, { id: 'time', label: '시간' }]
      : selOverlay
        ? [{ id: 'basic', label: '기본' }, { id: 'transform', label: '변형' }, { id: 'style', label: '스타일' }, { id: 'time', label: '시간' }, ...(selOverlay.kind === 'video' ? [{ id: 'audio' as const, label: '오디오' }] : [])]
        : selClip
          ? [{ id: 'basic', label: '기본' }, ...(selClip.kind === 'color' ? [] : [{ id: 'transform' as const, label: '변형' }]), { id: 'time', label: '시간' }, ...(selClip.kind === 'video' ? [{ id: 'audio' as const, label: '오디오' }] : [])]
          : selBg
            ? [{ id: 'basic', label: '기본' }, { id: 'time', label: '시간' }]
            : [], [selAudio, selBg, selClip, selOverlay, selText])
  const selectionKey = selection ? `${selection.type}:${selection.id}` : 'canvas'
  useEffect(() => { setActiveTab('basic') }, [selectionKey])
  useEffect(() => {
    if (inspectorTabs.length && !inspectorTabs.some((tab) => tab.id === activeTab)) setActiveTab(inspectorTabs[0].id)
  }, [activeTab, inspectorTabs])

  return (
    <aside className="inspector">
      <div className="inspector__context">
        <small>{selection ? '선택 항목 편집' : '프로젝트 설정'}</small>
        <b title={contextTitle}>{contextTitle}</b>
      </div>
      {!selection && <details className="inspector__section" open>
        <summary>캔버스</summary>
        <div className="inspector__group">
          <div className="field__label"><span>화면 비율</span></div>
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
            ? `'${activeSelectionGroup.name}'으로 연결된 항목입니다. 이동하거나 메인 클립 길이를 바꾸면 연결된 항목이 함께 조정됩니다.`
            : '선택한 항목은 타임라인에서 함께 이동할 수 있습니다. 그룹으로 묶으면 다음 편집에서도 관계가 유지됩니다.'}</div>
          {!activeSelectionGroup && <button className="btn btn--primary" onClick={groupSelected}>선택 항목 그룹 만들기</button>}
          {groupedSelection && <button className="btn" onClick={ungroupSelected}>그룹 해제</button>}
          <button className="btn btn--danger" onClick={deleteSelected}>선택 항목 삭제</button>
        </div>
      ) : selClip ? (
        <ClipInspector clip={selClip} tab={activeTab} onOpenCrop={onOpenCrop} />
      ) : selOverlay ? (
        <OverlayInspector ov={selOverlay} tab={activeTab} onOpenCrop={onOpenCrop} />
      ) : selAudio ? (
        <AudioInspector audio={selAudio} tab={activeTab} />
      ) : selText ? (
        <TextInspector text={selText} tab={activeTab} />
      ) : selBg ? (
        <BackgroundInspector bg={selBg} tab={activeTab} />
      ) : (
        <div className="inspector__empty">타임라인이나 미리보기에서 항목을 선택하면<br />여기서 편집할 수 있어요.</div>
      )}
    </aside>
  )
}
