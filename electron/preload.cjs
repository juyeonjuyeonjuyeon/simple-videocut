const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('simplecutDesktop', {
  available: () => ipcRenderer.invoke('native-ffmpeg:available'),
  filePath: (file) => webUtils.getPathForFile(file),
  stageFile: (name, file) => {
    const sourcePath = webUtils.getPathForFile(file)
    if (!sourcePath) throw new Error('선택한 파일의 로컬 경로를 확인할 수 없습니다.')
    return ipcRenderer.invoke('native-ffmpeg:stage-file', name, sourcePath)
  },
  stagePath: (name, sourcePath) => ipcRenderer.invoke('native-ffmpeg:stage-file', name, sourcePath),
  writeFile: (name, data) => ipcRenderer.invoke('native-ffmpeg:write-file', name, data),
  readFile: (name) => ipcRenderer.invoke('native-ffmpeg:read-file', name),
  fileSize: (name) => ipcRenderer.invoke('native-ffmpeg:file-size', name),
  saveFile: (name, suggestedName) => ipcRenderer.invoke('native-ffmpeg:save-file', name, suggestedName),
  deleteFile: (name) => ipcRenderer.invoke('native-ffmpeg:delete-file', name),
  exec: (args) => ipcRenderer.invoke('native-ffmpeg:exec', args),
  terminate: () => ipcRenderer.invoke('native-ffmpeg:terminate'),
  onLog: (callback) => {
    const listener = (_event, line) => callback(line)
    ipcRenderer.on('native-ffmpeg:log', listener)
    return () => ipcRenderer.removeListener('native-ffmpeg:log', listener)
  },
  onProgress: (callback) => {
    const listener = (_event, ratio) => callback(ratio)
    ipcRenderer.on('native-ffmpeg:progress', listener)
    return () => ipcRenderer.removeListener('native-ffmpeg:progress', listener)
  },
})
