const LINE_DELTA_PX = 16
const MAX_WHEEL_DELTA_PX = 120
const WHEEL_ZOOM_SENSITIVITY = 0.00115

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
