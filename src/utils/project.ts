import type { Clip, Overlay, AudioClip, Background, TextOverlay, AspectRatio, ExportSettings } from '../types'

const DB_NAME = 'simplecut-db'
const STORE = 'projects'
export const AUTOSAVE_KEY = '__autosave__'

interface MediaBlob { id: string; blob: Blob; name: string; type: string }

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

export interface ProjectMeta { name: string; savedAt: number; size: number }

// ---- serialize / deserialize ----

type WithMedia = { file: File; src: string } & Record<string, unknown>

function serialize(name: string, s: ProjectState): SerializedProject {
  const fileMap = new Map<File, string>()
  const media: MediaBlob[] = []
  const ref = (file: File, src: string): string | null => {
    if (!src) return null // color clips have no real media
    if (!fileMap.has(file)) {
      const id = 'm' + media.length
      fileMap.set(file, id)
      media.push({ id, blob: file, name: file.name, type: file.type })
    }
    return fileMap.get(file)!
  }
  const strip = (it: WithMedia) => {
    const { file, src, ...rest } = it
    return { ...rest, mediaId: ref(file, src) }
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
  const urls = new Map<string, string>()
  const urlFor = (id: string) => {
    if (!urls.has(id)) urls.set(id, URL.createObjectURL(byId.get(id)!.blob))
    return urls.get(id)!
  }
  const restore = <T>(it: object): T => {
    const { mediaId, ...rest } = it as { mediaId: string | null } & Record<string, unknown>
    if (mediaId && byId.has(mediaId)) {
      const m = byId.get(mediaId)!
      return { ...rest, file: new File([m.blob], m.name, { type: m.type }), src: urlFor(mediaId) } as T
    }
    return { ...rest, file: new File([], 'bg'), src: '' } as T
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

export async function saveProject(name: string, s: ProjectState): Promise<void> {
  const st = await store('readwrite')
  await reqP(st.put(serialize(name, s)))
}
export async function loadProject(name: string): Promise<ProjectState | null> {
  const st = await store('readonly')
  const p = await reqP<SerializedProject | undefined>(st.get(name))
  return p ? deserialize(p) : null
}
export async function listProjects(): Promise<ProjectMeta[]> {
  const st = await store('readonly')
  const all = await reqP<SerializedProject[]>(st.getAll())
  return all
    .filter((p) => p.name !== AUTOSAVE_KEY)
    .map((p) => ({ name: p.name, savedAt: p.savedAt, size: p.media.reduce((a, m) => a + m.blob.size, 0) }))
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
  return { name: p.name, savedAt: p.savedAt, size: p.media.reduce((a, m) => a + m.blob.size, 0) }
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
  const media = await Promise.all(
    p.media.map(async (m) => ({ id: m.id, name: m.name, type: m.type, data: await blobToBase64(m.blob) })),
  )
  return new Blob([JSON.stringify({ ...p, media })], { type: 'application/json' })
}
export async function fileBlobToProject(file: File): Promise<ProjectState> {
  if (file.size > 1024 * 1024 * 1024) throw new Error('프로젝트 파일은 1GB 이하만 열 수 있습니다.')
  const json: unknown = JSON.parse(await file.text())
  assertPortableProject(json)
  const media: MediaBlob[] = (json.media || []).map((m: { id: string; name: string; type: string; data: string }) => ({
    id: m.id, name: m.name, type: m.type, blob: base64ToBlob(m.data, m.type),
  }))
  return deserialize({ ...json, media })
}

type PortableProject = Omit<SerializedProject, 'media'> & {
  media: { id: string; name: string; type: string; data: string }[]
}

function assertPortableProject(value: unknown): asserts value is PortableProject {
  if (!value || typeof value !== 'object') throw new Error('올바른 간단컷 프로젝트가 아닙니다.')
  const p = value as Record<string, unknown>
  if (p.version !== 1) throw new Error('지원하지 않는 프로젝트 버전입니다.')
  if (!['16:9', '9:16', '1:1'].includes(String(p.aspectRatio))) throw new Error('화면 비율 정보가 잘못되었습니다.')
  for (const key of ['clips', 'overlays', 'audios', 'backgrounds', 'texts', 'media']) {
    if (!Array.isArray(p[key])) throw new Error(`프로젝트의 ${key} 항목이 잘못되었습니다.`)
  }
  for (const media of p.media as unknown[]) {
    if (!media || typeof media !== 'object') throw new Error('미디어 정보가 잘못되었습니다.')
    const m = media as Record<string, unknown>
    if (typeof m.id !== 'string' || typeof m.name !== 'string' || typeof m.type !== 'string' || typeof m.data !== 'string') {
      throw new Error('미디어 정보가 불완전합니다.')
    }
  }
}
