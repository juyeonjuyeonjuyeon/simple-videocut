import { useEffect, useMemo, useState } from 'react'
import type { Clip } from '../types'

const THUMB_WIDTH = 96
const MAX_THUMBNAILS = 10
const MAX_WAVEFORM_BYTES = 96 * 1024 * 1024
const WAVEFORM_BUCKETS = 480

const thumbnailCache = new Map<string, string[]>()
const waveformCache = new Map<string, Promise<Float32Array | null>>()
let decodeQueue: Promise<void> = Promise.resolve()

function boundedCacheSet<T>(cache: Map<string, T>, key: string, value: T, max: number) {
  cache.set(key, value)
  if (cache.size <= max) return
  const oldest = cache.keys().next().value as string | undefined
  if (oldest) cache.delete(oldest)
}

function waitForMedia(el: HTMLMediaElement, event: 'loadedmetadata' | 'seeked', timeout = 8000) {
  return new Promise<void>((resolve, reject) => {
    let done = false
    const finish = (error?: Error) => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      el.removeEventListener(event, ready)
      el.removeEventListener('error', failed)
      if (error) reject(error)
      else resolve()
    }
    const ready = () => finish()
    const failed = () => finish(new Error('미디어 미리보기를 읽을 수 없습니다.'))
    const timer = window.setTimeout(() => finish(new Error('미디어 미리보기 시간이 초과됐습니다.')), timeout)
    el.addEventListener(event, ready, { once: true })
    el.addEventListener('error', failed, { once: true })
  })
}

async function makeVideoThumbnails(clip: Clip, count: number): Promise<string[]> {
  const key = [clip.src, clip.trimStart, clip.trimEnd, clip.speed, clip.repeat, count].join('|')
  const cached = thumbnailCache.get(key)
  if (cached) return cached

  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'metadata'
  video.src = clip.src
  if (video.readyState < 1) {
    const loaded = waitForMedia(video, 'loadedmetadata')
    video.load()
    await loaded
  }
  if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) return []

  const canvas = document.createElement('canvas')
  canvas.width = 192
  canvas.height = 108
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) return []
  const baseTimelineLength = Math.max(0.001, (clip.trimEnd - clip.trimStart) / clip.speed)
  const frames: string[] = []

  for (let i = 0; i < count; i++) {
    const displayed = ((i + 0.5) / count) * baseTimelineLength * Math.max(1, clip.repeat)
    const withinCycle = clip.repeat > 1 ? displayed % baseTimelineLength : displayed
    const target = Math.max(0, Math.min(clip.trimEnd - 0.001, clip.trimStart + withinCycle * clip.speed))
    if (Math.abs(video.currentTime - target) > 0.001) {
      const sought = waitForMedia(video, 'seeked')
      video.currentTime = target
      await sought
    }
    const sourceRatio = video.videoWidth / video.videoHeight
    const targetRatio = canvas.width / canvas.height
    let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight
    if (sourceRatio > targetRatio) {
      sw = video.videoHeight * targetRatio
      sx = (video.videoWidth - sw) / 2
    } else {
      sh = video.videoWidth / targetRatio
      sy = (video.videoHeight - sh) / 2
    }
    context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    frames.push(canvas.toDataURL('image/jpeg', 0.58))
  }
  video.removeAttribute('src')
  video.load()
  boundedCacheSet(thumbnailCache, key, frames, 120)
  return frames
}

export function ClipThumbnailStrip({ clip, width }: { clip: Clip; width: number }) {
  const count = Math.max(1, Math.min(MAX_THUMBNAILS, Math.ceil(width / THUMB_WIDTH)))
  const [frames, setFrames] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    if (clip.kind === 'color') {
      setFrames([])
      return () => { cancelled = true }
    }
    if (clip.kind === 'image') {
      setFrames(Array.from({ length: count }, () => clip.src))
      return () => { cancelled = true }
    }
    setFrames([])
    void makeVideoThumbnails(clip, count)
      .then((result) => { if (!cancelled) setFrames(result) })
      .catch(() => { if (!cancelled) setFrames([]) })
    return () => { cancelled = true }
  }, [clip, count])

  if (!frames.length) return null
  return (
    <div className="clip__thumbs" aria-hidden="true">
      {frames.map((frame, index) => <img key={`${frame.slice(-24)}-${index}`} src={frame} alt="" draggable={false} />)}
    </div>
  )
}

type WaveformMedia = {
  src: string
  file: File
  sourceSize: number
  nativeMediaId?: string
  trimStart: number
  trimEnd: number
  repeat: number
}

async function sourceBytes(media: WaveformMedia): Promise<ArrayBuffer | null> {
  if (media.sourceSize > MAX_WAVEFORM_BYTES) return null
  if (media.file.size) return media.file.arrayBuffer()
  const response = await fetch(media.src)
  if (!response.ok) return null
  const data = await response.arrayBuffer()
  return data.byteLength <= MAX_WAVEFORM_BYTES ? data : null
}

function decodeWaveform(media: WaveformMedia): Promise<Float32Array | null> {
  const key = `${media.nativeMediaId || media.src}|${media.trimStart}|${media.trimEnd}`
  const cached = waveformCache.get(key)
  if (cached) return cached

  const task = new Promise<Float32Array | null>((resolve) => {
    decodeQueue = decodeQueue.then(async () => {
      let context: AudioContext | null = null
      try {
        const bytes = await sourceBytes(media)
        if (!bytes) { resolve(null); return }
        context = new AudioContext()
        const buffer = await context.decodeAudioData(bytes.slice(0))
        const peaks = new Float32Array(WAVEFORM_BUCKETS)
        const startSample = Math.max(0, Math.floor((media.trimStart / buffer.duration) * buffer.length))
        const endSample = Math.min(buffer.length, Math.ceil((media.trimEnd / buffer.duration) * buffer.length))
        const span = Math.max(1, endSample - startSample)
        for (let bucket = 0; bucket < peaks.length; bucket++) {
          const from = startSample + Math.floor((bucket / peaks.length) * span)
          const to = startSample + Math.max(1, Math.floor(((bucket + 1) / peaks.length) * span))
          let peak = 0
          const stride = Math.max(1, Math.floor((to - from) / 64))
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const samples = buffer.getChannelData(channel)
            for (let sample = from; sample < to; sample += stride) peak = Math.max(peak, Math.abs(samples[sample] || 0))
          }
          peaks[bucket] = peak
        }
        let max = 0
        for (const peak of peaks) max = Math.max(max, peak)
        if (max > 0) for (let i = 0; i < peaks.length; i++) peaks[i] = Math.max(0.035, peaks[i] / max)
        resolve(peaks)
      } catch {
        resolve(null)
      } finally {
        await context?.close().catch(() => {})
      }
    }).catch(() => {})
  })
  boundedCacheSet(waveformCache, key, task, 80)
  return task
}

function waveformPath(peaks: Float32Array, repeat: number) {
  const points = 240
  const top: string[] = []
  const bottom: string[] = []
  for (let i = 0; i <= points; i++) {
    const progress = i / points
    const cycleProgress = repeat > 1 ? (progress * repeat) % 1 : progress
    const index = Math.min(peaks.length - 1, Math.floor(cycleProgress * peaks.length))
    const amplitude = (peaks[index] || 0.035) * 45
    top.push(`${(progress * 1000).toFixed(1)},${(50 - amplitude).toFixed(1)}`)
    bottom.unshift(`${(progress * 1000).toFixed(1)},${(50 + amplitude).toFixed(1)}`)
  }
  return `M${top.join(' L')} L${bottom.join(' L')} Z`
}

export function AudioWaveform({ media, className = '' }: { media: WaveformMedia; className?: string }) {
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  useEffect(() => {
    let cancelled = false
    setPeaks(null)
    void decodeWaveform(media).then((result) => { if (!cancelled) setPeaks(result) })
    return () => { cancelled = true }
  }, [media])
  const path = useMemo(() => peaks ? waveformPath(peaks, Math.max(1, media.repeat)) : '', [media.repeat, peaks])
  if (!path) return <span className={`timeline-waveform timeline-waveform--pending ${className}`} aria-hidden="true" />
  return (
    <svg className={`timeline-waveform ${className}`} viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} />
    </svg>
  )
}
