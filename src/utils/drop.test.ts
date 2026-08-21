import { describe, expect, it } from 'vitest'
import { filesFromDrop, hasFilePayload } from './drop'
import { isAudioFile, isImageFile, isVideoFile, MEDIA_ACCEPT } from './media'

const transfer = (value: object) => value as DataTransfer

describe('native media drops', () => {
  it('recognizes both standard and Apple-style file payloads', () => {
    expect(hasFilePayload(transfer({ files: [], items: [], types: ['Files'] }))).toBe(true)
    expect(hasFilePayload(transfer({ files: [], items: [{ kind: 'file' }], types: [] }))).toBe(true)
    expect(hasFilePayload(transfer({ files: [], items: [], types: ['public.file-url'] }))).toBe(true)
    expect(hasFilePayload(transfer({ files: [], items: [{ kind: 'string' }], types: ['text/plain'] }))).toBe(false)
  })

  it('keeps item-only files and removes duplicate FileList representations', async () => {
    const photo = new File(['photo'], 'IMG_0001.HEIC', { type: 'application/octet-stream', lastModified: 1 })
    const recording = new File(['voice'], '새로운 녹음.m4a', { type: '', lastModified: 2 })
    const files = await filesFromDrop(transfer({
      files: [photo],
      items: [
        { kind: 'file', getAsFile: () => photo },
        { kind: 'file', getAsFile: () => recording },
      ],
      types: ['Files'],
    }))

    expect(files).toEqual([photo, recording])
  })

  it('resolves WebKit promised-file entries used by native apps', async () => {
    const movie = new File(['movie'], 'clip.MOV', { type: '' })
    const files = await filesFromDrop(transfer({
      files: [],
      items: [{
        kind: 'file',
        getAsFile: () => null,
        webkitGetAsEntry: () => ({ isFile: true, file: (success: (file: File) => void) => success(movie) }),
      }],
      types: ['Files'],
    }))

    expect(files).toEqual([movie])
  })

  it('accepts common Apple media even when its MIME type is missing or generic', () => {
    expect(isVideoFile(new File(['movie'], 'clip.MOV', { type: 'application/octet-stream' }))).toBe(true)
    expect(isImageFile(new File(['photo'], 'photo.HEIC', { type: 'application/octet-stream' }))).toBe(true)
    expect(isAudioFile(new File(['voice'], 'voice.M4A', { type: 'application/octet-stream' }))).toBe(true)
    expect(MEDIA_ACCEPT).toContain('.mov')
    expect(MEDIA_ACCEPT).toContain('.heic')
    expect(MEDIA_ACCEPT).toContain('.m4a')
  })
})
