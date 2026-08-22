const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Turns a soft foreground confidence into a feathered alpha edge. */
export function foregroundAlpha(confidence: number, sensitivity: number): number {
  const threshold = 0.24 + clamp(sensitivity, 0, 100) / 100 * 0.5
  const feather = 0.12
  return clamp((confidence - threshold + feather) / (feather * 2), 0, 1)
}
