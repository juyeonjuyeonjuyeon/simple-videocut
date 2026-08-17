import type { Clip, Overlay, AudioClip, Background, TextOverlay, AspectRatio, ExportSettings } from '../types'

const DB_NAME = 'simplecut-db'
const STORE = 'projects'
export const AUTOSAVE_KEY = '__autosave__'

interface MediaBlob { id: string; blob: Blob | ArrayBuffer; name: string; type: string; nativePath?: string }

/** The editable slice of state that a project captures. */
export interface ProjectState {
  clips: Clip[]
  overlays: Overlay[]
  audios: AudioClip[]
  backgrounds: Background[]
  texts: TextOverlay[]
  aspectRatio: AspectRatio
  exportSettings: ExportSettings
}

interface SerializedProject {
  version: 1
  name: string
  savedAt: number
  aspectRatio: AspectRatio
  exportSettings: ExportSettings
  clips: object[]
  overlays: object[]
  audios: object[]
  backgrounds: object[]
  texts: TextOverlay[]
  media: MediaBlob[]
}

export const PROJECT_LIMITS = {
  maxPortableBytes: 512 * 1024 * 1024,
  maxDecodedMediaBytes: 384 * 1024 * 1024,
  maxItemsPerTrack: 200,
  maxNameLength: 255,
  maxTextLength: 10_000,
  maxDurationSeconds: 6 * 60 * 60,
} as const

export function assertPortableMediaBudget(encodedLengths: number[]): void {
  const decodedBytes = encodedLengths.reduce((sum, length) => sum + Math.floor(length * 0.75), 0)
  if (decodedBytes > PROJECT_LIMITS.maxDecodedMediaBytes) throw new Error('프로젝트의 디코딩된 미디어 용량이 너무 큽니다.')
}

export interface ProjectMeta { name: string; savedAt: number; size: number }

const mediaSize = (media: MediaBlob) => media.blob instanceof Blob ? media.blob.size : media.blob.byteLength

// ---- serialize / deserialize ----

type WithMedia = { file: File; src: string; nativePath?: string } & Record<string, unknown>

function serialize(name: string, s: ProjectState): SerializedProject {
  const fileMap = new Map<File, string>()
  const media: MediaBlob[] = []
  const ref = (file: File, src: string, nativePath?: string): string | null => {
    if (!src) return null // color clips have no real media
    if (!fileMap.has(file)) {
      const id = 'm' + media.length
      fileMap.set(file, id)
      media.push({ id, blob: file, name: file.name, type: file.type, nativePath })
    }
    return fileMap.get(file)!
  }
  const strip = (it: WithMedia) => {
    const { file, src, nativePath, ...rest } = it
    return { ...rest, mediaId: ref(file, src, nativePath) }
  }
  return {
    version: 1, name, savedAt: Date.now(),
    aspectRatio: s.aspectRatio, exportSettings: s.exportSettings,
    clips: s.clips.map((c) => strip(c as unknown as WithMedia)),
    overlays: s.overlays.map((o) => strip(o as unknown as WithMedia)),
    audios: s.audios.map((a) => strip(a as unknown as WithMedia)),
    backgrounds: s.backgrounds.map((b) => strip(b as unknown as WithMedia)),
    texts: s.texts,
    media,
  }
}

function deserialize(p: SerializedProject): ProjectState {
  const byId = new Map(p.media.map((m) => [m.id, m]))
  const files = new Map<string, File>()
  const urls = new Map<string, string>()
  const fileFor = (id: string) => {
    if (!files.has(id)) {
      const m = byId.get(id)
      if (!m || !m.blob || mediaSize(m) === 0) throw new Error(`원본 미디어가 없거나 비어 있습니다: ${m?.name || id}`)
      files.set(id, new File([m.blob], m.name, { type: m.type || (m.blob instanceof Blob ? m.blob.type : '') }))
    }
    return files.get(id)!
  }
  const urlFor = (id: string) => {
    // Create the URL from the reconstructed File. This is more reliable than
    // using an IndexedDB-returned Blob directly in mobile Safari.
    if (!urls.has(id)) urls.set(id, URL.createObjectURL(fileFor(id)))
    return urls.get(id)!
  }
  const restore = <T>(it: object): T => {
    const { mediaId, ...rest } = it as { mediaId: string | null } & Record<string, unknown>
    if (mediaId && byId.has(mediaId)) {
      return { ...rest, file: fileFor(mediaId), src: urlFor(mediaId), nativePath: byId.get(mediaId)?.nativePath } as T
    }
    if (rest.kind === 'color') return { ...rest, file: new File([], 'bg'), src: '' } as T
    throw new Error(`원본 파일 연결 정보가 없습니다: ${String(rest.name || '이름 없는 미디어')}`)
  }
  return {
    aspectRatio: p.aspectRatio, exportSettings: p.exportSettings,
    clips: p.clips.map((c) => restore<Clip>(c)),
    overlays: p.overlays.map((o) => restore<Overlay>(o)),
    audios: p.audios.map((a) => restore<AudioClip>(a)),
    backgrounds: p.backgrounds.map((b) => restore<Background>(b)),
    texts: p.texts,
  }
}

function verifyElement(file: File, kind: 'video' | 'image' | 'audio'): Promise<void> {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file)
    const el = kind === 'image' ? new Image() : document.createElement(kind)
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      URL.revokeObjectURL(src)
      if (error) reject(error)
      else resolve()
    }
    const timer = window.setTimeout(() => finish(new Error(`파일 확인 시간이 초과됐습니다: ${file.name}`)), 12000)
    if (kind === 'image') {
      el.onload = () => finish()
      el.onerror = () => finish(new Error(`이미지를 복원할 수 없습니다: ${file.name}`))
      ;(el as HTMLImageElement).src = src
    } else {
      const media = el as HTMLMediaElement
      media.preload = kind === 'video' ? 'auto' : 'metadata'
      const ready = () => {
        if (!Number.isFinite(media.duration) || media.duration <= 0) finish(new Error(`${kind === 'video' ? '영상을' : '음성을'} 복원할 수 없습니다: ${file.name}`))
        else if (kind === 'video' && (!(media as HTMLVideoElement).videoWidth || !(media as HTMLVideoElement).videoHeight)) finish(new Error(`영상 프레임을 복원할 수 없습니다: ${file.name}`))
        else finish()
      }
      if (kind === 'video') media.onloadeddata = ready
      else media.onloadedmetadata = ready
      media.onerror = () => finish(new Error(`${kind === 'video' ? '영상을' : '음성을'} 이 브라우저에서 재생할 수 없습니다: ${file.name}`))
      if (kind === 'video') {
        ;(media as HTMLVideoElement).muted = true
        ;(media as HTMLVideoElement).playsInline = true
      }
      media.src = src
    }
  })
}

async function verifyProjectMedia(p: ProjectState): Promise<ProjectState> {
  const checked = new Set<File>()
  const verify = async (file: File, kind: 'video' | 'image' | 'audio') => {
    if (checked.has(file)) return
    checked.add(file)
    if (!file.size) throw new Error(`원본 파일이 비어 있습니다: ${file.name}`)
    await verifyElement(file, kind)
  }
  for (const c of p.clips) if (c.kind !== 'color') await verify(c.file, c.kind === 'image' ? 'image' : 'video')
  for (const o of p.overlays) await verify(o.file, o.kind === 'image' ? 'image' : 'video')
  for (const b of p.backgrounds) if (b.kind !== 'color') await verify(b.file, b.kind === 'image' ? 'image' : 'video')
  for (const a of p.audios) await verify(a.file, 'audio')
  return p
}

// ---- IndexedDB ----

function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'name' })
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function store(mode: IDBTransactionMode) {
  const db = await openDB()
  return db.transaction(STORE, mode).objectStore(STORE)
}

let useArrayBufferStorage = false
const withArrayBufferMedia = async (project: SerializedProject): Promise<SerializedProject> => ({
  ...project,
  media: await Promise.all(project.media.map(async (item) => ({
    ...item,
    blob: item.blob instanceof Blob ? await item.blob.arrayBuffer() : item.blob,
  }))),
})

export async function saveProject(name: string, s: ProjectState): Promise<void> {
  const project = serialize(name, s)
  const put = async (value: SerializedProject) => {
    const st = await store('readwrite')
    await reqP(st.put(value))
  }
  if (useArrayBufferStorage) {
    await put(await withArrayBufferMedia(project))
    return
  }
  try {
    await put(project)
  } catch (error) {
    const name = (error as DOMException)?.name
    if (name !== 'UnknownError' && name !== 'DataCloneError') throw error
    // WebKit cannot persist Blob/File values in IndexedDB on some versions.
    // ArrayBuffer is structured-clone safe there, so retry with the same bytes.
    useArrayBufferStorage = true
    await put(await withArrayBufferMedia(project))
  }
}
export async function loadProject(name: string): Promise<ProjectState | null> {
  const st = await store('readonly')
  const p = await reqP<SerializedProject | undefined>(st.get(name))
  if (!p) return null
  assertStoredProject(p)
  return verifyProjectMedia(deserialize(p))
}
export async function listProjects(): Promise<ProjectMeta[]> {
  const st = await store('readonly')
  const all = await reqP<SerializedProject[]>(st.getAll())
  return all
    .filter((p) => {
      if (p.name === AUTOSAVE_KEY) return false
      try { assertStoredProject(p); return true } catch { return false }
    })
    .map((p) => ({ name: p.name, savedAt: p.savedAt, size: p.media.reduce((a, m) => a + mediaSize(m), 0) }))
    .sort((a, b) => b.savedAt - a.savedAt)
}
export async function deleteProject(name: string): Promise<void> {
  const st = await store('readwrite')
  await reqP(st.delete(name))
}
export async function autosaveMeta(): Promise<ProjectMeta | null> {
  const st = await store('readonly')
  const p = await reqP<SerializedProject | undefined>(st.get(AUTOSAVE_KEY))
  if (!p || (!p.clips.length && !p.overlays.length && !p.audios.length && !p.backgrounds.length && !p.texts.length)) return null
  assertStoredProject(p)
  return { name: p.name, savedAt: p.savedAt, size: p.media.reduce((a, m) => a + mediaSize(m), 0) }
}

// ---- portable file bundle (.scut.json) for iCloud Drive / sharing ----

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((res) => {
    const r = new FileReader()
    r.onload = () => res((r.result as string).split(',')[1] || '')
    r.readAsDataURL(blob)
  })
}
function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type })
}

export async function projectToFileBlob(name: string, s: ProjectState): Promise<Blob> {
  const p = serialize(name, s)
  const decodedBytes = p.media.reduce((sum, item) => sum + mediaSize(item), 0)
  if (decodedBytes > PROJECT_LIMITS.maxDecodedMediaBytes) {
    throw new Error('공유용 프로젝트 파일은 원본 미디어 합계가 384MB 이하일 때 만들 수 있습니다.')
  }
  const media = await Promise.all(
    p.media.map(async (m) => ({
      id: m.id, name: m.name, type: m.type,
      data: await blobToBase64(m.blob instanceof Blob ? m.blob : new Blob([m.blob], { type: m.type })),
    })),
  )
  return new Blob([JSON.stringify({ ...p, media })], { type: 'application/json' })
}
export async function fileBlobToProject(file: File): Promise<ProjectState> {
  if (file.size > PROJECT_LIMITS.maxPortableBytes) throw new Error('프로젝트 파일은 512MB 이하만 열 수 있습니다.')
  const json: unknown = JSON.parse(await file.text())
  assertPortableProject(json)
  const media: MediaBlob[] = (json.media || []).map((m: { id: string; name: string; type: string; data: string }) => ({
    id: m.id, name: m.name, type: m.type, blob: base64ToBlob(m.data, m.type),
  }))
  return verifyProjectMedia(deserialize({ ...json, media }))
}

type PortableProject = Omit<SerializedProject, 'media'> & {
  media: { id: string; name: string; type: string; data: string }[]
}

const finite = (value: unknown, min: number, max: number, label: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} 값이 잘못되었습니다.`)
}
const text = (value: unknown, max: number, label: string) => {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} 값이 잘못되었습니다.`)
}
const bool = (value: unknown, label: string) => {
  if (typeof value !== 'boolean') throw new Error(`${label} 값이 잘못되었습니다.`)
}
const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 정보가 잘못되었습니다.`)
  return value as Record<string, unknown>
}
const validateItem = (value: unknown, track: string) => {
  const item = record(value, track)
  text(item.id, 100, `${track} ID`)
  if (track !== '텍스트') text(item.name, PROJECT_LIMITS.maxNameLength, `${track} 이름`)
  if (track === '텍스트') {
    text(item.text, PROJECT_LIMITS.maxTextLength, '텍스트 내용')
    finite(item.start, 0, PROJECT_LIMITS.maxDurationSeconds, '텍스트 시작')
    finite(item.end, 0, PROJECT_LIMITS.maxDurationSeconds, '텍스트 종료')
    if ((item.end as number) < (item.start as number)) throw new Error('텍스트 시간 범위가 잘못되었습니다.')
    finite(item.x, 0, 1, '텍스트 가로 위치')
    finite(item.y, 0, 1, '텍스트 세로 위치')
    finite(item.size, 0.001, 1, '텍스트 크기')
    text(item.color, 64, '텍스트 색상')
    finite(item.colorAlpha, 0, 1, '텍스트 투명도')
    bool(item.box, '텍스트 배경')
    text(item.boxColor, 64, '텍스트 배경 색상')
    finite(item.boxAlpha, 0, 1, '텍스트 배경 투명도')
    text(item.font, 500, '텍스트 글꼴')
    finite(item.strokeWidth, 0, 1, '텍스트 외곽선')
    text(item.strokeColor, 64, '텍스트 외곽선 색상')
    bool(item.shadow, '텍스트 그림자')
    text(item.shadowColor, 64, '텍스트 그림자 색상')
    finite(item.shadowBlur, 0, 2, '텍스트 그림자 흐림')
    finite(item.shadowDist, 0, 2, '텍스트 그림자 거리')
    if (!['left', 'center', 'right', 'justify'].includes(String(item.align))) throw new Error('텍스트 정렬 값이 잘못되었습니다.')
    // angle was added after the first project format shipped.
    if ('angle' in item) finite(item.angle, -180, 180, '텍스트 회전')
    return
  }
  const visual = track !== '오디오'
  if (visual && !['video', 'image', 'color'].includes(String(item.kind))) throw new Error(`${track} 종류가 잘못되었습니다.`)
  finite(item.duration, 0.01, PROJECT_LIMITS.maxDurationSeconds, `${track} 길이`)
  finite(item.trimStart, 0, PROJECT_LIMITS.maxDurationSeconds, `${track} 시작 트림`)
  finite(item.trimEnd, 0.01, PROJECT_LIMITS.maxDurationSeconds, `${track} 끝 트림`)
  if ((item.trimEnd as number) <= (item.trimStart as number) || (item.trimEnd as number) > (item.duration as number)) throw new Error(`${track} 트림 범위가 잘못되었습니다.`)
  finite(item.volume, 0, 2, `${track} 음량`)
  bool(item.muted, `${track} 음소거`)
  text(item.color, 64, `${track} 색상`)
  finite(item.repeat, 1, 99, `${track} 반복`)
  if (!Number.isInteger(item.repeat as number)) throw new Error(`${track} 반복 값이 잘못되었습니다.`)

  if (visual) {
    finite(item.speed, 0.1, 4, `${track} 속도`)
    bool(item.hasAudio, `${track} 오디오 정보`)
    if (![0, 90, 180, 270].includes(Number(item.rotate))) throw new Error(`${track} 회전 값이 잘못되었습니다.`)
    bool(item.flipH, `${track} 좌우 반전`)
    bool(item.flipV, `${track} 상하 반전`)
    const crop = record(item.crop, `${track} 크롭`)
    for (const side of ['top', 'right', 'bottom', 'left']) finite(crop[side], 0, 0.45, `${track} 크롭`)
    if (item.kind === 'color') {
      if (item.mediaId !== null) throw new Error(`${track} 미디어 연결 값이 잘못되었습니다.`)
      text(item.bgColor, 64, `${track} 배경 색상`)
    } else {
      text(item.mediaId, 100, `${track} 미디어 연결`)
    }
  } else {
    text(item.mediaId, 100, `${track} 미디어 연결`)
  }

  if (track === '오버레이') {
    finite(item.start, 0, PROJECT_LIMITS.maxDurationSeconds, `${track} 시작 위치`)
    finite(item.x, 0, 1, `${track} 가로 위치`)
    finite(item.y, 0, 1, `${track} 세로 위치`)
    finite(item.scale, 0.1, 1, `${track} 크기`)
    if ('angle' in item) finite(item.angle, -180, 180, `${track} 회전`)
  } else if (track === '오디오' || track === '배경') {
    finite(item.start, 0, PROJECT_LIMITS.maxDurationSeconds, `${track} 시작 위치`)
  }
}

function assertBaseProject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('올바른 SimpleCut 프로젝트가 아닙니다.')
  const p = value as Record<string, unknown>
  if (p.version !== 1) throw new Error('지원하지 않는 프로젝트 버전입니다.')
  text(p.name, PROJECT_LIMITS.maxNameLength, '프로젝트 이름')
  finite(p.savedAt, 0, Number.MAX_SAFE_INTEGER, '저장 시간')
  if (!['16:9', '9:16', '1:1'].includes(String(p.aspectRatio))) throw new Error('화면 비율 정보가 잘못되었습니다.')
  const settings = record(p.exportSettings, '내보내기 설정')
  if (![480, 720, 1080, 1440, 2160].includes(Number(settings.height))) throw new Error('내보내기 해상도가 잘못되었습니다.')
  if (!['mp4', 'webm'].includes(String(settings.format))) throw new Error('내보내기 형식이 잘못되었습니다.')
  text(settings.filename, 120, '내보내기 파일 이름')
  for (const key of ['clips', 'overlays', 'audios', 'backgrounds', 'texts', 'media']) {
    if (!Array.isArray(p[key])) throw new Error(`프로젝트의 ${key} 항목이 잘못되었습니다.`)
    if ((p[key] as unknown[]).length > PROJECT_LIMITS.maxItemsPerTrack) throw new Error(`프로젝트의 ${key} 항목 수가 너무 많습니다.`)
  }
  for (const item of p.clips as unknown[]) validateItem(item, '클립')
  for (const item of p.overlays as unknown[]) validateItem(item, '오버레이')
  for (const item of p.audios as unknown[]) validateItem(item, '오디오')
  for (const item of p.backgrounds as unknown[]) validateItem(item, '배경')
  for (const item of p.texts as unknown[]) validateItem(item, '텍스트')

  const clipDuration = (value: unknown) => {
    const item = value as Record<string, unknown>
    const trimStart = typeof item.trimStart === 'number' ? item.trimStart : 0
    const trimEnd = typeof item.trimEnd === 'number' ? item.trimEnd : Number(item.duration || 0)
    const speed = typeof item.speed === 'number' ? item.speed : 1
    const repeat = typeof item.repeat === 'number' ? item.repeat : 1
    return ((trimEnd - trimStart) / speed) * repeat
  }
  const mainDuration = (p.clips as unknown[]).reduce<number>((sum, item) => sum + clipDuration(item), 0)
  if (mainDuration > PROJECT_LIMITS.maxDurationSeconds) throw new Error('프로젝트 전체 길이는 6시간을 넘을 수 없습니다.')
  for (const key of ['overlays', 'audios', 'backgrounds']) {
    for (const value of p[key] as unknown[]) {
      const item = value as Record<string, unknown>
      const end = Number(item.start || 0) + clipDuration(item)
      if (end > PROJECT_LIMITS.maxDurationSeconds) throw new Error('프로젝트 전체 길이는 6시간을 넘을 수 없습니다.')
    }
  }
  return p
}

function assertMediaReferences(p: Record<string, unknown>, ids: Set<string>): void {
  for (const key of ['clips', 'overlays', 'audios', 'backgrounds']) {
    for (const value of p[key] as unknown[]) {
      const item = value as Record<string, unknown>
      if (item.kind === 'color') continue
      if (typeof item.mediaId !== 'string' || !ids.has(item.mediaId)) throw new Error('프로젝트의 미디어 연결 정보가 잘못되었습니다.')
    }
  }
}

export function assertPortableProject(value: unknown): asserts value is PortableProject {
  const p = assertBaseProject(value)
  const ids = new Set<string>()
  const encodedLengths: number[] = []
  for (const media of p.media as unknown[]) {
    const m = record(media, '미디어')
    if (typeof m.id !== 'string' || typeof m.name !== 'string' || typeof m.type !== 'string' || typeof m.data !== 'string') {
      throw new Error('미디어 정보가 불완전합니다.')
    }
    if (ids.has(m.id)) throw new Error('미디어 ID가 중복되었습니다.')
    ids.add(m.id)
    text(m.name, PROJECT_LIMITS.maxNameLength, '미디어 이름')
    encodedLengths.push(m.data.length)
  }
  assertPortableMediaBudget(encodedLengths)
  assertMediaReferences(p, ids)
}

function assertStoredProject(value: unknown): asserts value is SerializedProject {
  const p = assertBaseProject(value)
  const ids = new Set<string>()
  for (const media of p.media as unknown[]) {
    const m = record(media, '저장 미디어')
    const storedBytes = m.blob instanceof Blob ? m.blob.size : m.blob instanceof ArrayBuffer ? m.blob.byteLength : 0
    if (typeof m.id !== 'string' || typeof m.name !== 'string' || typeof m.type !== 'string' || storedBytes <= 0) {
      throw new Error('저장된 미디어 정보가 불완전합니다.')
    }
    if (ids.has(m.id)) throw new Error('저장된 미디어 ID가 중복되었습니다.')
    ids.add(m.id)
    text(m.name, PROJECT_LIMITS.maxNameLength, '저장 미디어 이름')
    if ('nativePath' in m && m.nativePath !== undefined) text(m.nativePath, 4096, '원본 미디어 경로')
  }
  assertMediaReferences(p, ids)
}
