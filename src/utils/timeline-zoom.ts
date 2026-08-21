const LINE_DELTA_PX = 16
const MAX_WHEEL_DELTA_PX = 120
const WHEEL_ZOOM_SENSITIVITY = 0.00115

export type TimelineWheelIntent = 'scroll' | 'horizontal-pan' | 'zoom'

export interface TimelineWheelGesture {
  deltaX: number
  deltaY: number
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

/**
 * Keep native two-finger scrolling predictable. Chromium reports a trackpad
 * pinch as ctrl+wheel, while command/control+wheel is the deliberate desktop
 * zoom gesture. Shift keeps the familiar vertical-wheel-to-horizontal-pan
 * fallback for mouse users.
 */
export function timelineWheelIntent(gesture: TimelineWheelGesture): TimelineWheelIntent {
  if (gesture.ctrlKey || gesture.metaKey) return 'zoom'
  if (gesture.shiftKey && gesture.deltaY !== 0) return 'horizontal-pan'
  return 'scroll'
}

/**
 * Converts browser-dependent wheel units to a bounded pixel delta, then maps
 * that distance to a continuous logarithmic zoom. Small trackpad movements
 * remain fine-grained while a mouse-wheel notch is still clearly perceptible.
 */
export function timelineWheelZoomFactor(deltaY: number, deltaMode: number, pageHeight = 800): number {
  const pixelDelta = deltaMode === 1
    ? deltaY * LINE_DELTA_PX
    : deltaMode === 2
      ? deltaY * Math.max(1, pageHeight)
      : deltaY
  const boundedDelta = Math.max(-MAX_WHEEL_DELTA_PX, Math.min(pixelDelta, MAX_WHEEL_DELTA_PX))
  return Math.exp(-boundedDelta * WHEEL_ZOOM_SENSITIVITY)
}
