function parseHex(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Convert a #rrggbb (or #rgb) hex color + alpha to a CSS rgba() string. */
export function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex)
  const a = Math.max(0, Math.min(1, alpha))
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/** Pick a readable text color (dark or light) for a given background color. */
export function contrastText(hex: string): string {
  const [r, g, b] = parseHex(hex)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#0c0f14' : '#ffffff'
}
