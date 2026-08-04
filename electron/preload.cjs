const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('simplecutDesktop', {
  available: () => ipcRenderer.invoke('native-ffmpeg:available'),
  writeFile: (name, data) => ipcRenderer.invoke('native-ffmpeg:write-file', name, data),
  readFile: (name) => ipcRenderer.invoke('native-ffmpeg:read-file', name),
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
