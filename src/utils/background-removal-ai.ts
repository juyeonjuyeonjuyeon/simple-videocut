import type { BackgroundRemovalSource } from './background-removal'

export type BackgroundRemovalPhase = 'idle' | 'downloading' | 'processing' | 'ready' | 'fallback'

export interface BackgroundRemovalStatus {
  phase: BackgroundRemovalPhase
  progress: number
  message?: string
}

interface WorkerResult {
  blob: Blob
  width: number
  height: number
  removedPixels: number
}

type WorkerResponse =
  | { id: number; type: 'progress'; progress: number }
  | ({ id: number; type: 'result' } & WorkerResult)
  | { id: number; type: 'error'; message: string }

let status: BackgroundRemovalStatus = { phase: 'idle', progress: 0 }
const listeners = new Set<(status: BackgroundRemovalStatus) => void>()

const publish = (next: BackgroundRemovalStatus) => {
  status = next
  listeners.forEach((listener) => listener(next))
}

export const getBackgroundRemovalStatus = () => status
export const subscribeBackgroundRemovalStatus = (listener: (status: BackgroundRemovalStatus) => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (value: WorkerResult) => void; reject: (error: Error) => void }>()

function backgroundWorker() {
  if (worker) return worker
  if (typeof Worker === 'undefined') throw new Error('이 기기에서는 로컬 AI 작업자를 사용할 수 없습니다.')
  worker = new Worker(new URL('../workers/background-removal.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data
    const request = pending.get(message.id)
    if (!request) return
    if (message.type === 'progress') {
      publish({ phase: message.progress < 1 ? 'downloading' : 'processing', progress: message.progress })
      return
    }
    pending.delete(message.id)
    if (message.type === 'error') request.reject(new Error(message.message))
    else request.resolve(message)
  }
  worker.onerror = (event) => {
    const error = new Error(event.message || '로컬 AI 실행 중 오류가 발생했습니다.')
    pending.forEach((request) => request.reject(error))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
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

export async function renderAiBackgroundRemovedImage(
  source: BackgroundRemovalSource,
  sensitivity: number,
  maxDimension: number,
): Promise<WorkerResult> {
  const id = nextId++
  publish({ phase: 'processing', progress: 0 })
  try {
    const blob = await sourceBlob(source)
    const result = new Promise<WorkerResult>((resolve, reject) => pending.set(id, { resolve, reject }))
    const sourceKey = source.nativeMediaId
      ? `native:${source.nativeMediaId}`
      : source.file
        ? `file:${source.file.name}:${source.file.size}:${source.file.lastModified}`
        : `url:${source.src}`
    backgroundWorker().postMessage({ id, blob, sourceKey, sensitivity, maxDimension })
    const output = await result
    publish({ phase: 'ready', progress: 1 })
    return output
  } catch (error) {
    publish({ phase: 'fallback', progress: 1, message: error instanceof Error ? error.message : String(error) })
    throw error
  }
}
