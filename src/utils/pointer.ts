type PointerDragEnd = (event: PointerEvent, cancelled: boolean) => void

/** Track a drag outside its origin and always release it on pointer up or system cancellation. */
export function startPointerDrag(
  onMove: (event: PointerEvent) => void,
  onEnd?: PointerDragEnd,
  pointerId?: number,
): () => void {
  const previousUserSelect = document.body.style.userSelect
  document.body.style.userSelect = 'none'
  let active = true

  const cleanup = () => {
    if (!active) return
    active = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    document.body.style.userSelect = previousUserSelect
  }
  const matches = (event: PointerEvent) => pointerId == null || event.pointerId === pointerId
  const finish = (event: PointerEvent, cancelled: boolean) => {
    if (!matches(event)) return
    cleanup()
    onEnd?.(event, cancelled)
  }
  const move = (event: PointerEvent) => { if (matches(event)) onMove(event) }
  const up = (event: PointerEvent) => finish(event, false)
  const cancel = (event: PointerEvent) => finish(event, true)

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  return cleanup
}
