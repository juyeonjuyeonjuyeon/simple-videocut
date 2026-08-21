import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const FONT_FAMILY_SCRIPT = `
ObjC.import('AppKit')
const families = ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies)
families.join('\\n')
`.trim()

const hasControlCharacter = (value) => [...value].some((character) => character.charCodeAt(0) < 32)

export function normalizeFontFamilies(raw) {
  return [...new Set(String(raw || '')
    .split(/\r?\n/)
    .map((family) => family.trim())
    .filter((family) => family && !family.startsWith('.') && family.length <= 120 && !hasControlCharacter(family)))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .slice(0, 2000)
}

export async function listSystemFontFamilies(platform = process.platform) {
  if (platform !== 'darwin') return []
  try {
    const { stdout } = await execFileAsync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', FONT_FAMILY_SCRIPT], {
      timeout: 10_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    })
    return normalizeFontFamilies(stdout)
  } catch {
    return []
  }
}
