type FileSystemFileHandleLike = {
  kind: 'file'
  getFile(): Promise<File>
}

type ExtendedDataTransferItem = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<FileSystemFileHandleLike | { kind: 'directory' } | null>
}

type FileTransferLike = Pick<DataTransfer, 'files' | 'items' | 'types'>

const toArray = <T>(value?: ArrayLike<T> | Iterable<T>): T[] => value ? Array.from(value) : []

/** Native Apple apps do not always include the literal `Files` transfer type. */
export function hasFilePayload(transfer: FileTransferLike): boolean {
  if (toArray(transfer.files).length) return true
  if (toArray(transfer.items).some((item) => item.kind === 'file')) return true
  return toArray(transfer.types).some((type) => type.toLocaleLowerCase().includes('file'))
}

const fileFromEntry = (entry: FileSystemFileEntry): Promise<File | null> => new Promise((resolve) => {
  entry.file(resolve, () => resolve(null))
})

async function fileFromItem(item: DataTransferItem): Promise<File | null> {
  if (item.kind !== 'file') return null

  const direct = item.getAsFile()
  if (direct?.size) return direct

  try {
    const handle = await (item as ExtendedDataTransferItem).getAsFileSystemHandle?.()
    if (handle?.kind === 'file') return await handle.getFile()
  } catch { /* another transfer representation may still work */ }

  try {
    const entry = item.webkitGetAsEntry?.()
    if (entry?.isFile) return await fileFromEntry(entry as FileSystemFileEntry)
  } catch { /* keep the direct placeholder for a useful empty-file error */ }

  return direct
}

const fileKey = (file: File) => `${file.name}\u0000${file.size}\u0000${file.lastModified}\u0000${file.type}`

/**
 * Collect files from Finder, Photos, Voice Memos and mobile Files transfers.
 * The FileList is copied synchronously because Safari may clear DataTransfer
 * after the drop handler yields; item-only and promised-file fallbacks follow.
 */
export async function filesFromDrop(transfer: FileTransferLike): Promise<File[]> {
  const directFiles = toArray(transfer.files)
  const items = toArray(transfer.items)
  const itemFiles = await Promise.all(items.map(fileFromItem))
  const seen = new Set<string>()

  return [...directFiles, ...itemFiles].flatMap((file) => {
    if (!file) return []
    const key = fileKey(file)
    if (seen.has(key)) return []
    seen.add(key)
    return [file]
  })
}
