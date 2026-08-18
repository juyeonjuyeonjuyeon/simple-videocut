import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const AUTOSAVE = '__autosave__'
const MAX_MANIFEST_BYTES = 10 * 1024 * 1024
const MAX_IMPORTED_MEDIA_BYTES = 512 * 1024 * 1024
const HISTORY_LIMIT = 5
const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\.[a-z0-9]{1,10})?$/

const validName = (name) => {
  if (typeof name !== 'string' || !name.trim() || name.length > 255 || name.includes('\0')) {
    throw new Error('프로젝트 이름이 잘못되었습니다.')
  }
  return name
}

const projectKey = (name) => createHash('sha256').update(validName(name)).digest('hex')

const safeExtension = (name) => {
  const extension = extname(typeof name === 'string' ? name : '').toLowerCase()
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '.bin'
}

const parseManifest = async (path) => {
  try {
    const bytes = await readFile(path)
    if (!bytes.byteLength || bytes.byteLength > MAX_MANIFEST_BYTES) return null
    const value = JSON.parse(bytes.toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

export function createNativeProjectStore(root) {
  const mediaDirectory = join(root, 'media')
  const projectDirectory = join(root, 'projects')
  const historyDirectory = join(root, 'history')
  const registeredSources = new Map()

  const initialize = async () => {
    await Promise.all([
      mkdir(mediaDirectory, { recursive: true }),
      mkdir(projectDirectory, { recursive: true }),
      mkdir(historyDirectory, { recursive: true }),
    ])
  }

  const mediaPath = (id) => {
    if (typeof id !== 'string' || !MEDIA_ID.test(id)) throw new Error('관리 미디어 ID가 잘못되었습니다.')
    return join(mediaDirectory, id)
  }

  const projectPath = (name) => name === AUTOSAVE
    ? join(root, 'autosave.json')
    : join(projectDirectory, `${projectKey(name)}.json`)

  const writeAtomic = async (target, text) => {
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    try {
      await rename(temporary, target)
    } catch (error) {
      await unlink(temporary).catch(() => {})
      throw error
    }
  }

  const pruneHistory = async () => {
    const entries = (await readdir(historyDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort()
      .reverse()
    for (const stale of entries.slice(HISTORY_LIMIT)) await unlink(join(historyDirectory, stale)).catch(() => {})
  }

  const saveProject = async (name, project) => {
    validName(name)
    if (!project || typeof project !== 'object' || Array.isArray(project)) throw new Error('프로젝트 정보가 잘못되었습니다.')
    const text = JSON.stringify(project)
    if (!text.length || Buffer.byteLength(text) > MAX_MANIFEST_BYTES) throw new Error('프로젝트 편집 정보가 너무 큽니다.')
    await initialize()
    const target = projectPath(name)
    if (name === AUTOSAVE) {
      const current = await parseManifest(target)
      if (current) {
        const historyPath = join(historyDirectory, `${String(Date.now()).padStart(16, '0')}-${randomUUID()}.json`)
        await copyFile(target, historyPath)
      }
    }
    await writeAtomic(target, text)
    if (name === AUTOSAVE) await pruneHistory()
  }

  const loadProjectCandidates = async (name) => {
    validName(name)
    await initialize()
    const paths = [projectPath(name)]
    if (name === AUTOSAVE) {
      const histories = (await readdir(historyDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => join(historyDirectory, entry.name))
        .sort()
        .reverse()
      paths.push(...histories.slice(0, HISTORY_LIMIT))
    }
    const candidates = []
    for (const path of paths) {
      const parsed = await parseManifest(path)
      if (parsed) candidates.push(parsed)
    }
    return candidates
  }

  const listProjects = async () => {
    await initialize()
    const entries = await readdir(projectDirectory, { withFileTypes: true })
    const projects = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const project = await parseManifest(join(projectDirectory, entry.name))
      if (!project || typeof project.name !== 'string' || project.name === AUTOSAVE) continue
      const media = Array.isArray(project.media) ? project.media : []
      const size = media.reduce((total, item) => total + (Number.isFinite(item?.size) ? Math.max(0, item.size) : 0), 0)
      projects.push({ name: project.name, savedAt: Number(project.savedAt) || 0, size })
    }
    return projects.sort((a, b) => b.savedAt - a.savedAt)
  }

  const deleteProject = async (name) => {
    validName(name)
    await unlink(projectPath(name)).catch((error) => {
      if (error?.code !== 'ENOENT') throw error
    })
  }

  const registerMedia = async (sourcePath, name) => {
    if (typeof sourcePath !== 'string' || !sourcePath) throw new Error('선택한 원본 파일 경로가 잘못되었습니다.')
    await initialize()
    const sourceInfo = await stat(sourcePath)
    if (!sourceInfo.isFile() || sourceInfo.size <= 0) throw new Error('선택한 원본 파일이 없거나 비어 있습니다.')
    const cacheKey = `${sourcePath}\0${sourceInfo.size}\0${sourceInfo.mtimeMs}`
    const cached = registeredSources.get(cacheKey)
    if (cached) return cached
    const id = `${randomUUID()}${safeExtension(name)}`
    const target = mediaPath(id)
    // Keep a stable managed original. A hard link would change if another app
    // rewrote the source file in place after it had been added to the project.
    await copyFile(sourcePath, target)
    const result = { id, size: sourceInfo.size }
    registeredSources.set(cacheKey, result)
    return result
  }

  const importMedia = async (name, data) => {
    const bytes = Buffer.from(data)
    if (!bytes.byteLength || bytes.byteLength > MAX_IMPORTED_MEDIA_BYTES) throw new Error('가져올 미디어 파일 크기가 잘못되었습니다.')
    await initialize()
    const id = `${randomUUID()}${safeExtension(name)}`
    await writeFile(mediaPath(id), bytes, { flag: 'wx', mode: 0o600 })
    return { id, size: bytes.byteLength }
  }

  return {
    initialize,
    mediaPath,
    projectPath,
    saveProject,
    loadProjectCandidates,
    listProjects,
    deleteProject,
    registerMedia,
    importMedia,
  }
}
