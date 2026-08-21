import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from './project'
import { saveProject } from './project'
import type { Clip } from '../types'
import { CAPTION_STYLE_DEFAULTS } from './captions'

const makeProject = (): ProjectState => {
  const file = new File(['desktop-media'], 'source.png', { type: 'image/png' })
  const clip: Clip = {
    id: 'clip-1', kind: 'image', name: file.name, src: 'blob:source', file,
    sourceSize: file.size,
    duration: 2, trimStart: 0, trimEnd: 2, speed: 1, volume: 1, muted: false,
    hasAudio: false, color: '#123456', rotate: 0, flipH: false, flipV: false,
    crop: { top: 0, right: 0, bottom: 0, left: 0 }, repeat: 1,
    canvasX: 0.35, canvasY: 0.6, canvasScale: 0.55, canvasScaleY: 0.8,
    canvasAspectLocked: false, canvasAngle: 12,
    backgroundRemovalEnabled: true, backgroundRemovalSensitivity: 42,
  }
  return {
    clips: [clip], overlays: [], audios: [], backgrounds: [], texts: [],
    captionTracks: [{
      id: 'captions-1', name: '한국어', language: 'ko', hidden: false, locked: false,
      style: { ...CAPTION_STYLE_DEFAULTS },
      cues: [{ id: 'cue-1', text: '저장되는 자막', start: 0.2, end: 1.5, origin: 'manual' }],
    }],
    aspectRatio: '16:9', exportSettings: { height: 720, format: 'mp4', filename: 'desktop' },
  }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('desktop project persistence', () => {
  it('stores a lightweight native media reference instead of a second Blob copy', async () => {
    const projectSave = vi.fn(async (_name: string, _project: unknown) => {})
    const managedId = '123e4567-e89b-42d3-a456-426614174000.mp4'
    const registerMedia = vi.fn(async () => ({ id: managedId, size: 13 }))
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { simplecutDesktop: { projectSave, registerMedia } },
    })

    await saveProject('desktop-project', makeProject())

    expect(registerMedia).toHaveBeenCalledOnce()
    expect(projectSave).toHaveBeenCalledOnce()
    const stored = projectSave.mock.calls[0][1] as {
      media: Array<Record<string, unknown>>
      clips: Array<Record<string, unknown>>
      captionTracks: Array<Record<string, unknown>>
    }
    expect(stored.media[0]).toMatchObject({ nativeMediaId: managedId, size: 13 })
    expect(stored.media[0]).not.toHaveProperty('blob')
    expect(stored.clips[0]).toMatchObject({
      canvasX: 0.35,
      canvasY: 0.6,
      canvasScale: 0.55,
      canvasScaleY: 0.8,
      canvasAspectLocked: false,
      canvasAngle: 12,
      backgroundRemovalEnabled: true,
      backgroundRemovalSensitivity: 42,
    })
    expect(stored.captionTracks[0]).toMatchObject({
      id: 'captions-1', language: 'ko', cues: [{ id: 'cue-1', text: '저장되는 자막', start: 0.2, end: 1.5 }],
    })
  })
})
