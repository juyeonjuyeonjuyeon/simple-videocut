export interface DesktopFFmpegBridge {
  available(): Promise<boolean>
  writeFile(name: string, data: Uint8Array): Promise<void>
  readFile(name: string): Promise<Uint8Array>
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
  readFile(name: string) { return this.bridge.readFile(name) }
  deleteFile(name: string) { return this.bridge.deleteFile(name) }
  exec(args: string[]) { return this.bridge.exec(args) }
  terminate() {
    this.removeLog?.()
    this.removeProgress?.()
    this.removeLog = null
    this.removeProgress = null
    void this.bridge.terminate()
  }
}

export const hasNativeFFmpeg = () => Boolean(window.simplecutDesktop)
