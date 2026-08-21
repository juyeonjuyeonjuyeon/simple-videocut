import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { copyFile, link, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validateFFmpegArgs } from './ffmpeg-args.mjs'
import { createNativeProjectStore } from './native-project-store.mjs'
import { listSystemFontFamilies } from './font-catalog.mjs'

const require = createRequire(import.meta.url)
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const ffmpegPath = app.isPackaged ? join(process.resourcesPath, 'ffmpeg') : require('ffmpeg-static')
let workDir = null
let processHandle = null
let quitting = false
let quitReady = false
const hasSingleInstanceLock = app.requestSingleInstanceLock()
let projectStore = null
let videoEncoderPromise = null
let fontFamiliesPromise = null
let appLanguage = 'ko'

const nativeCopy = (ko, en) => appLanguage === 'ko' ? ko : en

protocol.registerSchemesAsPrivileged([{
  scheme: 'simplecut-media',
  privileges: { standard: true, secure: true, stream: true, supportFetchAPI: false },
}])

const nativeProjects = () => {
  if (!projectStore) projectStore = createNativeProjectStore(join(app.getPath('userData'), 'native-library-v2'))
  return projectStore
}

const isRendering = () => Boolean(processHandle && processHandle.exitCode === null && processHandle.signalCode === null)

function detectVideoEncoder() {
  if (videoEncoderPromise) return videoEncoderPromise
  videoEncoderPromise = new Promise((resolve) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-encoders'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { if (output.length < 2_000_000) output += chunk })
    child.stderr.on('data', (chunk) => { if (output.length < 2_000_000) output += chunk })
    child.once('error', () => resolve(null))
    child.once('close', (code) => resolve(code === 0 && /\bh264_videotoolbox\b/.test(output) ? 'h264_videotoolbox' : null))
  })
  return videoEncoderPromise
}

async function workspace() {
  if (!workDir) workDir = await mkdtemp(join(tmpdir(), 'simplecut-render-'))
  return workDir
}

function safeFile(name) {
  if (typeof name !== 'string' || basename(name) !== name || !/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error('안전하지 않은 임시 파일 이름입니다.')
  }
  return name
}

async function clearWorkspace() {
  if (!workDir) return
  const target = workDir
  workDir = null
  await rm(target, { recursive: true, force: true })
}

ipcMain.handle('native-ffmpeg:available', () => Boolean(ffmpegPath))
ipcMain.on('app:language', (_event, language) => {
  if (language === 'ko' || language === 'en') appLanguage = language
})
ipcMain.handle('native-ffmpeg:video-encoder', () => detectVideoEncoder())
ipcMain.handle('native-fonts:list', () => {
  if (!fontFamiliesPromise) fontFamiliesPromise = listSystemFontFamilies()
  return fontFamiliesPromise
})
ipcMain.handle('native-media:register', async (_event, sourcePath, name) => nativeProjects().registerMedia(sourcePath, name))
ipcMain.handle('native-media:import', async (_event, name, data) => nativeProjects().importMedia(name, data))
ipcMain.handle('native-media:read', async (_event, id) => new Uint8Array(await readFile(nativeProjects().mediaPath(id))))
ipcMain.handle('native-project:save', async (_event, name, project) => nativeProjects().saveProject(name, project))
ipcMain.handle('native-project:load', async (_event, name) => nativeProjects().loadProjectCandidates(name))
ipcMain.handle('native-project:list', async () => nativeProjects().listProjects())
ipcMain.handle('native-project:delete', async (_event, name) => nativeProjects().deleteProject(name))
ipcMain.handle('native-ffmpeg:stage-file', async (_event, name, sourcePath) => {
  if (typeof sourcePath !== 'string' || !isAbsolute(sourcePath)) throw new Error('원본 파일 경로가 잘못되었습니다.')
  const sourceInfo = await stat(sourcePath)
  if (!sourceInfo.isFile() || sourceInfo.size <= 0) throw new Error('원본 파일이 없거나 비어 있습니다.')
  const target = join(await workspace(), safeFile(name))
  await unlink(target).catch(() => {})
  await link(sourcePath, target).catch(async () => copyFile(sourcePath, target))
})
ipcMain.handle('native-ffmpeg:stage-media', async (_event, name, id) => {
  const source = nativeProjects().mediaPath(id)
  const sourceInfo = await stat(source)
  if (!sourceInfo.isFile() || sourceInfo.size <= 0) throw new Error('관리 중인 원본 파일이 없거나 비어 있습니다.')
  const target = join(await workspace(), safeFile(name))
  await unlink(target).catch(() => {})
  await link(source, target).catch(async () => copyFile(source, target))
})
ipcMain.handle('native-ffmpeg:write-file', async (_event, name, data) => {
  await writeFile(join(await workspace(), safeFile(name)), Buffer.from(data))
})
ipcMain.handle('native-ffmpeg:read-file', async (_event, name) => {
  const data = await readFile(join(await workspace(), safeFile(name)))
  return new Uint8Array(data)
})
ipcMain.handle('native-ffmpeg:file-size', async (_event, name) => {
  const info = await stat(join(await workspace(), safeFile(name)))
  return info.size
})
ipcMain.handle('native-ffmpeg:save-file', async (event, name, suggestedName) => {
  const source = join(await workspace(), safeFile(name))
  const sourceInfo = await stat(source)
  if (!sourceInfo.isFile() || sourceInfo.size <= 0) throw new Error('저장할 영상 파일이 없거나 비어 있습니다.')
  const fallback = name.endsWith('.webm') ? 'simplecut.webm' : 'simplecut.mp4'
  const safeSuggestion = typeof suggestedName === 'string' && suggestedName.length <= 255 ? basename(suggestedName) : fallback
  const extension = safeSuggestion.toLowerCase().endsWith('.webm') ? 'webm' : 'mp4'
  const window = BrowserWindow.fromWebContents(event.sender)
  const options = {
    defaultPath: safeSuggestion || fallback,
    filters: [{ name: extension === 'webm' ? nativeCopy('WebM 영상', 'WebM video') : nativeCopy('MP4 영상', 'MP4 video'), extensions: [extension] }],
  }
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return 'cancelled'
  await copyFile(source, result.filePath)
  const savedInfo = await stat(result.filePath)
  if (savedInfo.size !== sourceInfo.size) throw new Error('저장된 파일 크기가 변환 결과와 다릅니다.')
  return 'saved'
})
ipcMain.handle('native-ffmpeg:delete-file', async (_event, name) => {
  await unlink(join(await workspace(), safeFile(name))).catch(() => {})
})
ipcMain.handle('native-ffmpeg:exec', async (event, args) => {
  if (processHandle) throw new Error('이미 영상 렌더링이 진행 중입니다.')
  validateFFmpegArgs(args)
  const durationIndex = args.lastIndexOf('-t')
  const duration = durationIndex >= 0 ? Number(args[durationIndex + 1]) : 0
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-progress', 'pipe:1', '-nostats', ...args], {
      cwd: workDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    processHandle = child
    let progressBuffer = ''
    let logBuffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      progressBuffer += chunk
      const lines = progressBuffer.split(/\r?\n/)
      progressBuffer = lines.pop() || ''
      for (const line of lines) {
        const match = line.match(/^out_time_us=(\d+)$/)
        if (match && duration > 0) event.sender.send('native-ffmpeg:progress', Math.min(1, Number(match[1]) / 1e6 / duration))
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      logBuffer += chunk
      const lines = logBuffer.split(/\r?\n/)
      logBuffer = lines.pop() || ''
      for (const line of lines) if (line) event.sender.send('native-ffmpeg:log', line)
    })
    child.once('error', (error) => { processHandle = null; reject(error) })
    child.once('close', (code) => { processHandle = null; resolve(code ?? 1) })
  })
})
ipcMain.handle('native-ffmpeg:terminate', async () => {
  processHandle?.kill('SIGKILL')
  processHandle = null
  await clearWorkspace()
})

function createWindow() {
  let allowClose = false
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#15171b',
    title: 'SimpleCut',
    webPreferences: {
      preload: join(root, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const entryPath = join(root, 'dist', 'index.html')
  const entryUrl = pathToFileURL(entryPath).toString()
  const devUrl = !app.isPackaged ? process.env.SIMPLECUT_DEV_URL : ''
  const validDevUrl = Boolean(devUrl && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(devUrl))
  const allowedOrigin = validDevUrl ? new URL(devUrl).origin : ''
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = validDevUrl ? new URL(url).origin === allowedOrigin : url === entryUrl
    if (!allowed) event.preventDefault()
  })
  if (validDevUrl) window.loadURL(devUrl)
  else window.loadFile(entryPath)
  window.on('close', async (event) => {
    if (!isRendering() || quitting || allowClose) return
    event.preventDefault()
    const { response } = await dialog.showMessageBox(window, {
      type: 'warning',
      title: nativeCopy('렌더링 진행 중', 'Rendering in progress'),
      message: nativeCopy('영상 렌더링이 진행 중입니다.', 'A video is currently rendering.'),
      detail: nativeCopy('창을 최소화하면 렌더링은 계속됩니다. 지금 창을 닫으면 진행 중인 렌더링은 취소됩니다.', 'Minimize the window to keep rendering. Closing it now will cancel the render.'),
      buttons: [nativeCopy('계속 렌더링', 'Keep rendering'), nativeCopy('렌더링 취소하고 창 닫기', 'Cancel render and close')],
      defaultId: 0,
      cancelId: 0,
    })
    if (response !== 1) return
    processHandle?.kill('SIGKILL')
    processHandle = null
    await clearWorkspace()
    allowClose = true
    window.close()
  })
}

if (!hasSingleInstanceLock) app.quit()
else app.whenReady().then(async () => {
  await nativeProjects().initialize()
  protocol.handle('simplecut-media', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'media') return new Response(null, { status: 404 })
      const id = decodeURIComponent(url.pathname.slice(1))
      const source = nativeProjects().mediaPath(id)
      return net.fetch(pathToFileURL(source).toString(), { headers: request.headers })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
  createWindow()
})
app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window) createWindow()
  else {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
app.on('before-quit', (event) => {
  quitting = true
  if (quitReady) return
  event.preventDefault()
  processHandle?.kill('SIGKILL')
  processHandle = null
  void clearWorkspace().finally(() => {
    quitReady = true
    app.quit()
  })
})
