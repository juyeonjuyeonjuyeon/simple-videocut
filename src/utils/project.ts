import type { Clip, Overlay, AudioClip, Background, TextOverlay, AspectRatio, ExportSettings, TimelineMarker, TimelineGroup, VisualLayerRef, MediaAsset } from '../types'
import { isStickerKind } from './sticker'
import { isBasicMotionPreset } from './basic-motion'
import { isVisualFilterPreset } from './color-filter'

const DB_NAME = 'simplecut-db'
const STORE = 'projects'
export const AUTOSAVE_KEY = '__autosave__'

interface MediaBlob {
  id: string
  blob?: Blob | ArrayBuffer
  name: string
  type: string
  size: number
  nativeMediaId?: string
}

/** The editable slice of state that a project captures. */
export interface ProjectState {
  mediaLibrary?: MediaAsset[]
  clips: Clip[]
  overlays: Overlay[]
  audios: AudioClip[]
  backgrounds: Background[]
  texts: TextOverlay[]
  markers?: TimelineMarker[]
  groups?: TimelineGroup[]
  visualOrder?: VisualLayerRef[]
  aspectRatio: AspectRatio
  canvasWidth?: number
  canvasHeight?: number
  exportSettings: ExportSettings
}

interface SerializedProject {
  version: 1
  name: string
  savedAt: number
  aspectRatio: AspectRatio
  canvasWidth?: number
  canvasHeight?: number
  exportSettings: ExportSettings
  clips: object[]
  overlays: object[]
  audios: object[]
  backgrounds: object[]
  texts: TextOverlay[]
  mediaLibrary?: object[]
  markers?: TimelineMarker[]
  groups?: TimelineGroup[]
  visualOrder?: VisualLayerRef[]
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

const mediaSize = (media: MediaBlob) => media.size || (media.blob instanceof Blob ? media.blob.size : media.blob?.byteLength || 0)

// ---- serialize / deserialize ----

type WithMedia = { file: File; src: string; sourceSize: number; nativeMediaId?: string } & Record<string, unknown>

function serialize(name: string, s: ProjectState): SerializedProject {
  const fileMap = new Map<File, string>()
  const media: MediaBlob[] = []
  const ref = (file: File, src: string, sourceSize: number, nativeMediaId?: string): string | null => {
    if (!src) return null // color clips have no real media
    if (!fileMap.has(file)) {
      const id = 'm' + media.length
      fileMap.set(file, id)
      media.push({ id, blob: file, name: file.name, type: file.type, size: sourceSize || file.size, nativeMediaId })
    }
    return fileMap.get(file)!
  }
  const strip = (it: WithMedia) => {
    const { file, src, sourceSize, nativeMediaId, ...rest } = it
    return { ...rest, mediaId: ref(file, src, sourceSize, nativeMediaId) }
  }
  return {
    version: 1, name, savedAt: Date.now(),
    aspectRatio: s.aspectRatio, canvasWidth: s.canvasWidth, canvasHeight: s.canvasHeight, exportSettings: s.exportSettings,
    clips: s.clips.map((c) => strip(c as unknown as WithMedia)),
    overlays: s.overlays.map((o) => strip(o as unknown as WithMedia)),
    audios: s.audios.map((a) => strip(a as unknown as WithMedia)),
    backgrounds: s.backgrounds.map((b) => strip(b as unknown as WithMedia)),
    texts: s.texts,
    mediaLibrary: (s.mediaLibrary ?? []).map((asset) => strip(asset as unknown as WithMedia)),
    markers: s.markers ?? [],
    groups: s.groups ?? [],
    visualOrder: s.visualOrder ?? [],
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
      if (!m || mediaSize(m) === 0 || (!m.blob && !m.nativeMediaId)) throw new Error(`원본 미디어가 없거나 비어 있습니다: ${m?.name || id}`)
      files.set(id, m.blob
        ? new File([m.blob], m.name, { type: m.type || (m.blob instanceof Blob ? m.blob.type : '') })
        : new File([], m.name, { type: m.type }))
    }
    return files.get(id)!
  }
  const urlFor = (id: string) => {
    // Create the URL from the reconstructed File. This is more reliable than
    // using an IndexedDB-returned Blob directly in mobile Safari.
    if (!urls.has(id)) {
      const media = byId.get(id)
      if (media?.nativeMediaId && window.simplecutDesktop) urls.set(id, window.simplecutDesktop.mediaUrl(media.nativeMediaId))
      else urls.set(id, URL.createObjectURL(fileFor(id)))
    }
    return urls.get(id)!
  }
  const restore = <T>(it: object): T => {
    const { mediaId, ...rest } = it as { mediaId: string | null } & Record<string, unknown>
    if (mediaId && byId.has(mediaId)) {
      const media = byId.get(mediaId)!
      return {
        ...rest, file: fileFor(mediaId), src: urlFor(mediaId), sourceSize: mediaSize(media),
        nativeMediaId: media.nativeMediaId,
      } as T
    }
    if (rest.kind === 'color') return { ...rest, file: new File([], 'bg'), src: '', sourceSize: 0 } as T
    throw new Error(`원본 파일 연결 정보가 없습니다: ${String(rest.name || '이름 없는 미디어')}`)
  }
  return {
    aspectRatio: p.aspectRatio, canvasWidth: p.canvasWidth, canvasHeight: p.canvasHeight, exportSettings: p.exportSettings,
    clips: p.clips.map((c) => restore<Clip>(c)),
    overlays: p.overlays.map((o) => restore<Overlay>(o)),
    audios: p.audios.map((a) => restore<AudioClip>(a)),
    backgrounds: p.backgrounds.map((b) => restore<Background>(b)),
    texts: p.texts,
    mediaLibrary: (p.mediaLibrary ?? []).map((asset) => restore<MediaAsset>(asset)),
    markers: p.markers ?? [],
    groups: p.groups ?? [],
    visualOrder: p.visualOrder ?? [],
  }
}

type VerifiableMedia = { file: File; src: string; name: string; sourceSize: number; nativeMediaId?: string }

function verifyElement(item: VerifiableMedia, kind: 'video' | 'image' | 'audio'): Promise<void> {
  return new Promise((resolve, reject) => {
    const temporaryUrl = item.nativeMediaId ? null : URL.createObjectURL(item.file)
    const src = temporaryUrl || item.src
    const el = kind === 'image' ? new Image() : document.createElement(kind)
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      if (temporaryUrl) URL.revokeObjectURL(temporaryUrl)
      if (error) reject(error)
      else resolve()
    }
    const timer = window.setTimeout(() => finish(new Error(`파일 확인 시간이 초과됐습니다: ${item.name}`)), 12000)
    if (kind === 'image') {
      el.onload = () => finish()
      el.onerror = () => finish(new Error(`이미지를 복원할 수 없습니다: ${item.name}`))
      ;(el as HTMLImageElement).src = src
    } else {
      const media = el as HTMLMediaElement
      media.preload = kind === 'video' ? 'auto' : 'metadata'
      const ready = () => {
        if (!Number.isFinite(media.duration) || media.duration <= 0) finish(new Error(`${kind === 'video' ? '영상을' : '음성을'} 복원할 수 없습니다: ${item.name}`))
        else if (kind === 'video' && (!(media as HTMLVideoElement).videoWidth || !(media as HTMLVideoElement).videoHeight)) finish(new Error(`영상 프레임을 복원할 수 없습니다: ${item.name}`))
        else finish()
      }
      if (kind === 'video') media.onloadeddata = ready
      else media.onloadedmetadata = ready
      media.onerror = () => finish(new Error(`${kind === 'video' ? '영상을' : '음성을'} 이 브라우저에서 재생할 수 없습니다: ${item.name}`))
      if (kind === 'video') {
        ;(media as HTMLVideoElement).muted = true
        ;(media as HTMLVideoElement).playsInline = true
      }
      media.src = src
    }
  })
}

async function verifyProjectMedia(p: ProjectState): Promise<ProjectState> {
  const checked = new Set<File | string>()
  const verify = async (item: VerifiableMedia, kind: 'video' | 'image' | 'audio') => {
    const key = item.nativeMediaId || item.file
    if (checked.has(key)) return
    checked.add(key)
    if (!item.sourceSize || (!item.nativeMediaId && !item.file.size)) throw new Error(`원본 파일이 비어 있습니다: ${item.name}`)
    await verifyElement(item, kind)
  }
  for (const c of p.clips) if (c.kind !== 'color') await verify(c, c.kind === 'image' ? 'image' : 'video')
  for (const o of p.overlays) await verify(o, o.kind === 'image' ? 'image' : 'video')
  for (const b of p.backgrounds) if (b.kind !== 'color') await verify(b, b.kind === 'image' ? 'image' : 'video')
  for (const a of p.audios) await verify(a, 'audio')
  for (const asset of p.mediaLibrary ?? []) await verify(asset, asset.kind)
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
const nativeMediaCache = new WeakMap<File, string>()
const withArrayBufferMedia = async (project: SerializedProject): Promise<SerializedProject> => ({
  ...project,
  media: await Promise.all(project.media.map(async (item) => ({
    ...item,
    blob: item.blob instanceof Blob ? await item.blob.arrayBuffer() : item.blob,
  }))),
})

const desktopBridge = () => typeof window !== 'undefined' ? window.simplecutDesktop : undefined

async function serializeDesktop(name: string, state: ProjectState): Promise<SerializedProject> {
  const bridge = desktopBridge()
  if (!bridge) throw new Error('데스크톱 프로젝트 저장 기능을 사용할 수 없습니다.')
  const project = serialize(name, state)
  const media = await Promise.all(project.media.map(async (item) => {
    const sourceFile = item.blob instanceof File ? item.blob : null
    let nativeMediaId = item.nativeMediaId || (sourceFile ? nativeMediaCache.get(sourceFile) : undefined)
    let size = mediaSize(item)
    if (!nativeMediaId) {
      let registered: { id: string; size: number }
      try {
        if (!sourceFile) throw new Error('로컬 파일 경로가 없습니다.')
        registered = await bridge.registerMedia(sourceFile)
      } catch {
        if (!item.blob || !size) throw new Error(`데스크톱 보관소에 미디어를 등록할 수 없습니다: ${item.name}`)
        const bytes = item.blob instanceof Blob
          ? new Uint8Array(await item.blob.arrayBuffer())
          : new Uint8Array(item.blob)
        registered = await bridge.importMedia(item.name, bytes)
      }
      nativeMediaId = registered.id
      size = registered.size
      if (sourceFile) nativeMediaCache.set(sourceFile, nativeMediaId)
    }
    return { id: item.id, name: item.name, type: item.type, size, nativeMediaId }
  }))
  return { ...project, media }
}

async function putWebProject(project: SerializedProject): Promise<void> {
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

async function getWebProject(name: string): Promise<SerializedProject | null> {
  if (typeof indexedDB === 'undefined') return null
  const st = await store('readonly')
  const p = await reqP<SerializedProject | undefined>(st.get(name))
  return p || null
}

async function listWebProjects(): Promise<ProjectMeta[]> {
  if (typeof indexedDB === 'undefined') return []
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

async function deleteWebProject(name: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const st = await store('readwrite')
  await reqP(st.delete(name))
}

export async function saveProject(name: string, s: ProjectState): Promise<void> {
  const bridge = desktopBridge()
  if (bridge) {
    const project = await serializeDesktop(name, s)
    assertStoredProject(project)
    await bridge.projectSave(name, project)
    // A successfully migrated project no longer needs its legacy Blob copy.
    await deleteWebProject(name)
    return
  }
  await putWebProject(serialize(name, s))
}

export async function loadProject(name: string): Promise<ProjectState | null> {
  const bridge = desktopBridge()
  let nativeError: unknown = null
  if (bridge) {
    const candidates = await bridge.projectLoad(name)
    for (const candidate of candidates) {
      try {
        assertStoredProject(candidate)
        return await verifyProjectMedia(deserialize(candidate))
      } catch (error) {
        nativeError = error
      }
    }
  }
  const project = await getWebProject(name)
  if (!project) {
    if (nativeError) throw nativeError
    return null
  }
  assertStoredProject(project)
  return verifyProjectMedia(deserialize(project))
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const native = desktopBridge() ? await desktopBridge()!.projectList() : []
  const legacy = await listWebProjects()
  const byName = new Map<string, ProjectMeta>()
  for (const project of [...legacy, ...native]) {
    if (typeof project.name !== 'string' || !Number.isFinite(project.savedAt) || !Number.isFinite(project.size)) continue
    const current = byName.get(project.name)
    if (!current || project.savedAt >= current.savedAt) byName.set(project.name, project)
  }
  return [...byName.values()].sort((a, b) => b.savedAt - a.savedAt)
}

export async function deleteProject(name: string): Promise<void> {
  await Promise.all([
    desktopBridge()?.projectDelete(name),
    deleteWebProject(name),
  ])
}

export async function autosaveMeta(): Promise<ProjectMeta | null> {
  const bridge = desktopBridge()
  if (bridge) {
    for (const candidate of await bridge.projectLoad(AUTOSAVE_KEY)) {
      try {
        assertStoredProject(candidate)
        if (!candidate.clips.length && !candidate.overlays.length && !candidate.audios.length && !candidate.backgrounds.length && !candidate.texts.length && !(candidate.mediaLibrary?.length)) continue
        return { name: candidate.name, savedAt: candidate.savedAt, size: candidate.media.reduce((a, m) => a + mediaSize(m), 0) }
      } catch { /* try an older atomic autosave generation */ }
    }
  }
  const p = await getWebProject(AUTOSAVE_KEY)
  if (!p || (!p.clips.length && !p.overlays.length && !p.audios.length && !p.backgrounds.length && !p.texts.length && !(p.mediaLibrary?.length))) return null
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
    p.media.map(async (m) => {
      let blob: Blob
      if (m.blob instanceof Blob && m.blob.size) blob = m.blob
      else if (m.blob instanceof ArrayBuffer && m.blob.byteLength) blob = new Blob([m.blob], { type: m.type })
      else if (m.nativeMediaId && desktopBridge()) {
        const bytes = Uint8Array.from(await desktopBridge()!.readMedia(m.nativeMediaId))
        blob = new Blob([bytes.buffer], { type: m.type })
      }
      else throw new Error(`공유 파일에 넣을 원본 미디어를 찾을 수 없습니다: ${m.name}`)
      return { id: m.id, name: m.name, type: m.type, data: await blobToBase64(blob) }
    }),
  )
  return new Blob([JSON.stringify({ ...p, media })], { type: 'application/json' })
}
export async function fileBlobToProject(file: File): Promise<ProjectState> {
  return (await fileBlobToProjectWithMeta(file)).project
}

export interface ImportedProject {
  name: string
  project: ProjectState
}

/** Opens a portable project while preserving the name stored inside it. */
export async function fileBlobToProjectWithMeta(file: File): Promise<ImportedProject> {
  if (file.size > PROJECT_LIMITS.maxPortableBytes) throw new Error('프로젝트 파일은 512MB 이하만 열 수 있습니다.')
  const json: unknown = JSON.parse(await file.text())
  assertPortableProject(json)
  const media: MediaBlob[] = (json.media || []).map((m: { id: string; name: string; type: string; data: string }) => ({
    id: m.id, name: m.name, type: m.type, blob: base64ToBlob(m.data, m.type), size: Math.floor(m.data.length * 0.75),
  }))
  return { name: json.name, project: await verifyProjectMedia(deserialize({ ...json, media })) }
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
const validatePositionKeyframes = (value: unknown, length: number, label: string) => {
  if (!Array.isArray(value) || value.length > PROJECT_LIMITS.maxItemsPerTrack) throw new Error(`${label} 위치 키프레임이 잘못되었습니다.`)
  for (const candidate of value) {
    const frame = record(candidate, `${label} 위치 키프레임`)
    text(frame.id, 100, `${label} 키프레임 ID`)
    finite(frame.time, 0, length, `${label} 키프레임 시간`)
    finite(frame.x, 0, 1, `${label} 키프레임 가로 위치`)
    finite(frame.y, 0, 1, `${label} 키프레임 세로 위치`)
    if (!['linear', 'ease-in-out'].includes(String(frame.easing))) throw new Error(`${label} 키프레임 움직임이 잘못되었습니다.`)
  }
}
const validateLibraryAsset = (value: unknown) => {
  const asset = record(value, '미디어 보관함')
  text(asset.id, 100, '미디어 보관함 ID')
  text(asset.name, PROJECT_LIMITS.maxNameLength, '미디어 보관함 이름')
  if (!['video', 'image', 'audio'].includes(String(asset.kind))) throw new Error('미디어 보관함 종류가 잘못되었습니다.')
  finite(asset.duration, 0.01, PROJECT_LIMITS.maxDurationSeconds, '미디어 보관함 길이')
  bool(asset.hasAudio, '미디어 보관함 오디오 정보')
  text(asset.mediaId, 100, '미디어 보관함 연결')
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
    if ('opacity' in item) finite(item.opacity, 0, 1, '텍스트 레이어 투명도')
    if ('locked' in item) bool(item.locked, '텍스트 레이어 잠금')
    if ('hidden' in item) bool(item.hidden, '텍스트 레이어 표시')
    if ('fadeIn' in item) finite(item.fadeIn, 0, PROJECT_LIMITS.maxDurationSeconds, '텍스트 시작 페이드')
    if ('fadeOut' in item) finite(item.fadeOut, 0, PROJECT_LIMITS.maxDurationSeconds, '텍스트 끝 페이드')
    if ('positionKeyframes' in item) validatePositionKeyframes(item.positionKeyframes, (item.end as number) - (item.start as number), '텍스트')
    if ('basicMotion' in item && item.basicMotion !== undefined && !isBasicMotionPreset(item.basicMotion)) throw new Error('텍스트 기본 애니메이션 값이 잘못되었습니다.')
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
  if ('timelineDuration' in item) finite(item.timelineDuration, 0.1, PROJECT_LIMITS.maxDurationSeconds, `${track} 타임라인 길이`)
  if ('fadeIn' in item) finite(item.fadeIn, 0, PROJECT_LIMITS.maxDurationSeconds, `${track} 시작 페이드`)
  if ('fadeOut' in item) finite(item.fadeOut, 0, PROJECT_LIMITS.maxDurationSeconds, `${track} 끝 페이드`)

  if (visual) {
    finite(item.speed, 0.1, 4, `${track} 속도`)
    bool(item.hasAudio, `${track} 오디오 정보`)
    if (![0, 90, 180, 270].includes(Number(item.rotate))) throw new Error(`${track} 회전 값이 잘못되었습니다.`)
    bool(item.flipH, `${track} 좌우 반전`)
    bool(item.flipV, `${track} 상하 반전`)
    const crop = record(item.crop, `${track} 크롭`)
    for (const side of ['top', 'right', 'bottom', 'left']) finite(crop[side], 0, 0.45, `${track} 크롭`)
    const hasBackgroundRemoval = ('backgroundRemovalEnabled' in item && item.backgroundRemovalEnabled !== undefined)
      || ('backgroundRemovalSensitivity' in item && item.backgroundRemovalSensitivity !== undefined)
    if (hasBackgroundRemoval && item.kind !== 'image') throw new Error(`${track} 배경 제거는 이미지에만 사용할 수 있습니다.`)
    if ('backgroundRemovalEnabled' in item && item.backgroundRemovalEnabled !== undefined) {
      bool(item.backgroundRemovalEnabled, `${track} 배경 제거`)
    }
    if ('backgroundRemovalSensitivity' in item && item.backgroundRemovalSensitivity !== undefined) finite(item.backgroundRemovalSensitivity, 0, 100, `${track} 배경 제거 민감도`)
    if ('filterPreset' in item && item.filterPreset !== undefined && !isVisualFilterPreset(item.filterPreset)) throw new Error(`${track} 색 필터 종류가 잘못되었습니다.`)
    if ('filterAmount' in item && item.filterAmount !== undefined) finite(item.filterAmount, 0, 100, `${track} 색 필터 강도`)
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
    if ('scaleY' in item && item.scaleY !== undefined) finite(item.scaleY, 0.05, 1, `${track} 세로 크기`)
    if ('aspectLocked' in item && item.aspectLocked !== undefined) bool(item.aspectLocked, `${track} 비율 고정`)
    if ('angle' in item) finite(item.angle, -180, 180, `${track} 회전`)
    if ('opacity' in item) finite(item.opacity, 0, 1, `${track} 투명도`)
    if ('locked' in item) bool(item.locked, `${track} 잠금`)
    if ('hidden' in item) bool(item.hidden, `${track} 표시`)
    if ('borderWidth' in item) finite(item.borderWidth, 0, 40 / 720, `${track} 테두리 굵기`)
    if ('borderColor' in item) text(item.borderColor, 64, `${track} 테두리 색상`)
    if ('borderStyle' in item && !['solid', 'dashed', 'dotted', 'double'].includes(String(item.borderStyle))) throw new Error(`${track} 테두리 스타일이 잘못되었습니다.`)
    if ('shadowEnabled' in item) bool(item.shadowEnabled, `${track} 그림자`)
    if ('shadowColor' in item) text(item.shadowColor, 64, `${track} 그림자 색상`)
    if ('shadowOpacity' in item) finite(item.shadowOpacity, 0, 1, `${track} 그림자 투명도`)
    if ('shadowBlur' in item) finite(item.shadowBlur, 0, 40 / 720, `${track} 그림자 흐림`)
    if ('shadowX' in item) finite(item.shadowX, -40 / 720, 40 / 720, `${track} 그림자 가로 위치`)
    if ('shadowY' in item) finite(item.shadowY, -40 / 720, 40 / 720, `${track} 그림자 세로 위치`)
    if ('maskShape' in item && !['none', 'rounded', 'circle', 'ellipse', 'heart', 'star', 'hexagon'].includes(String(item.maskShape))) throw new Error(`${track} 마스크 모양이 잘못되었습니다.`)
    if ('sticker' in item && item.sticker !== undefined) {
      const sticker = record(item.sticker, `${track} 스티커`)
      if (!isStickerKind(sticker.kind)) throw new Error(`${track} 스티커 종류가 잘못되었습니다.`)
    }
    if ('positionKeyframes' in item) validatePositionKeyframes(item.positionKeyframes, ((item.trimEnd as number) - (item.trimStart as number)) / (item.speed as number) * (item.repeat as number), track)
    if ('basicMotion' in item && item.basicMotion !== undefined && !isBasicMotionPreset(item.basicMotion)) throw new Error(`${track} 기본 애니메이션 값이 잘못되었습니다.`)
  } else if (track === '클립') {
    if ('canvasX' in item && item.canvasX !== undefined) finite(item.canvasX, 0, 1, `${track} 캔버스 가로 위치`)
    if ('canvasY' in item && item.canvasY !== undefined) finite(item.canvasY, 0, 1, `${track} 캔버스 세로 위치`)
    if ('canvasScale' in item && item.canvasScale !== undefined) finite(item.canvasScale, 0.05, 3, `${track} 캔버스 크기`)
    if ('canvasScaleY' in item && item.canvasScaleY !== undefined) finite(item.canvasScaleY, 0.05, 3, `${track} 캔버스 세로 크기`)
    if ('canvasAspectLocked' in item && item.canvasAspectLocked !== undefined) bool(item.canvasAspectLocked, `${track} 캔버스 비율 고정`)
    if ('canvasAngle' in item && item.canvasAngle !== undefined) finite(item.canvasAngle, -180, 180, `${track} 캔버스 회전`)
  } else if (track === '오디오' || track === '배경') {
    finite(item.start, 0, PROJECT_LIMITS.maxDurationSeconds, `${track} 시작 위치`)
    if (track === '배경') {
      if ('opacity' in item) finite(item.opacity, 0, 1, `${track} 투명도`)
      if ('locked' in item) bool(item.locked, `${track} 잠금`)
      if ('hidden' in item) bool(item.hidden, `${track} 표시`)
    }
  }
}

const validateMarker = (value: unknown) => {
  const marker = record(value, '마커')
  text(marker.id, 100, '마커 ID')
  finite(marker.time, 0, PROJECT_LIMITS.maxDurationSeconds, '마커 위치')
  text(marker.label, 120, '마커 이름')
  text(marker.color, 64, '마커 색상')
}

function assertBaseProject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('올바른 SimpleCut 프로젝트가 아닙니다.')
  const p = value as Record<string, unknown>
  if (p.version !== 1) throw new Error('지원하지 않는 프로젝트 버전입니다.')
  text(p.name, PROJECT_LIMITS.maxNameLength, '프로젝트 이름')
  finite(p.savedAt, 0, Number.MAX_SAFE_INTEGER, '저장 시간')
  if (!['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '5:4', '21:9', '2:1', 'custom'].includes(String(p.aspectRatio))) throw new Error('화면 비율 정보가 잘못되었습니다.')
  if ('canvasWidth' in p && p.canvasWidth !== undefined) finite(p.canvasWidth, 64, 7680, '캔버스 너비')
  if ('canvasHeight' in p && p.canvasHeight !== undefined) finite(p.canvasHeight, 64, 4320, '캔버스 높이')
  if (p.aspectRatio === 'custom' && (p.canvasWidth === undefined || p.canvasHeight === undefined)) throw new Error('사용자 캔버스 크기가 없습니다.')
  const settings = record(p.exportSettings, '내보내기 설정')
  finite(settings.height, 64, 4320, '내보내기 해상도')
  if (!['mp4', 'webm'].includes(String(settings.format))) throw new Error('내보내기 형식이 잘못되었습니다.')
  text(settings.filename, 120, '내보내기 파일 이름')
  for (const key of ['clips', 'overlays', 'audios', 'backgrounds', 'texts', 'media']) {
    if (!Array.isArray(p[key])) throw new Error(`프로젝트의 ${key} 항목이 잘못되었습니다.`)
    if ((p[key] as unknown[]).length > PROJECT_LIMITS.maxItemsPerTrack) throw new Error(`프로젝트의 ${key} 항목 수가 너무 많습니다.`)
  }
  if (p.mediaLibrary !== undefined) {
    if (!Array.isArray(p.mediaLibrary) || p.mediaLibrary.length > PROJECT_LIMITS.maxItemsPerTrack) throw new Error('프로젝트의 미디어 보관함 항목이 잘못되었습니다.')
    for (const asset of p.mediaLibrary) validateLibraryAsset(asset)
  }
  if (p.markers !== undefined) {
    if (!Array.isArray(p.markers) || p.markers.length > PROJECT_LIMITS.maxItemsPerTrack) throw new Error('프로젝트의 markers 항목이 잘못되었습니다.')
    for (const marker of p.markers) validateMarker(marker)
  }
  if (p.groups !== undefined) {
    if (!Array.isArray(p.groups) || p.groups.length > PROJECT_LIMITS.maxItemsPerTrack) throw new Error('프로젝트의 그룹 정보가 잘못되었습니다.')
    for (const candidate of p.groups) {
      const group = record(candidate, '그룹')
      text(group.id, 100, '그룹 ID')
      text(group.name, 120, '그룹 이름')
      if (!Array.isArray(group.members) || group.members.length < 2 || group.members.length > PROJECT_LIMITS.maxItemsPerTrack) throw new Error('그룹 구성 정보가 잘못되었습니다.')
      for (const memberCandidate of group.members) {
        const member = record(memberCandidate, '그룹 구성')
        if (!['clip', 'overlay', 'audio', 'text', 'background'].includes(String(member.type))) throw new Error('그룹 항목 종류가 잘못되었습니다.')
        text(member.id, 100, '그룹 항목 ID')
      }
    }
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
    const repeated = ((trimEnd - trimStart) / speed) * repeat
    const exact = typeof item.timelineDuration === 'number' ? item.timelineDuration : repeated
    return Math.min(exact, repeated)
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
  for (const value of (p.mediaLibrary ?? []) as unknown[]) {
    const asset = value as Record<string, unknown>
    if (typeof asset.mediaId !== 'string' || !ids.has(asset.mediaId)) throw new Error('프로젝트의 미디어 보관함 연결 정보가 잘못되었습니다.')
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
    const blobBytes = m.blob instanceof Blob ? m.blob.size : m.blob instanceof ArrayBuffer ? m.blob.byteLength : 0
    const declaredBytes = typeof m.size === 'number' && Number.isFinite(m.size) ? m.size : 0
    const managed = typeof m.nativeMediaId === 'string' && /^[0-9a-f-]{36}(?:\.[a-z0-9]{1,10})?$/.test(m.nativeMediaId)
    if (typeof m.id !== 'string' || typeof m.name !== 'string' || typeof m.type !== 'string' || Math.max(blobBytes, declaredBytes) <= 0 || (!blobBytes && !managed)) {
      throw new Error('저장된 미디어 정보가 불완전합니다.')
    }
    if (ids.has(m.id)) throw new Error('저장된 미디어 ID가 중복되었습니다.')
    ids.add(m.id)
    text(m.name, PROJECT_LIMITS.maxNameLength, '저장 미디어 이름')
  }
  assertMediaReferences(p, ids)
}
