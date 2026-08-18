import { useState, type ReactNode } from 'react'
import { useEditor } from '../store'
import type { Clip, TextOverlay, Overlay, AudioClip, Background, Crop, PositionKeyframe, KeyframeEasing } from '../types'
import { NO_CROP, FONT_OPTIONS } from '../types'
import { formatTime, formatClock, parseClock, clipTimelineDuration, overlayLength, audioLength, totalDuration } from '../utils/time'
import { rotateBy } from '../utils/transform'
import Icon from './Icon'
import { keyframeAt, positionAt } from '../utils/motion'

type Patch = Partial<Pick<Clip & Overlay,
  'rotate' | 'flipH' | 'flipV' | 'crop' | 'speed' | 'volume' | 'muted' | 'repeat' |
  'fadeIn' | 'fadeOut' | 'opacity' | 'locked' | 'hidden'>>

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

function RepeatRow({ repeat, onPatch, fitTo }: { repeat: number; onPatch: (p: { repeat: number }) => void; fitTo?: number }) {
  return (
    <Stepper label="반복 늘이기" badge={`×${repeat}`} value={repeat} min={1} max={99} step={1} fixed={0}
      onChange={(v) => onPatch({ repeat: Math.round(v) })}
      extra={fitTo !== undefined && fitTo > 0
        ? <button className="btn btn--sm" onClick={() => onPatch({ repeat: Math.max(1, Math.ceil(fitTo)) })}>영상 길이에 맞춤</button>
        : undefined} />
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

const CROP_SIDES: { key: keyof Crop; label: string }[] = [
  { key: 'top', label: '위' }, { key: 'bottom', label: '아래' },
  { key: 'left', label: '왼쪽' }, { key: 'right', label: '오른쪽' },
]
function CropRow({ crop, onPatch }: { crop: Crop; onPatch: (p: Patch) => void }) {
  const cropped = crop.top || crop.right || crop.bottom || crop.left
  return (
    <div className="inspector__group">
      <div className="field__label">
        <span>자르기 (크롭)</span>
        {cropped ? <button className="linkbtn" onClick={() => onPatch({ crop: NO_CROP })}>초기화</button> : null}
      </div>
      {CROP_SIDES.map(({ key, label }) => (
        <Range key={key} label={label} value={Math.round(crop[key] * 100)} min={0} max={45} step={1} unit="%"
          onChange={(v) => onPatch({ crop: { ...crop, [key]: v / 100 } })} />
      ))}
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
function ClipInspector({ clip }: { clip: Clip }) {
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
        <div className="inspector__group">
          <NameField icon={icon} name={clip.name} onChange={(v) => update(clip.id, { name: v })} />
          <div className="inspector__hint">단색 배경 · 길이 {formatTime(clipTimelineDuration(clip))}</div>
        </div>
        <div className="inspector__group inspector__row">
          <label className="field__label"><span>배경 색상</span></label>
          <input type="color" value={clip.bgColor ?? '#000000'} onChange={(e) => update(clip.id, { bgColor: e.target.value })} />
        </div>
        <div className="inspector__group">
          <Range label="길이" badge={formatTime(clip.trimEnd)} value={Math.min(clip.trimEnd, 60)} min={0.5} max={60} step={0.5} unit="초"
            onChange={(v) => update(clip.id, { trimEnd: v })} />
        </div>
        <FadeRow length={clipTimelineDuration(clip)} fadeIn={clip.fadeIn} fadeOut={clip.fadeOut} onPatch={patch} label="화면 페이드" />
        <RepeatRow repeat={clip.repeat} onPatch={patch} />
        <div className="inspector__group btnrow">
          <button className="btn" disabled={idx <= 0} onClick={() => move(clip.id, -1)}>← 앞으로</button>
          <button className="btn" disabled={idx >= clips.length - 1} onClick={() => move(clip.id, 1)}>뒤로 →</button>
        </div>
        <button className="btn btn--danger" onClick={() => remove(clip.id)}>배경 삭제</button>
      </div>
    )
  }

  return (
    <div className="inspector__body">
      <div className="inspector__group">
        <NameField icon={icon} name={clip.name} onChange={(v) => update(clip.id, { name: v })} />
        <div className="inspector__hint">길이 {formatTime(clipTimelineDuration(clip))} · 원본 {formatTime(clip.duration)}</div>
      </div>

      <div className="inspector__group">
        <Range label="시작 트림" badge={formatTime(clip.trimStart)} value={clip.trimStart} min={0} max={clip.duration} step={0.1} unit="초"
          onChange={(v) => update(clip.id, { trimStart: Math.min(v, clip.trimEnd - 0.1) })} />
        <Range label="끝 트림" badge={formatTime(clip.trimEnd)} value={clip.trimEnd} min={0} max={clip.duration} step={0.1} unit="초"
          onChange={(v) => update(clip.id, { trimEnd: Math.max(v, clip.trimStart + 0.1) })} />
      </div>

      <TransformRow rotate={clip.rotate} flipH={clip.flipH} flipV={clip.flipV} onPatch={patch} />
      <CropRow crop={clip.crop} onPatch={patch} />
      {clip.kind === 'video' && <SpeedRow speed={clip.speed} onPatch={patch} />}
      {clip.kind === 'video' && <VolumeRow volume={clip.volume} muted={clip.muted} onPatch={patch} />}
      <FadeRow length={clipTimelineDuration(clip)} fadeIn={clip.fadeIn} fadeOut={clip.fadeOut} onPatch={patch} label="화면·소리 페이드" />
      <RepeatRow repeat={clip.repeat} onPatch={patch} />
      <DurationRow
        seconds={clipTimelineDuration(clip)}
        onSet={(t) => {
          if (clip.kind === 'image') update(clip.id, { trimEnd: clip.trimStart + t })
          else update(clip.id, { repeat: Math.max(1, Math.round(t / ((clip.trimEnd - clip.trimStart) / clip.speed))) })
        }}
      />

      <div className="inspector__group btnrow">
        <button className="btn" disabled={idx <= 0} onClick={() => move(clip.id, -1)}>← 앞으로</button>
        <button className="btn" disabled={idx >= clips.length - 1} onClick={() => move(clip.id, 1)}>뒤로 →</button>
      </div>
      <button className="btn" onClick={() => toOverlay(clip.id)}><Icon name="layers" />오버레이 레이어로 이동</button>
      <button className="btn" onClick={() => toBackground(clip.id)}><Icon name="palette" />배경 레이어로 이동</button>
      <button className="btn btn--danger" onClick={() => remove(clip.id)}>클립 삭제</button>
    </div>
  )
}

// ---- overlay ----
function OverlayInspector({ ov }: { ov: Overlay }) {
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
  const idx = overlays.findIndex((o) => o.id === ov.id)
  const patch = (p: Patch) => update(ov.id, p)
  const localTime = Math.max(0, Math.min(playhead - ov.start, overlayLength(ov)))
  const position = positionAt(ov, localTime)

  return (
    <div className="inspector__body">
      <div className="inspector__group">
        <NameField icon={<Icon name={ov.kind === 'image' ? 'image' : 'layers'} />} name={ov.name} onChange={(v) => update(ov.id, { name: v })} />
        <div className="inspector__hint">오버레이 · 길이 {formatTime(overlayLength(ov))} · 미리보기에서 끌어 이동/크기조절</div>
      </div>

      <div className="inspector__group">
        <Range label="가로 위치" value={Math.round(position.x * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => updatePosition('overlay', ov.id, { x: v / 100 })} />
        <Range label="세로 위치" value={Math.round(position.y * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => updatePosition('overlay', ov.id, { y: v / 100 })} />
        <Range label="크기" value={Math.round(ov.scale * 100)} min={10} max={100} step={1} unit="%" onChange={(v) => update(ov.id, { scale: v / 100 })} />
      </div>
      <LayerStateRow opacity={ov.opacity} locked={ov.locked} hidden={ov.hidden} onPatch={patch}
        onCenter={(axis) => updatePosition('overlay', ov.id, { ...(axis !== 'y' ? { x: 0.5 } : {}), ...(axis !== 'x' ? { y: 0.5 } : {}) })} />
      <PositionKeyframeRow frames={ov.positionKeyframes} localTime={localTime}
        onToggle={() => togglePositionKeyframe('overlay', ov.id)}
        onClear={() => clearPositionKeyframes('overlay', ov.id)}
        onSeek={(frame) => setPlayhead(ov.start + frame.time)}
        onEasing={(keyframeId, easing) => setPositionKeyframeEasing('overlay', ov.id, keyframeId, easing)} />

      <div className="inspector__group">
        <Range label="시작 트림" badge={formatTime(ov.trimStart)} value={ov.trimStart} min={0} max={ov.duration} step={0.1} unit="초"
          onChange={(v) => update(ov.id, { trimStart: Math.min(v, ov.trimEnd - 0.1) })} />
        <Range label="끝 트림" badge={formatTime(ov.trimEnd)} value={ov.trimEnd} min={0} max={ov.duration} step={0.1} unit="초"
          onChange={(v) => update(ov.id, { trimEnd: Math.max(v, ov.trimStart + 0.1) })} />
      </div>

      <TransformRow rotate={ov.rotate} flipH={ov.flipH} flipV={ov.flipV} onPatch={patch} />
      <div className="inspector__group">
        <Range label="자유 회전" value={ov.angle || 0} min={-180} max={180} step={1} unit="°" onChange={(v) => update(ov.id, { angle: v })} />
      </div>
      <CropRow crop={ov.crop} onPatch={patch} />
      {ov.kind === 'video' && <SpeedRow speed={ov.speed} onPatch={patch} />}
      {ov.kind === 'video' && <VolumeRow volume={ov.volume} muted={ov.muted} onPatch={patch} />}
      <FadeRow length={overlayLength(ov)} fadeIn={ov.fadeIn} fadeOut={ov.fadeOut} onPatch={patch} label="화면·소리 페이드" />
      <RepeatRow repeat={ov.repeat} onPatch={patch} />
      <DurationRow
        seconds={overlayLength(ov)}
        onSet={(t) => {
          if (ov.kind === 'image') update(ov.id, { trimEnd: ov.trimStart + t })
          else update(ov.id, { repeat: Math.max(1, Math.round(t / ((ov.trimEnd - ov.trimStart) / ov.speed))) })
        }}
      />

      <div className="inspector__group btnrow">
        <button className="btn" disabled={idx <= 0} onClick={() => raise(ov.id, -1)}>▼ 아래로</button>
        <button className="btn" disabled={idx >= overlays.length - 1} onClick={() => raise(ov.id, 1)}>위로 ▲</button>
      </div>
      <button className="btn" onClick={() => toMain(ov.id)}><Icon name="video" />메인 트랙으로 이동</button>
      <button className="btn btn--danger" onClick={() => remove(ov.id)}>오버레이 삭제</button>
    </div>
  )
}

// ---- audio ----
function AudioInspector({ audio }: { audio: AudioClip }) {
  const update = useEditor((s) => s.updateAudio)
  const remove = useEditor((s) => s.removeAudio)
  const clips = useEditor((s) => s.clips)
  const base = audio.trimEnd - audio.trimStart
  const fitTo = base > 0 ? totalDuration(clips) / base : 0

  return (
    <div className="inspector__body">
      <div className="inspector__group">
        <NameField icon={<Icon name="music" />} name={audio.name} onChange={(v) => update(audio.id, { name: v })} />
        <div className="inspector__hint">음악 · 길이 {formatTime(audioLength(audio))} · 원본 {formatTime(audio.duration)}</div>
      </div>

      <div className="inspector__group">
        <Range label="시작 트림" badge={formatTime(audio.trimStart)} value={audio.trimStart} min={0} max={audio.duration} step={0.1} unit="초"
          onChange={(v) => update(audio.id, { trimStart: Math.min(v, audio.trimEnd - 0.1) })} />
        <Range label="끝 트림" badge={formatTime(audio.trimEnd)} value={audio.trimEnd} min={0} max={audio.duration} step={0.1} unit="초"
          onChange={(v) => update(audio.id, { trimEnd: Math.max(v, audio.trimStart + 0.1) })} />
      </div>

      <VolumeRow volume={audio.volume} muted={audio.muted} onPatch={(p) => update(audio.id, p)} />
      <FadeRow length={audioLength(audio)} fadeIn={audio.fadeIn} fadeOut={audio.fadeOut} onPatch={(p) => update(audio.id, p)} label="소리 페이드" />
      <RepeatRow repeat={audio.repeat} onPatch={(p) => update(audio.id, p)} fitTo={fitTo} />
      <DurationRow seconds={audioLength(audio)} onSet={(t) => update(audio.id, { repeat: Math.max(1, Math.round(t / Math.max(0.1, base))) })} />
      <button className="btn btn--danger" onClick={() => remove(audio.id)}>음악 삭제</button>
    </div>
  )
}

// ---- text ----
const ALIGNS: TextOverlay['align'][] = ['left', 'center', 'right', 'justify']
function TextInspector({ text }: { text: TextOverlay }) {
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
  const idx = texts.findIndex((t) => t.id === text.id)
  const set = (p: Partial<TextOverlay>) => update(text.id, p)
  const localTime = Math.max(0, Math.min(playhead - text.start, text.end - text.start))
  const position = positionAt(text, localTime)

  return (
    <div className="inspector__body">
      <div className="inspector__group">
        <div className="inspector__title">텍스트</div>
        <textarea className="textarea" rows={2} value={text.text} onChange={(e) => set({ text: e.target.value })} />
      </div>

      <div className="inspector__group">
        <div className="field__label"><span>폰트</span></div>
        <div className="chips">
          {FONT_OPTIONS.map((f) => (
            <button key={f.label} className={`chip${text.font === f.value ? ' chip--on' : ''}`} style={{ fontFamily: f.value }}
              onClick={() => set({ font: f.value })}>{f.label}</button>
          ))}
        </div>
      </div>

      <div className="inspector__group">
        <div className="field__label"><span>정렬</span></div>
        <div className="chips">
          {ALIGNS.map((a) => (
            <button key={a} className={`chip chip--icon${text.align === a ? ' chip--on' : ''}`}
              aria-label={a} onClick={() => set({ align: a })}><AlignIcon a={a} /></button>
          ))}
        </div>
      </div>

      <div className="inspector__group">
        <Range label="가로 위치" value={Math.round(position.x * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => updatePosition('text', text.id, { x: v / 100 })} />
        <Range label="세로 위치" value={Math.round(position.y * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => updatePosition('text', text.id, { y: v / 100 })} />
        <Range label="글자 크기" value={Math.round(text.size * 1000)} min={20} max={400} step={5} onChange={(v) => set({ size: v / 1000 })} />
        <Range label="회전" value={text.angle || 0} min={-180} max={180} step={1} unit="°" onChange={(v) => set({ angle: v })} />
        <div className="inspector__hint">미리보기에서 글자를 끌어 이동하고 모서리와 회전 손잡이로 조절합니다.</div>
      </div>
      <LayerStateRow opacity={text.opacity} locked={text.locked} hidden={text.hidden}
        onPatch={(patch) => set(patch as Partial<TextOverlay>)}
        onCenter={(axis) => updatePosition('text', text.id, { ...(axis !== 'y' ? { x: 0.5 } : {}), ...(axis !== 'x' ? { y: 0.5 } : {}) })} />
      <PositionKeyframeRow frames={text.positionKeyframes} localTime={localTime}
        onToggle={() => togglePositionKeyframe('text', text.id)}
        onClear={() => clearPositionKeyframes('text', text.id)}
        onSeek={(frame) => setPlayhead(text.start + frame.time)}
        onEasing={(keyframeId, easing) => setPositionKeyframeEasing('text', text.id, keyframeId, easing)} />

      <div className="inspector__group">
        <div className="inspector__row">
          <label className="field__label"><span>글자색</span></label>
          <input type="color" value={text.color} onChange={(e) => set({ color: e.target.value })} />
        </div>
        <Range label="글자 불투명도" value={Math.round(text.colorAlpha * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => set({ colorAlpha: v / 100 })} />
      </div>

      <div className="inspector__group">
        <label className="switch"><input type="checkbox" checked={text.box} onChange={(e) => set({ box: e.target.checked })} /><span>배경 박스</span></label>
        {text.box && (
          <>
            <div className="inspector__row">
              <label className="field__label"><span>배경색</span></label>
              <input type="color" value={text.boxColor} onChange={(e) => set({ boxColor: e.target.value })} />
            </div>
            <Range label="배경 불투명도" value={Math.round(text.boxAlpha * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => set({ boxAlpha: v / 100 })} />
          </>
        )}
      </div>

      <div className="inspector__group">
        <Range label="테두리 두께" value={Number((text.strokeWidth * 100).toFixed(1))} min={0} max={15} step={0.1} onChange={(v) => set({ strokeWidth: v / 100 })} />
        {text.strokeWidth > 0 && (
          <div className="inspector__row">
            <label className="field__label"><span>테두리 색</span></label>
            <input type="color" value={text.strokeColor} onChange={(e) => set({ strokeColor: e.target.value })} />
          </div>
        )}
      </div>

      <div className="inspector__group">
        <label className="switch"><input type="checkbox" checked={text.shadow} onChange={(e) => set({ shadow: e.target.checked })} /><span>그림자</span></label>
        <div className="inspector__hint">글자 뒤에 그림자를 넣습니다.</div>
        {text.shadow && (
          <>
            <div className="inspector__row">
              <label className="field__label"><span>그림자 색</span></label>
              <input type="color" value={text.shadowColor} onChange={(e) => set({ shadowColor: e.target.value })} />
            </div>
            <Range label="번짐 (흐림 정도)" value={Math.round(text.shadowBlur * 100)} min={0} max={40} step={1} unit="%" onChange={(v) => set({ shadowBlur: v / 100 })} />
            <Range label="거리 (아래로 이동)" value={Math.round(text.shadowDist * 100)} min={0} max={30} step={1} unit="%" onChange={(v) => set({ shadowDist: v / 100 })} />
          </>
        )}
      </div>

      <DurationRow seconds={text.end - text.start} onSet={(t) => set({ end: text.start + t })} />
      <FadeRow length={text.end - text.start} fadeIn={text.fadeIn} fadeOut={text.fadeOut}
        onPatch={(patch) => set(patch as Partial<TextOverlay>)} label="텍스트 페이드" />

      <div className="inspector__group btnrow">
        <button className="btn" disabled={idx <= 0} onClick={() => raise(text.id, -1)}>▼ 아래로</button>
        <button className="btn" disabled={idx >= texts.length - 1} onClick={() => raise(text.id, 1)}>위로 ▲</button>
      </div>
      <button className="btn btn--danger" onClick={() => remove(text.id)}>텍스트 삭제</button>
    </div>
  )
}

// ---- background layer ----
function BackgroundInspector({ bg }: { bg: Background }) {
  const update = useEditor((s) => s.updateBackground)
  const remove = useEditor((s) => s.removeBackground)
  const raise = useEditor((s) => s.raiseBackground)
  const toMain = useEditor((s) => s.moveBackgroundToMain)
  const backgrounds = useEditor((s) => s.backgrounds)
  const idx = backgrounds.findIndex((b) => b.id === bg.id)
  const patch = (p: Patch) => update(bg.id, p)

  return (
    <div className="inspector__body">
      <div className="inspector__group">
        <NameField icon={<Icon name="palette" />} name={bg.name} onChange={(v) => update(bg.id, { name: v })} />
        <div className="inspector__hint">배경 레이어(맨 뒤) · 길이 {formatTime(clipTimelineDuration(bg))}</div>
      </div>

      {bg.kind === 'color' ? (
        <div className="inspector__group inspector__row">
          <label className="field__label"><span>배경 색상</span></label>
          <input type="color" value={bg.bgColor ?? '#000000'} onChange={(e) => update(bg.id, { bgColor: e.target.value })} />
        </div>
      ) : (
        <div className="inspector__group">
          <Range label="시작 트림" badge={formatTime(bg.trimStart)} value={bg.trimStart} min={0} max={bg.duration} step={0.1} unit="초"
            onChange={(v) => update(bg.id, { trimStart: Math.min(v, bg.trimEnd - 0.1) })} />
          <Range label="끝 트림" badge={formatTime(bg.trimEnd)} value={bg.trimEnd} min={0} max={bg.duration} step={0.1} unit="초"
            onChange={(v) => update(bg.id, { trimEnd: Math.max(v, bg.trimStart + 0.1) })} />
        </div>
      )}

      {bg.kind === 'video' && <VolumeRow volume={bg.volume} muted={bg.muted} onPatch={patch} />}
      <LayerStateRow opacity={bg.opacity} locked={bg.locked} hidden={bg.hidden} onPatch={patch} />
      <FadeRow length={clipTimelineDuration(bg)} fadeIn={bg.fadeIn} fadeOut={bg.fadeOut} onPatch={patch} label="배경 페이드" />
      <RepeatRow repeat={bg.repeat} onPatch={patch} />
      <DurationRow
        seconds={clipTimelineDuration(bg)}
        onSet={(t) => {
          if (bg.kind === 'video') update(bg.id, { repeat: Math.max(1, Math.round(t / ((bg.trimEnd - bg.trimStart) / bg.speed))) })
          else update(bg.id, { trimEnd: bg.trimStart + t })
        }}
      />

      <div className="inspector__group btnrow">
        <button className="btn" disabled={idx <= 0} onClick={() => raise(bg.id, -1)}>▼ 아래로</button>
        <button className="btn" disabled={idx >= backgrounds.length - 1} onClick={() => raise(bg.id, 1)}>위로 ▲</button>
      </div>
      <button className="btn" onClick={() => toMain(bg.id)}><Icon name="video" />메인 트랙으로 이동</button>
      <button className="btn btn--danger" onClick={() => remove(bg.id)}>배경 삭제</button>
    </div>
  )
}

export default function Inspector() {
  const selection = useEditor((s) => s.selection)
  const clips = useEditor((s) => s.clips)
  const overlays = useEditor((s) => s.overlays)
  const audios = useEditor((s) => s.audios)
  const texts = useEditor((s) => s.texts)
  const backgrounds = useEditor((s) => s.backgrounds)
  const aspectRatio = useEditor((s) => s.aspectRatio)
  const setAspectRatio = useEditor((s) => s.setAspectRatio)

  const selClip = selection?.type === 'clip' ? clips.find((c) => c.id === selection.id) : null
  const selOverlay = selection?.type === 'overlay' ? overlays.find((o) => o.id === selection.id) : null
  const selAudio = selection?.type === 'audio' ? audios.find((a) => a.id === selection.id) : null
  const selText = selection?.type === 'text' ? texts.find((t) => t.id === selection.id) : null
  const selBg = selection?.type === 'background' ? backgrounds.find((b) => b.id === selection.id) : null

  return (
    <aside className="inspector">
      <div className="inspector__group">
        <div className="field__label"><span>화면 비율</span></div>
        <div className="chips">
          {(['16:9', '9:16', '1:1'] as const).map((r) => (
            <button key={r} className={`chip${aspectRatio === r ? ' chip--on' : ''}`} onClick={() => setAspectRatio(r)}>{r}</button>
          ))}
        </div>
      </div>
      <hr className="inspector__sep" />
      {selClip ? (
        <ClipInspector clip={selClip} />
      ) : selOverlay ? (
        <OverlayInspector ov={selOverlay} />
      ) : selAudio ? (
        <AudioInspector audio={selAudio} />
      ) : selText ? (
        <TextInspector text={selText} />
      ) : selBg ? (
        <BackgroundInspector bg={selBg} />
      ) : (
        <div className="inspector__empty">타임라인이나 미리보기에서 항목을 선택하면<br />여기서 편집할 수 있어요.</div>
      )}
    </aside>
  )
}
