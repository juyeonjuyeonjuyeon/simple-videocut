const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('simplecutDesktop', {
  available: () => ipcRenderer.invoke('native-ffmpeg:available'),
  videoEncoder: () => ipcRenderer.invoke('native-ffmpeg:video-encoder'),
  registerMedia: (file) => {
    const sourcePath = webUtils.getPathForFile(file)
    if (!sourcePath) throw new Error('선택한 파일의 로컬 경로를 확인할 수 없습니다.')
    return ipcRenderer.invoke('native-media:register', sourcePath, file.name)
  },
  importMedia: (name, data) => ipcRenderer.invoke('native-media:import', name, data),
  readMedia: (id) => ipcRenderer.invoke('native-media:read', id),
  mediaUrl: (id) => `simplecut-media://media/${encodeURIComponent(id)}`,
  projectSave: (name, project) => ipcRenderer.invoke('native-project:save', name, project),
  projectLoad: (name) => ipcRenderer.invoke('native-project:load', name),
  projectList: () => ipcRenderer.invoke('native-project:list'),
  projectDelete: (name) => ipcRenderer.invoke('native-project:delete', name),
  stageFile: (name, file) => {
    const sourcePath = webUtils.getPathForFile(file)
    if (!sourcePath) throw new Error('선택한 파일의 로컬 경로를 확인할 수 없습니다.')
    return ipcRenderer.invoke('native-ffmpeg:stage-file', name, sourcePath)
  },
  stageMedia: (name, id) => ipcRenderer.invoke('native-ffmpeg:stage-media', name, id),
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
