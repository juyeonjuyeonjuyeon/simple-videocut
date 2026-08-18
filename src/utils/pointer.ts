type PointerDragEnd = (event: PointerEvent, cancelled: boolean) => void

/** Track a drag outside its origin and always release it on pointer up or system cancellation. */
export function startPointerDrag(
  onMove: (event: PointerEvent) => void,
  onEnd?: PointerDragEnd,
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
  const finish = (event: PointerEvent, cancelled: boolean) => {
    cleanup()
    onEnd?.(event, cancelled)
  }
  const move = (event: PointerEvent) => onMove(event)
  const up = (event: PointerEvent) => finish(event, false)
  const cancel = (event: PointerEvent) => finish(event, true)

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  return cleanup
}
