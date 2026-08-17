import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { copyFile, link, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const ffmpegPath = app.isPackaged ? join(process.resourcesPath, 'ffmpeg') : require('ffmpeg-static')
let workDir = null
let processHandle = null
let quitting = false
let quitReady = false
const hasSingleInstanceLock = app.requestSingleInstanceLock()

const isRendering = () => Boolean(processHandle && processHandle.exitCode === null && processHandle.signalCode === null)

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
ipcMain.handle('native-ffmpeg:stage-file', async (_event, name, sourcePath) => {
  if (typeof sourcePath !== 'string' || !isAbsolute(sourcePath)) throw new Error('원본 파일 경로가 잘못되었습니다.')
  const sourceInfo = await stat(sourcePath)
  if (!sourceInfo.isFile() || sourceInfo.size <= 0) throw new Error('원본 파일이 없거나 비어 있습니다.')
  const target = join(await workspace(), safeFile(name))
  await unlink(target).catch(() => {})
  await link(sourcePath, target).catch(async () => copyFile(sourcePath, target))
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
    filters: [{ name: extension === 'webm' ? 'WebM 영상' : 'MP4 영상', extensions: [extension] }],
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
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) throw new Error('FFmpeg 명령이 잘못되었습니다.')
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
  if (process.env.SIMPLECUT_DEV_URL) window.loadURL(process.env.SIMPLECUT_DEV_URL)
  else window.loadFile(join(root, 'dist', 'index.html'))
  window.on('close', async (event) => {
    if (!isRendering() || quitting || allowClose) return
    event.preventDefault()
    const { response } = await dialog.showMessageBox(window, {
      type: 'warning',
      title: '렌더링 진행 중',
      message: '영상 렌더링이 진행 중입니다.',
      detail: '창을 최소화하면 렌더링은 계속됩니다. 지금 창을 닫으면 진행 중인 렌더링은 취소됩니다.',
      buttons: ['계속 렌더링', '렌더링 취소하고 창 닫기'],
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
else app.whenReady().then(createWindow)
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
