export interface DesktopFFmpegBridge {
  available(): Promise<boolean>
  videoEncoder(): Promise<'h264_videotoolbox' | null>
  registerMedia(file: File): Promise<{ id: string; size: number }>
  importMedia(name: string, data: Uint8Array): Promise<{ id: string; size: number }>
  readMedia(id: string): Promise<Uint8Array>
  mediaUrl(id: string): string
  projectSave(name: string, project: unknown): Promise<void>
  projectLoad(name: string): Promise<unknown[]>
  projectList(): Promise<Array<{ name: string; savedAt: number; size: number }>>
  projectDelete(name: string): Promise<void>
  stageFile(name: string, file: File): Promise<void>
  stageMedia(name: string, id: string): Promise<void>
  writeFile(name: string, data: Uint8Array): Promise<void>
  readFile(name: string): Promise<Uint8Array>
  fileSize(name: string): Promise<number>
  saveFile(name: string, suggestedName: string): Promise<'saved' | 'cancelled'>
  deleteFile(name: string): Promise<void>
  exec(args: string[]): Promise<number>
  terminate(): Promise<void>
  onLog(callback: (line: string) => void): () => void
  onProgress(callback: (ratio: number) => void): () => void
}

declare global {
  interface Window { simplecutDesktop?: DesktopFFmpegBridge }
}

type LogHandler = (event: { message: string }) => void
type ProgressHandler = (event: { progress: number }) => void

export class NativeFFmpeg {
  private logHandlers = new Set<LogHandler>()
  private progressHandlers = new Set<ProgressHandler>()
  private removeLog: (() => void) | null = null
  private removeProgress: (() => void) | null = null

  constructor(private bridge: DesktopFFmpegBridge) {
    this.removeLog = bridge.onLog((message) => this.logHandlers.forEach((handler) => handler({ message })))
    this.removeProgress = bridge.onProgress((progress) => this.progressHandlers.forEach((handler) => handler({ progress })))
  }

  on(event: 'log', handler: LogHandler): void
  on(event: 'progress', handler: ProgressHandler): void
  on(event: 'log' | 'progress', handler: LogHandler | ProgressHandler) {
    if (event === 'log') this.logHandlers.add(handler as LogHandler)
    else this.progressHandlers.add(handler as ProgressHandler)
  }

  off(event: 'log', handler: LogHandler): void
  off(event: 'progress', handler: ProgressHandler): void
  off(event: 'log' | 'progress', handler: LogHandler | ProgressHandler) {
    if (event === 'log') this.logHandlers.delete(handler as LogHandler)
    else this.progressHandlers.delete(handler as ProgressHandler)
  }

  writeFile(name: string, data: Uint8Array) { return this.bridge.writeFile(name, data) }
  stageFile(name: string, file: File, nativeMediaId?: string) {
    return nativeMediaId ? this.bridge.stageMedia(name, nativeMediaId) : this.bridge.stageFile(name, file)
  }
  readFile(name: string) { return this.bridge.readFile(name) }
  fileSize(name: string) { return this.bridge.fileSize(name) }
  saveFile(name: string, suggestedName: string) { return this.bridge.saveFile(name, suggestedName) }
  deleteFile(name: string) { return this.bridge.deleteFile(name) }
  exec(args: string[]) { return this.bridge.exec(args) }
  videoEncoder() { return this.bridge.videoEncoder() }
  terminate() {
    this.removeLog?.()
    this.removeProgress?.()
    this.removeLog = null
    this.removeProgress = null
    void this.bridge.terminate()
  }
}

export const hasNativeFFmpeg = () => Boolean(window.simplecutDesktop)
