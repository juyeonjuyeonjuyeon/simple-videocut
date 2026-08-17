import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export function createElectronTestEnvironment(prefix) {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const userData = join(root, 'userdata')
  return {
    root,
    userData,
    launchArgs: [`--user-data-dir=${userData}`],
    async verify(app) {
      const actual = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
      if (realpathSync(actual) !== realpathSync(userData)) {
        throw new Error(`검사 저장공간이 분리되지 않았습니다: ${actual}`)
      }
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}
