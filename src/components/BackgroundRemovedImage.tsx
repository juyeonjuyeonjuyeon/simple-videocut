import { forwardRef, useEffect, useRef, useState, type ImgHTMLAttributes } from 'react'
import { cachedBackgroundRemovedImage, DEFAULT_BACKGROUND_REMOVAL_SENSITIVITY } from '../utils/background-removal'

interface EditableImageSource {
  id: string
  src: string
  file: File
  nativeMediaId?: string
  backgroundRemovalEnabled?: boolean
  backgroundRemovalSensitivity?: number
}

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  source: EditableImageSource | null | undefined
  maxDimension?: number
}

const BackgroundRemovedImage = forwardRef<HTMLImageElement, Props>(function BackgroundRemovedImage({ source, maxDimension = 1600, ...props }, ref) {
  const [resolvedSrc, setResolvedSrc] = useState(source?.src ?? '')
  const [processing, setProcessing] = useState(false)
  const ownedUrl = useRef<string | null>(null)

  const replaceSource = (next: string, objectUrl: string | null = null) => {
    if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current)
    ownedUrl.current = objectUrl
    setResolvedSrc(next)
  }

  useEffect(() => () => {
    if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current)
  }, [])

  useEffect(() => {
    if (!source?.backgroundRemovalEnabled) {
      setProcessing(false)
      replaceSource(source?.src ?? '')
      return
    }
    let cancelled = false
    setProcessing(true)
    const timer = window.setTimeout(async () => {
      try {
        const result = await cachedBackgroundRemovedImage(
          source,
          source.backgroundRemovalSensitivity ?? DEFAULT_BACKGROUND_REMOVAL_SENSITIVITY,
          maxDimension,
        )
        const url = URL.createObjectURL(result.blob)
        if (cancelled) URL.revokeObjectURL(url)
        else replaceSource(url, url)
      } catch (error) {
        console.warn(`이미지 배경 제거 미리보기에 실패했습니다: ${(error as Error).message}`)
        if (!cancelled) replaceSource(source.src)
      } finally {
        if (!cancelled) setProcessing(false)
      }
    }, 100)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // Source identity changes when a restored native project reconnects media.
  }, [maxDimension, source])

  return <img {...props} ref={ref} src={resolvedSrc} aria-busy={processing || undefined} data-background-removal={source?.backgroundRemovalEnabled ? 'on' : 'off'} />
})

export default BackgroundRemovedImage
