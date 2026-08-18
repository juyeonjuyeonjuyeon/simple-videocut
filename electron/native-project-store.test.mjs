import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createNativeProjectStore } from './native-project-store.mjs'

test('native project store keeps media outside lightweight versioned manifests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'simplecut-native-store-'))
  try {
    const source = join(root, 'source.mp4')
    await writeFile(source, Buffer.alloc(1024 * 1024, 7))
    const store = createNativeProjectStore(join(root, 'library'))
    await store.initialize()

    const media = await store.registerMedia(source, 'source.mp4')
    const sameMedia = await store.registerMedia(source, 'source.mp4')
    assert.equal(sameMedia.id, media.id)
    assert.equal((await stat(store.mediaPath(media.id))).size, 1024 * 1024)
    await writeFile(source, Buffer.from('changed-original'))
    assert.equal((await stat(store.mediaPath(media.id))).size, 1024 * 1024)
    assert.throws(() => store.mediaPath('../private.txt'), /미디어/)

    const first = { version: 1, name: '__autosave__', savedAt: 1, media: [{ nativeMediaId: media.id, size: media.size }] }
    const second = { ...first, savedAt: 2 }
    await store.saveProject('__autosave__', first)
    await store.saveProject('__autosave__', second)

    const candidates = await store.loadProjectCandidates('__autosave__')
    assert.deepEqual(candidates.map((candidate) => candidate.savedAt), [2, 1])
    const manifestBytes = (await readFile(store.projectPath('__autosave__'))).byteLength
    assert.ok(manifestBytes < 4096, `manifest unexpectedly contains media bytes: ${manifestBytes}`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
