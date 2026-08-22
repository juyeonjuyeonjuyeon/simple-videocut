/** A quiet confirmation tick. Unsupported browsers simply do nothing. */
export function hapticTick(duration = 8): boolean {
  try {
    return navigator.vibrate?.(duration) ?? false
  } catch {
    return false
  }
}
