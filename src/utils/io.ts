interface SavePickerWindow {
  showSaveFilePicker?: (opts: unknown) => Promise<{
    createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>
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
      return 'saved'
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') throw e
      // any other error → fall back to download
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
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
