const extension = (file: File) => file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.ogv'])
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.avif'])
const AUDIO_EXTENSIONS = new Set(['.m4a', '.aac', '.caf', '.wav', '.mp3', '.aif', '.aiff', '.flac', '.ogg', '.oga', '.opus'])

// Mobile file pickers may omit File.type, especially for Voice Memos.
export const isVideoFile = (file: File) => file.type.startsWith('video/') || (!file.type && VIDEO_EXTENSIONS.has(extension(file)))
export const isImageFile = (file: File) => file.type.startsWith('image/') || (!file.type && IMAGE_EXTENSIONS.has(extension(file)))
export const isAudioFile = (file: File) => file.type.startsWith('audio/') || AUDIO_EXTENSIONS.has(extension(file))

export const AUDIO_ACCEPT = 'audio/*,.m4a,.aac,.caf,.wav,.mp3,.aif,.aiff,.flac,.ogg,.oga,.opus'

/** Probe a video File for its duration and whether it carries an audio track. */
export function probeVideo(file: File): Promise<{ duration: number; hasAudio: boolean; src: string }> {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.src = src

    const cleanup = () => {
      video.onloadedmetadata = null
      video.onerror = null
    }

    video.onloadedmetadata = () => {
      // Heuristics for audio-track presence across browsers.
      const v = video as HTMLVideoElement & {
        mozHasAudio?: boolean
        webkitAudioDecodedByteCount?: number
        audioTracks?: { length: number }
      }
      const hasAudio = Boolean(
        v.mozHasAudio ||
          (typeof v.webkitAudioDecodedByteCount === 'number' && v.webkitAudioDecodedByteCount > 0) ||
          (v.audioTracks && v.audioTracks.length > 0) ||
          // Fallback: assume audio exists; export mux handles silence gracefully.
          true,
      )
      cleanup()
      resolve({ duration: video.duration || 0, hasAudio, src })
    }
    video.onerror = () => {
      cleanup()
      URL.revokeObjectURL(src)
      reject(new Error(`동영상을 읽을 수 없습니다: ${file.name}`))
    }
  })
}

/** Probe an image File for its natural dimensions. */
export function probeImage(file: File): Promise<{ width: number; height: number; src: string }> {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, src })
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error(`이미지를 읽을 수 없습니다: ${file.name}`)) }
    img.src = src
  })
}

/** Probe an audio File for its duration. */
export function probeAudio(file: File): Promise<{ duration: number; src: string }> {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file)
    const audio = document.createElement('audio')
    audio.preload = 'metadata'
    audio.src = src
    audio.onloadedmetadata = () => resolve({ duration: audio.duration || 0, src })
    audio.onerror = () => { URL.revokeObjectURL(src); reject(new Error(`오디오를 읽을 수 없습니다: ${file.name}`)) }
  })
}

let colorIndex = 0
const CLIP_COLORS = ['#5b8cff', '#22c79b', '#f6a623', '#ff7a90', '#b07cff', '#ffc857']
export function nextClipColor(): string {
  const c = CLIP_COLORS[colorIndex % CLIP_COLORS.length]
  colorIndex++
  return c
}
