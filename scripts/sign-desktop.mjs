import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const output = join(process.cwd(), 'dist', 'mac-arm64')
const appName = readdirSync(output).find((name) => name.endsWith('.app'))
if (!appName) throw new Error('서명할 macOS 앱을 찾지 못했습니다.')
const appPath = join(output, appName)
execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
