export const cssFontFamily = (family: string) => `${JSON.stringify(family)}, 'Noto Sans KR', system-ui, sans-serif`

export const firstFontFamily = (value: string) => {
  const trimmed = value.trim()
  if (trimmed.startsWith('"')) {
    for (let index = 1; index < trimmed.length; index += 1) {
      if (trimmed[index] === '"' && trimmed[index - 1] !== '\\') {
        try { return JSON.parse(trimmed.slice(0, index + 1)) as string } catch { break }
      }
    }
  }
  if (trimmed.startsWith("'")) {
    const closing = trimmed.indexOf("'", 1)
    if (closing > 0) return trimmed.slice(1, closing)
  }
  return trimmed.split(',')[0]?.trim() || trimmed
}

type LocalFontRecord = { family?: string }
type LocalFontWindow = Window & { queryLocalFonts?: () => Promise<LocalFontRecord[]> }

export const canListLocalFonts = () => Boolean(
  window.simplecutDesktop?.listFonts || (window as LocalFontWindow).queryLocalFonts,
)

export async function listLocalFontFamilies(): Promise<string[]> {
  let families: string[]
  if (window.simplecutDesktop?.listFonts) {
    families = await window.simplecutDesktop.listFonts()
  } else {
    const query = (window as LocalFontWindow).queryLocalFonts
    if (!query) return []
    const records = await query.call(window)
    families = records.map((record) => record.family || '')
  }
  return [...new Set(families
    .map((family) => family.trim())
    .filter((family) => family && !family.startsWith('.') && family.length <= 120 && [...family].every((character) => character.charCodeAt(0) >= 32)))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}
