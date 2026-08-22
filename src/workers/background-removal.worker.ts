import * as ort from 'onnxruntime-web/wasm'
import { foregroundAlpha } from '../utils/background-alpha'

const MODEL_URL = 'https://huggingface.co/onnx-community/ormbg-ONNX/resolve/main/onnx/model_quantized.onnx'
const MODEL_CACHE = 'simplecut-background-removal-v1'
const MODEL_SIZE = 1024

type WorkerRequest = {
  id: number
  blob: Blob
  sourceKey: string
  sensitivity: number
  maxDimension: number
}

type WorkerResponse =
  | { id: number; type: 'progress'; progress: number }
  | { id: number; type: 'result'; blob: Blob; width: number; height: number; removedPixels: number }
  | { id: number; type: 'error'; message: string }

let sessionPromise: Promise<ort.InferenceSession> | null = null
const maskCache = new Map<string, Float32Array>()

function report(id: number, progress: number) {
  self.postMessage({ id, type: 'progress', progress } satisfies WorkerResponse)
}

async function fetchModel(id: number): Promise<ArrayBuffer> {
  const cache = 'caches' in self ? await caches.open(MODEL_CACHE).catch(() => null) : null
  const cached = cache ? await cache.match(MODEL_URL).catch(() => undefined) : undefined
  if (cached) {
    report(id, 1)
    return cached.arrayBuffer()
  }

  const response = await fetch(MODEL_URL)
  if (!response.ok) throw new Error(`AI 모델을 내려받지 못했습니다. (${response.status})`)
  if (!response.body) {
    const buffer = await response.arrayBuffer()
    report(id, 1)
    return buffer
  }

  const total = Number(response.headers.get('content-length')) || 0
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    report(id, total ? Math.min(0.99, received / total) : 0.5)
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const stored = new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })
  if (cache) await cache.put(MODEL_URL, stored.clone()).catch(() => {})
  report(id, 1)
  return bytes.buffer
}

function getSession(id: number) {
  if (!sessionPromise) {
    ort.env.wasm.numThreads = 1
    sessionPromise = fetchModel(id).then((model) => ort.InferenceSession.create(model, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })).catch((error) => {
      sessionPromise = null
      throw error
    })
  }
  return sessionPromise
}

async function removeBackground(request: WorkerRequest) {
  const bitmap = await createImageBitmap(request.blob)
  try {
    const scale = Math.min(1, Math.max(1, request.maxDimension) / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const sourceCanvas = new OffscreenCanvas(width, height)
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
    if (!sourceContext) throw new Error('이미지 처리를 시작할 수 없습니다.')
    sourceContext.drawImage(bitmap, 0, 0, width, height)
    const source = sourceContext.getImageData(0, 0, width, height)

    const plane = MODEL_SIZE * MODEL_SIZE
    let confidenceMask = maskCache.get(request.sourceKey)
    if (!confidenceMask) {
      const inputCanvas = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE)
      const inputContext = inputCanvas.getContext('2d', { willReadFrequently: true })
      if (!inputContext) throw new Error('AI 입력 이미지를 만들 수 없습니다.')
      inputContext.drawImage(bitmap, 0, 0, MODEL_SIZE, MODEL_SIZE)
      const pixels = inputContext.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data
      const input = new Float32Array(plane * 3)
      for (let i = 0; i < plane; i += 1) {
        input[i] = pixels[i * 4] / 255
        input[plane + i] = pixels[i * 4 + 1] / 255
        input[plane * 2 + i] = pixels[i * 4 + 2] / 255
      }
      const session = await getSession(request.id)
      const tensor = new ort.Tensor('float32', input, [1, 3, MODEL_SIZE, MODEL_SIZE])
      const outputMap = await session.run({ [session.inputNames[0]]: tensor })
      const output = outputMap[session.outputNames[0]]
      const raw = output.data as Float32Array
      const needsSigmoid = raw.some((value) => value < -0.00001 || value > 1.00001)
      confidenceMask = new Float32Array(plane)
      for (let i = 0; i < plane; i += 1) confidenceMask[i] = needsSigmoid ? 1 / (1 + Math.exp(-raw[i])) : raw[i]
      if (maskCache.size >= 4) maskCache.delete(maskCache.keys().next().value!)
      maskCache.set(request.sourceKey, confidenceMask)
    }

    const maskPixels = new Uint8ClampedArray(plane * 4)
    for (let i = 0; i < plane; i += 1) {
      const confidence = confidenceMask[i]
      const alpha = Math.round(foregroundAlpha(confidence, request.sensitivity) * 255)
      const offset = i * 4
      maskPixels[offset] = alpha
      maskPixels[offset + 1] = alpha
      maskPixels[offset + 2] = alpha
      maskPixels[offset + 3] = 255
    }

    const maskCanvas = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE)
    const maskContext = maskCanvas.getContext('2d')
    if (!maskContext) throw new Error('AI 마스크를 만들 수 없습니다.')
    maskContext.putImageData(new ImageData(maskPixels, MODEL_SIZE, MODEL_SIZE), 0, 0)
    const scaledMask = new OffscreenCanvas(width, height)
    const scaledContext = scaledMask.getContext('2d', { willReadFrequently: true })
    if (!scaledContext) throw new Error('AI 마스크 크기를 조절할 수 없습니다.')
    scaledContext.imageSmoothingEnabled = true
    scaledContext.imageSmoothingQuality = 'high'
    scaledContext.drawImage(maskCanvas, 0, 0, width, height)
    const alphaPixels = scaledContext.getImageData(0, 0, width, height).data
    let removedPixels = 0
    for (let i = 0; i < width * height; i += 1) {
      const offset = i * 4
      const nextAlpha = Math.round(source.data[offset + 3] * alphaPixels[offset] / 255)
      if (nextAlpha < source.data[offset + 3]) removedPixels += 1
      source.data[offset + 3] = nextAlpha
    }
    sourceContext.putImageData(source, 0, 0)
    return { blob: await sourceCanvas.convertToBlob({ type: 'image/png' }), width, height, removedPixels }
  } finally {
    bitmap.close()
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  workerQueue = workerQueue.then(async () => {
    try {
      const result = await removeBackground(event.data)
      self.postMessage({ id: event.data.id, type: 'result', ...result } satisfies WorkerResponse)
    } catch (error) {
      self.postMessage({ id: event.data.id, type: 'error', message: error instanceof Error ? error.message : String(error) } satisfies WorkerResponse)
    }
  })
}

let workerQueue = Promise.resolve()
