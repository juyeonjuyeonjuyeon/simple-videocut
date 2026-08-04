interface SavePickerWindow {
  showSaveFilePicker?: (opts: unknown) => Promise<{
    createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>
    getFile?: () => Promise<File>
  }>
}

/**
 * Save a blob, letting the user choose the location (incl. an iCloud Drive
 * folder) when the browser supports the File System Access API; otherwise fall
 * back to a normal download. Throws on user cancel.
 */
export async function saveBlob(blob: Blob, filename: string): Promise<'saved' | 'downloaded'> {
  const w = window as unknown as SavePickerWindow
  if (w.showSaveFilePicker) {
    const ext = filename.split('.').pop() || 'bin'
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: '파일', accept: { [blob.type || 'application/octet-stream']: ['.' + ext] } }],
      })
      const ws = await handle.createWritable()
      await ws.write(blob)
      await ws.close()
      if (handle.getFile) {
        const saved = await handle.getFile()
        if (saved.size !== blob.size) throw new Error(`저장된 파일 크기가 다릅니다. (${saved.size} / ${blob.size} bytes)`)
      }
      return 'saved'
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') throw e
      const error = new Error(`파일 저장에 실패했습니다: ${(e as Error).message}`) as Error & { cause?: unknown }
      error.cause = e
      throw error
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  const release = () => URL.revokeObjectURL(url)
  window.addEventListener('pagehide', release, { once: true })
  window.setTimeout(() => {
    window.removeEventListener('pagehide', release)
    release()
  }, 120000)
  return 'downloaded'
}

interface WakeLockNavigator {
  wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> }
}

/** Best-effort screen wake lock for long tasks; re-acquires on tab refocus. */
export async function keepAwake(): Promise<() => void> {
  const nav = navigator as unknown as WakeLockNavigator
  let lock: { release: () => Promise<void> } | null = null
  const acquire = async () => {
    try {
      lock = (await nav.wakeLock?.request('screen')) ?? null
    } catch {
      lock = null
    }
  }
  await acquire()
  const onVis = () => {
    if (document.visibilityState === 'visible') acquire()
  }
  document.addEventListener('visibilitychange', onVis)
  return () => {
    document.removeEventListener('visibilitychange', onVis)
    lock?.release().catch(() => {})
  }
}
