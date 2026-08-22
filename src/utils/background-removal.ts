import { renderAiBackgroundRemovedImage } from './background-removal-ai'

export const DEFAULT_BACKGROUND_REMOVAL_SENSITIVITY = 35

export interface BackgroundRemovalPixels {
  data: Uint8ClampedArray
  width: number
  height: number
  background: [number, number, number]
  removedPixels: number
}

export interface BackgroundRemovalSource {
  src: string
  file?: File
  nativeMediaId?: string
}

export interface BackgroundRemovalImage {
  blob: Blob
  width: number
  height: number
  removedPixels: number
  background: [number, number, number]
  engine: 'ai' | 'color'
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

const colourDistance = (data: Uint8ClampedArray, offset: number, colour: [number, number, number]) => {
  const red = data[offset] - colour[0]
  const green = data[offset + 1] - colour[1]
  const blue = data[offset + 2] - colour[2]
  return Math.sqrt(0.2126 * red * red + 0.7152 * green * green + 0.0722 * blue * blue)
}

function borderIndexes(width: number, height: number): number[] {
  const indexes: number[] = []
  for (let x = 0; x < width; x += 1) {
    indexes.push(x)
    if (height > 1) indexes.push((height - 1) * width + x)
  }
  for (let y = 1; y < height - 1; y += 1) {
    indexes.push(y * width)
    if (width > 1) indexes.push(y * width + width - 1)
  }
  return indexes
}

function dominantBorderColour(data: Uint8ClampedArray, width: number, height: number): [number, number, number] | null {
  const buckets = new Map<number, { count: number; red: number; green: number; blue: number }>()
  for (const index of borderIndexes(width, height)) {
    const offset = index * 4
    if (data[offset + 3] < 32) continue
    const key = (data[offset] >> 4) << 8 | (data[offset + 1] >> 4) << 4 | (data[offset + 2] >> 4)
    const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 }
    bucket.count += 1
    bucket.red += data[offset]
    bucket.green += data[offset + 1]
    bucket.blue += data[offset + 2]
    buckets.set(key, bucket)
  }
  const dominant = [...buckets.values()].sort((a, b) => b.count - a.count)[0]
  if (!dominant) return null
  return [
    Math.round(dominant.red / dominant.count),
    Math.round(dominant.green / dominant.count),
    Math.round(dominant.blue / dominant.count),
  ]
}

/**
 * Removes only background-coloured pixels connected to the image edge. This
 * preserves matching colours enclosed inside the subject and keeps the edit
 * deterministic for preview, project restore, and export.
 */
export function removeConnectedBackground(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  sensitivity: number,
): BackgroundRemovalPixels {
  if (width <= 0 || height <= 0 || source.length !== width * height * 4) throw new Error('이미지 픽셀 정보가 올바르지 않습니다.')
  const data = new Uint8ClampedArray(source)
  const detectedBackground = dominantBorderColour(source, width, height)
  if (!detectedBackground) {
    return { data, width, height, background: [0, 0, 0], removedPixels: 0 }
  }
  const background = detectedBackground
  const amount = clamp(sensitivity, 0, 100) / 100
  const transparentThreshold = 6 + Math.pow(amount, 1.35) * 174
  const feather = 8 + amount * 12
  const outerThreshold = transparentThreshold + feather
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0

  const enqueue = (index: number) => {
    if (visited[index]) return
    const offset = index * 4
    // Existing transparent pixels still connect neighbouring background areas.
    if (source[offset + 3] !== 0 && colourDistance(source, offset, background) > outerThreshold) return
    visited[index] = 1
    queue[tail++] = index
  }
  for (const index of borderIndexes(width, height)) enqueue(index)

  let removedPixels = 0
  while (head < tail) {
    const index = queue[head++]
    const offset = index * 4
    const distance = colourDistance(source, offset, background)
    const keep = clamp((distance - transparentThreshold) / feather, 0, 1)
    const nextAlpha = Math.round(source[offset + 3] * keep)
    if (nextAlpha < source[offset + 3]) removedPixels += 1
    data[offset + 3] = nextAlpha
    const x = index % width
    const y = Math.floor(index / width)
    if (x > 0) enqueue(index - 1)
    if (x + 1 < width) enqueue(index + 1)
    if (y > 0) enqueue(index - width)
    if (y + 1 < height) enqueue(index + width)
  }

  return { data, width, height, background, removedPixels }
}

async function sourceBlob(source: BackgroundRemovalSource): Promise<Blob> {
  if (source.file?.size) return source.file
  if (source.nativeMediaId && typeof window !== 'undefined' && window.simplecutDesktop?.readMedia) {
    return new Blob([Uint8Array.from(await window.simplecutDesktop.readMedia(source.nativeMediaId))])
  }
  if (!source.src) throw new Error('배경을 제거할 원본 이미지가 없습니다.')
  const response = await fetch(source.src)
  if (!response.ok) throw new Error('원본 이미지를 불러오지 못했습니다.')
  return response.blob()
}

async function decodeImage(blob: Blob): Promise<{ image: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob)
      return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
    } catch { /* Safari fallback below */ }
  }
  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.decoding = 'async'
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('이미지 형식을 읽을 수 없습니다.'))
    image.src = url
  })
  return { image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) }
}

const canvasPng = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('투명 이미지를 만들지 못했습니다.')), 'image/png')
})

export async function renderBackgroundRemovedImage(
  source: BackgroundRemovalSource,
  sensitivity = DEFAULT_BACKGROUND_REMOVAL_SENSITIVITY,
  maxDimension = 4096,
): Promise<BackgroundRemovalImage> {
  try {
    const result = await renderAiBackgroundRemovedImage(source, sensitivity, maxDimension)
    return { ...result, background: [0, 0, 0], engine: 'ai' }
  } catch (error) {
    console.warn(`로컬 AI 배경 제거를 사용할 수 없어 색상 방식으로 전환합니다: ${(error as Error).message}`)
  }
  const decoded = await decodeImage(await sourceBlob(source))
  try {
    const scale = Math.min(1, Math.max(1, maxDimension) / Math.max(decoded.width, decoded.height))
    const width = Math.max(1, Math.round(decoded.width * scale))
    const height = Math.max(1, Math.round(decoded.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('이미지 편집 기능을 사용할 수 없습니다.')
    context.drawImage(decoded.image, 0, 0, width, height)
    const pixels = context.getImageData(0, 0, width, height)
    const result = removeConnectedBackground(pixels.data, width, height, sensitivity)
    context.putImageData(new ImageData(new Uint8ClampedArray(result.data), width, height), 0, 0)
    return { blob: await canvasPng(canvas), width, height, removedPixels: result.removedPixels, background: result.background, engine: 'color' }
  } finally {
    decoded.release()
  }
}

const renderedCache = new Map<string, Promise<BackgroundRemovalImage>>()

export function cachedBackgroundRemovedImage(
  source: BackgroundRemovalSource,
  sensitivity = DEFAULT_BACKGROUND_REMOVAL_SENSITIVITY,
  maxDimension = 4096,
): Promise<BackgroundRemovalImage> {
  const fileKey = source.file ? `${source.file.name}:${source.file.size}:${source.file.lastModified}` : ''
  const key = `ai-v1|${source.nativeMediaId ?? ''}|${source.src}|${fileKey}|${clamp(sensitivity, 0, 100)}|${Math.max(1, maxDimension)}`
  const cached = renderedCache.get(key)
  if (cached) return cached
  if (renderedCache.size >= 12) renderedCache.delete(renderedCache.keys().next().value!)
  const render = renderBackgroundRemovedImage(source, sensitivity, maxDimension)
  renderedCache.set(key, render)
  render.catch(() => renderedCache.delete(key))
  return render
}
