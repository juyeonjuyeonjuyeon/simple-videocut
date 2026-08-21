// ---- Core editing data model ----

/** Supported output aspect ratios. */
export type AspectRatio = '16:9' | '9:16' | '1:1'

export type VisualKind = 'video' | 'image' | 'color'

export type Rotation = 0 | 90 | 180 | 270

/** Crop insets as a fraction (0..0.45) of each side. */
export interface Crop {
  top: number
  right: number
  bottom: number
  left: number
}

/** A named point on the shared timeline used for navigation and snapping. */
export interface TimelineMarker {
  id: string
  time: number
  label: string
  color: string
}

export type KeyframeEasing = 'linear' | 'ease-in-out'

/** Position automation shared by picture-in-picture and text layers. */
export interface PositionKeyframe {
  id: string
  /** Seconds from the owning layer's timeline start. */
  time: number
  x: number
  y: number
  easing: KeyframeEasing
}

export const NO_CROP: Crop = { top: 0, right: 0, bottom: 0, left: 0 }

/** Visual transform shared by clips and overlays. */
export interface Transform {
  rotate: Rotation
  flipH: boolean
  flipV: boolean
  crop: Crop
}

/** A reusable source kept in the project media bin independently of timeline usage. */
export interface MediaAsset {
  id: string
  kind: 'video' | 'image' | 'audio'
  name: string
  src: string
  file: File
  sourceSize: number
  nativeMediaId?: string
  duration: number
  hasAudio: boolean
}

/** A clip on the MAIN track: video or image, packed sequentially, full-frame. */
export interface Clip {
  id: string
  /** Source in the project media bin, when available. */
  assetId?: string
  kind: VisualKind
  name: string
  /** Object URL for the source File. */
  src: string
  file: File
  /** Original byte size, also available when desktop restore uses a lightweight placeholder File. */
  sourceSize: number
  /** Opaque desktop media-library identifier. Never contains a user filesystem path. */
  nativeMediaId?: string
  /** Source duration (seconds). For images this is a nominal max length. */
  duration: number
  /** Trim in/out within the source (seconds). For images: 0..displayLength. */
  trimStart: number
  trimEnd: number
  /** Playback speed (video only). */
  speed: number
  /** Volume 0..2 (above 1 boosts via WebAudio). */
  volume: number
  muted: boolean
  hasAudio: boolean
  color: string
  rotate: Rotation
  flipH: boolean
  flipV: boolean
  crop: Crop
  /** Number of times the trimmed segment repeats back-to-back (>=1). */
  repeat: number
  /** Exact occupied timeline length. When set, the final repeat is cut short. */
  timelineDuration?: number
  /** Non-destructive fade at the beginning/end of this timeline segment. */
  fadeIn?: number
  fadeOut?: number
  /** Solid background color when kind === 'color'. */
  bgColor?: string
}

/** A picture-in-picture overlay (video or image) floating over the main track. */
export interface Overlay {
  id: string
  assetId?: string
  kind: VisualKind
  name: string
  src: string
  file: File
  sourceSize: number
  nativeMediaId?: string
  duration: number
  trimStart: number
  trimEnd: number
  speed: number
  volume: number
  muted: boolean
  hasAudio: boolean
  color: string
  /** Timeline start time (seconds). */
  start: number
  /** Center position relative to the frame, 0..1. */
  x: number
  y: number
  /** Width as a fraction of the frame width, 0..1. */
  scale: number
  /** Optional height as a fraction of frame height for free-aspect resizing. */
  scaleY?: number
  /** Defaults to true for projects created before free-aspect resizing. */
  aspectLocked?: boolean
  rotate: Rotation
  /** Free rotation in degrees (-180..180), on top of the 90° `rotate`. */
  angle: number
  flipH: boolean
  flipV: boolean
  crop: Crop
  repeat: number
  /** Exact occupied timeline length. When set, the final repeat is cut short. */
  timelineDuration?: number
  /** Whole-layer opacity; separate from media pixels and audio volume. */
  opacity?: number
  /** Locked layers remain visible but cannot be moved/resized accidentally. */
  locked?: boolean
  /** Hidden layers stay in the project/timeline but are skipped in preview/export. */
  hidden?: boolean
  fadeIn?: number
  fadeOut?: number
  positionKeyframes?: PositionKeyframe[]
}

/** A full-frame backdrop rendered BEHIND the main track (its own lower layer). */
export interface Background extends Clip {
  /** Timeline start time (seconds). */
  start: number
  opacity?: number
  locked?: boolean
  hidden?: boolean
}

/** A music / audio clip mixed into the timeline. */
export interface AudioClip {
  id: string
  assetId?: string
  name: string
  src: string
  file: File
  sourceSize: number
  nativeMediaId?: string
  duration: number
  trimStart: number
  trimEnd: number
  volume: number
  muted: boolean
  color: string
  /** Timeline start time (seconds). */
  start: number
  repeat: number
  /** Exact occupied timeline length. When set, the final repeat is cut short. */
  timelineDuration?: number
  fadeIn?: number
  fadeOut?: number
}

/** A text/subtitle overlay shown over a time range on the timeline. */
export interface TextOverlay {
  id: string
  text: string
  start: number
  end: number
  x: number
  y: number
  size: number
  color: string
  /** Text fill opacity 0..1. */
  colorAlpha: number
  box: boolean
  /** Background box color (when box is on). */
  boxColor: string
  /** Background box opacity 0..1. */
  boxAlpha: number
  /** CSS font-family stack. */
  font: string
  /** Outline width as a fraction of font size (0 = none). */
  strokeWidth: number
  strokeColor: string
  /** Drop shadow on/off + style. */
  shadow: boolean
  shadowColor: string
  /** Shadow blur as a fraction of font size. */
  shadowBlur: number
  /** Shadow vertical offset as a fraction of font size. */
  shadowDist: number
  /** Horizontal text alignment for multi-line text. */
  align: 'left' | 'center' | 'right' | 'justify'
  /** Free rotation in degrees (-180..180). */
  angle: number
  /** Whole text-layer opacity, including its box, stroke and shadow. */
  opacity?: number
  locked?: boolean
  hidden?: boolean
  fadeIn?: number
  fadeOut?: number
  positionKeyframes?: PositionKeyframe[]
}

export type TextAlign = TextOverlay['align']

export const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: '기본', value: "'Noto Sans KR', system-ui, sans-serif" },
  { label: '명조', value: "'Noto Serif KR', Georgia, serif" },
  { label: '굵게', value: "'Black Han Sans', sans-serif" },
  { label: '둥근', value: "'Jua', sans-serif" },
  { label: '손글씨', value: "'Nanum Pen Script', cursive" },
  { label: '고정폭', value: "'Courier New', monospace" },
]

export type Selection =
  | { type: 'clip'; id: string }
  | { type: 'overlay'; id: string }
  | { type: 'audio'; id: string }
  | { type: 'text'; id: string }
  | { type: 'background'; id: string }
  | null

export type TimelineItemRef = Exclude<Selection, null>

/** Shared back-to-front order for visual layers placed above the main track. */
export type VisualLayerRef = Extract<TimelineItemRef, { type: 'overlay' | 'text' }>

/** Persistent timeline group. Members keep their individual layer identity. */
export interface TimelineGroup {
  id: string
  name: string
  members: TimelineItemRef[]
}

export type ExportHeight = 480 | 720 | 1080 | 1440 | 2160

export interface ExportSettings {
  height: ExportHeight
  format: 'mp4' | 'webm'
  filename: string
}
