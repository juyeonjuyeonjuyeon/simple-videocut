import { describe, expect, it } from 'vitest'
import { assertMediaCapacity, MEDIA_LIMITS } from './media'
import { assertPortableMediaBudget, assertPortableProject, PROJECT_LIMITS } from './project'

const validProject = (): {
  version: number; name: string; savedAt: number; aspectRatio: string
  exportSettings: { height: number; format: string; filename: string }
  clips: unknown[]; overlays: unknown[]; audios: unknown[]; backgrounds: unknown[]; texts: unknown[]; media: unknown[]
} => ({
  version: 1,
  name: 'test',
  savedAt: Date.now(),
  aspectRatio: '16:9',
  exportSettings: { height: 720, format: 'mp4', filename: 'simplecut' },
  clips: [], overlays: [], audios: [], backgrounds: [], texts: [], media: [],
})

const mediaClip = (speed = 1) => ({
  id: 'c0', name: 'clip.mp4', kind: 'video', mediaId: 'm0',
  duration: 2, trimStart: 0, trimEnd: 2, speed,
  volume: 1, muted: false, hasAudio: true, color: '#123456',
  rotate: 0, flipH: false, flipV: false, repeat: 1,
  crop: { top: 0, right: 0, bottom: 0, left: 0 },
})

const addMedia = (project: ReturnType<typeof validProject>) => {
  project.media = [{ id: 'm0', name: 'clip.mp4', type: 'video/mp4', data: 'AAAA' }]
}

describe('untrusted media limits', () => {
  it('rejects an oversized media file before browser decoding', () => {
    expect(() => assertMediaCapacity([
      { name: 'huge.mov', size: MEDIA_LIMITS.maxFileBytes + 1 },
    ], [])).toThrow(/파일 크기/)
  })

  it('rejects a batch that exceeds the total local project budget', () => {
    expect(() => assertMediaCapacity(
      [{ name: 'new.mov', size: 20 }],
      [{ name: 'old.mov', size: MEDIA_LIMITS.maxProjectBytes - 10 }],
    )).toThrow(/전체 미디어 용량/)
  })
})

describe('portable project schema', () => {
  it('rejects unsupported export dimensions', () => {
    const project = validProject()
    project.exportSettings.height = 999999
    expect(() => assertPortableProject(project)).toThrow(/해상도/)
  })

  it('rejects excessive item counts and decoded media budgets', () => {
    const tooMany = validProject()
    tooMany.texts = Array.from({ length: 201 }, () => ({}))
    expect(() => assertPortableProject(tooMany)).toThrow(/항목 수/)

    expect(() => assertPortableMediaBudget([
      Math.ceil(PROJECT_LIMITS.maxDecodedMediaBytes / 0.75) + 4,
    ])).toThrow(/미디어 용량/)
  })

  it('rejects a project whose repeated timeline exceeds the safe duration', () => {
    const project = validProject()
    addMedia(project)
    project.clips = [{
      ...mediaClip(),
      duration: 3600, trimStart: 0, trimEnd: 3600,
      speed: 0.1, repeat: 2,
    }]
    expect(() => assertPortableProject(project)).toThrow(/전체 길이/)
  })

  it('accepts the 0.1x minimum speed offered by the editor', () => {
    const project = validProject()
    addMedia(project)
    project.clips = [mediaClip(0.1)]
    expect(() => assertPortableProject(project)).not.toThrow()
  })

  it('rejects media items that omit required editing fields', () => {
    const project = validProject()
    addMedia(project)
    project.clips = [{ id: 'c0', name: 'clip.mp4', kind: 'video', mediaId: 'm0' }]
    expect(() => assertPortableProject(project)).toThrow(/길이|트림|속도|필수/)
  })
})
