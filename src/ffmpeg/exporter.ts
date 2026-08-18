import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import type { Clip, Overlay, AudioClip, Background, TextOverlay, AspectRatio, Crop, Rotation } from '../types'
import { aspectToWH, projectDuration, overlayLength, audioLength, clipTimelineDuration } from '../utils/time'
import { hexToRgba } from '../utils/color'
import { hasNativeFFmpeg, NativeFFmpeg } from './native'

// Keep the encoding engine on the same origin. Exports must not depend on a
// third-party CDN being reachable after the editor itself has loaded.
const coreAsset = (name: string) => new URL(`${import.meta.env.BASE_URL}ffmpeg/${name}`, window.location.origin).href

type LogHandler = (event: { message: string }) => void
type ProgressHandler = (event: { progress: number }) => void
interface FFmpegEngine {
  on(event: 'log', handler: LogHandler): void
  on(event: 'progress', handler: ProgressHandler): void
  off(event: 'progress', handler: ProgressHandler): void
  exec(args: string[]): Promise<number>
  videoEncoder?(): Promise<'h264_videotoolbox' | null>
  stageFile?(name: string, file: File, nativeMediaId?: string): Promise<void>
  writeFile(name: string, data: Uint8Array): Promise<unknown>
  readFile(name: string): Promise<Uint8Array | string>
  fileSize?(name: string): Promise<number>
  saveFile?(name: string, suggestedName: string): Promise<'saved' | 'cancelled'>
  deleteFile(name: string): Promise<unknown>
  terminate(): void
}

let ffmpeg: FFmpegEngine | null = null
let logBuffer: string[] = []
let externalLog: ((line: string) => void) | null = null

async function getFFmpeg(onLog?: (line: string) => void): Promise<FFmpegEngine> {
  externalLog = onLog ?? null
  if (ffmpeg) return ffmpeg
  if (hasNativeFFmpeg() && window.simplecutDesktop && await window.simplecutDesktop.available()) {
    const instance = new NativeFFmpeg(window.simplecutDesktop)
    instance.on('log', ({ message }) => {
      logBuffer.push(message)
      externalLog?.(message)
    })
    ffmpeg = instance
    return instance
  }
  const instance = new FFmpeg()
  instance.on('log', ({ message }) => {
    logBuffer.push(message)
    externalLog?.(message)
  })
  await instance.load({
    coreURL: await toBlobURL(coreAsset('ffmpeg-core.js'), 'text/javascript'),
    wasmURL: await toBlobURL(coreAsset('ffmpeg-core.wasm'), 'application/wasm'),
  })
  ffmpeg = instance
  return ffmpeg
}

export interface VideoStreamInfo {
  codec: string
  width: number
  height: number
  hasAudio: boolean
}

export function parseVideoStreamInfo(lines: string[]): VideoStreamInfo {
  const videoLine = lines.find((line) => /Stream #.*Video:/i.test(line)) ?? ''
  const codec = videoLine.match(/Video:\s*([^,\s]+)/i)?.[1]?.toLowerCase() ?? ''
  const dimensions = videoLine.match(/(\d{2,5})x(\d{2,5})/)
  return {
    codec,
    width: dimensions ? Number(dimensions[1]) : 0,
    height: dimensions ? Number(dimensions[2]) : 0,
    hasAudio: lines.some((line) => /Stream #.*Audio:/i.test(line)),
  }
}

export function shouldNormalizeInput(info: VideoStreamInfo, outputWidth: number, outputHeight: number, nativeDesktop = false): boolean {
  if (nativeDesktop) return false
  return info.codec === 'hevc' || info.codec === 'h265' || info.width > outputWidth || info.height > outputHeight
}

export function mp4VideoEncodingArgs(height: number, encoder: 'h264_videotoolbox' | null): string[] {
  if (!encoder) return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p']
  const bitrate = height >= 2160 ? 20 : height >= 1440 ? 10 : height >= 1080 ? 6 : height >= 720 ? 3 : 1.5
  const bitrateText = `${bitrate}M`
  return [
    '-c:v', encoder,
    '-b:v', bitrateText,
    '-maxrate', `${bitrate * 1.5}M`,
    '-bufsize', `${bitrate * 2}M`,
    '-profile:v', 'high',
    '-allow_sw', '1',
    '-pix_fmt', 'yuv420p',
  ]
}

export function createProgressReporter(onProgress?: (ratio: number) => void) {
  let start = 0
  let share = 1
  let last = 0
  return {
    setStage(nextStart: number, nextShare: number) {
      start = nextStart
      share = nextShare
    },
    report(value: number) {
      if (!onProgress || !Number.isFinite(value)) return
      const next = Math.max(last, Math.min(1, Math.max(0, start + value * share)))
      if (next === last) return
      last = next
      onProgress(Number(next.toFixed(4)))
    },
  }
}

async function probeInput(fp: FFmpegEngine, name: string): Promise<VideoStreamInfo> {
  logBuffer = []
  // No output file => ffmpeg exits with an error but still prints stream info.
  await fp.exec(['-hide_banner', '-i', name]).catch(() => {})
  return parseVideoStreamInfo(logBuffer)
}

/** Build an atempo filter chain for an arbitrary speed within 0.25–4. */
function buildAtempo(speed: number): string {
  if (Math.abs(speed - 1) < 1e-6) return ''
  const parts: number[] = []
  let r = speed
  while (r > 2 + 1e-9) {
    parts.push(2)
    r /= 2
  }
  while (r < 0.5 - 1e-9) {
    parts.push(0.5)
    r /= 0.5
  }
  parts.push(Number(r.toFixed(6)))
  return parts.map((p) => `atempo=${p},`).join('')
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Crop / flip / rotate filters for a clip or overlay (empty string if none). */
function spatialFilters(c: { crop: Crop; flipH: boolean; flipV: boolean; rotate: Rotation }): string {
  const parts: string[] = []
  const cr = c.crop
  if (cr.top || cr.right || cr.bottom || cr.left) {
    parts.push(
      `crop=iw*(1-${cr.left}-${cr.right}):ih*(1-${cr.top}-${cr.bottom}):iw*${cr.left}:ih*${cr.top}`,
    )
  }
  if (c.flipH) parts.push('hflip')
  if (c.flipV) parts.push('vflip')
  if (c.rotate === 90) parts.push('transpose=1')
  else if (c.rotate === 270) parts.push('transpose=2')
  else if (c.rotate === 180) parts.push('transpose=1,transpose=1')
  return parts.length ? parts.join(',') + ',' : ''
}

/** Render one text overlay onto a transparent PNG at the output resolution. */
async function renderTextPng(t: TextOverlay, W: number, H: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const fontPx = Math.max(8, Math.round(t.size * H))
  // Load the font for the actual text (Korean web fonts are subset by glyph
  // range). Use normal weight so single-weight display fonts still match.
  await document.fonts.load(`${fontPx}px ${t.font}`, t.text || '가').catch(() => {})
  ctx.font = `700 ${fontPx}px ${t.font}`
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  const lines = t.text.split('\n')
  const lineH = fontPx * 1.25
  const cx = t.x * W
  const cy = t.y * H
  const strokePx = t.strokeWidth * fontPx

  // Free rotation: spin the whole drawing around its center.
  const ang = ((t.angle || 0) * Math.PI) / 180
  if (ang) {
    ctx.translate(cx, cy)
    ctx.rotate(ang)
    ctx.translate(-cx, -cy)
  }

  let maxW = 0
  for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width)
  const boxLeft = cx - maxW / 2

  // Horizontal anchor per alignment (matches the centered box in the preview).
  const align = t.align === 'justify' ? 'left' : t.align
  ctx.textAlign = align
  const lineX = align === 'left' ? boxLeft : align === 'right' ? boxLeft + maxW : cx

  if (t.box) {
    const padX = fontPx * 0.4
    const padY = fontPx * 0.2
    const boxW = maxW + padX * 2
    const boxH = lineH * lines.length + padY * 2
    ctx.fillStyle = hexToRgba(t.boxColor, t.boxAlpha)
    roundRect(ctx, cx - boxW / 2, cy - boxH / 2, boxW, boxH, fontPx * 0.15)
    ctx.fill()
  }

  const startY = cy - ((lines.length - 1) * lineH) / 2
  lines.forEach((l, i) => {
    const yy = startY + i * lineH
    if (t.shadow) {
      ctx.shadowColor = t.shadowColor
      ctx.shadowBlur = t.shadowBlur * fontPx
      ctx.shadowOffsetY = t.shadowDist * fontPx
    } else {
      ctx.shadowColor = 'transparent'
    }
    if (strokePx > 0) {
      ctx.lineWidth = strokePx * 2
      ctx.strokeStyle = t.strokeColor
      ctx.strokeText(l, lineX, yy)
    } else {
      ctx.fillStyle = hexToRgba(t.color, t.colorAlpha)
      ctx.fillText(l, lineX, yy)
    }
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = hexToRgba(t.color, t.colorAlpha)
    ctx.fillText(l, lineX, yy)
  })

  const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

export interface ExportOptions {
  clips: Clip[]
  texts: TextOverlay[]
  overlays?: Overlay[]
  audios?: AudioClip[]
  backgrounds?: Background[]
  aspect: AspectRatio
  height: number
  format?: 'mp4' | 'webm'
  onProgress?: (ratio: number) => void
  onLog?: (line: string) => void
}

export interface NativeExportFile {
  kind: 'native-file'
  name: string
  size: number
  format: 'mp4' | 'webm'
}

export type ExportedVideo = Blob | NativeExportFile

export const isNativeExportFile = (value: ExportedVideo): value is NativeExportFile => !(value instanceof Blob)

export async function saveNativeExport(file: NativeExportFile, suggestedName: string): Promise<'saved' | 'cancelled'> {
  if (!ffmpeg?.saveFile) throw new Error('데스크톱 파일 저장 기능을 사용할 수 없습니다.')
  return ffmpeg.saveFile(file.name, suggestedName)
}

export async function discardNativeExport(file: NativeExportFile): Promise<void> {
  await ffmpeg?.deleteFile(file.name).catch(() => {})
}

export function cancelExport(): void {
  ffmpeg?.terminate()
  ffmpeg = null
}

/** Export timeline length of an overlay. */
function ovLen(o: Overlay): number {
  return overlayLength(o)
}

export async function exportVideo(opts: ExportOptions): Promise<ExportedVideo> {
  const { clips, texts, aspect, height, onProgress, onLog } = opts
  const overlays = (opts.overlays ?? []).filter((o) => o.kind === 'video' || o.kind === 'image')
  const audios = opts.audios ?? []
  const backgrounds = opts.backgrounds ?? []
  const format = opts.format ?? 'mp4'
  if (clips.length === 0) throw new Error('내보낼 클립이 없습니다.')

  const fp = await getFFmpeg(onLog)
  const nativeVideoEncoder = fp.videoEncoder ? await fp.videoEncoder().catch(() => null) : null
  const { w: W, h: H } = aspectToWH(aspect, height)
  const duration = projectDuration(clips, overlays, audios, texts, backgrounds)

  const progressReporter = createProgressReporter(onProgress)
  progressReporter.report(0.02)
  const onProg = ({ progress }: { progress: number }) => progressReporter.report(progress)
  fp.on('progress', onProg)
  const outName = `out.${format}`
  let resetEngine = false

  try {
    // A tab suspension can leave an old virtual output behind. Always remove
    // it and also pass -y so FFmpeg never waits for an overwrite prompt.
    await fp.deleteFile(outName).catch(() => {})
    const visualCount = clips.filter((item) => item.kind !== 'color').length + overlays.length + backgrounds.filter((item) => item.kind !== 'color').length
    let visualIndex = 0
    const stageMedia = async (name: string, item: { file: File; nativeMediaId?: string }) => {
      if (fp.stageFile) {
        try {
          await fp.stageFile(name, item.file, item.nativeMediaId)
          return
        } catch (error) {
          externalLog?.(`원본 경로를 사용할 수 없어 저장된 사본을 사용합니다: ${(error as Error).message}`)
        }
      }
      await fp.writeFile(name, await fetchFile(item.file))
    }
    const prepareVisual = async (
      sourceName: string,
      normalizedBase: string,
      item: Clip | Overlay | Background,
      cover: boolean,
    ): Promise<{ fileName: string; trimStart: number; hasAudio: boolean }> => {
      progressReporter.setStage(0, 0)
      const info = await probeInput(fp, sourceName)
      const oversizedImage = item.kind === 'image' && (info.width > W || info.height > H)
      // A repeated trimmed source cannot be expressed correctly with
      // -stream_loop alone: FFmpeg would continue past the trim point before
      // looping the whole original. Materialize one trimmed cycle first.
      const nativeDesktop = Boolean(fp.fileSize)
      const needsNormalization = item.kind === 'video'
        ? shouldNormalizeInput(info, W, H, nativeDesktop) || item.repeat > 1
        : oversizedImage && !nativeDesktop
      const stageStart = 0.05 + (0.2 * visualIndex) / Math.max(1, visualCount)
      visualIndex++
      if (!needsNormalization) {
        progressReporter.setStage(0.05 + (0.2 * visualIndex) / Math.max(1, visualCount), 0)
        progressReporter.report(0)
        return { fileName: sourceName, trimStart: item.trimStart, hasAudio: item.kind === 'video' && info.hasAudio }
      }

      const normalizedName = `${normalizedBase}.${item.kind === 'image' ? 'png' : 'mp4'}`
      const scaleMode = cover ? 'increase' : 'decrease'
      const makeNormalizeArgs = (encoder: 'h264_videotoolbox' | null) => {
        const normalizeArgs = ['-y']
        if (item.kind === 'video') normalizeArgs.push('-ss', String(item.trimStart), '-t', String(item.trimEnd - item.trimStart))
        normalizeArgs.push('-i', sourceName, '-map', '0:v:0')
        if (item.kind === 'video' && info.hasAudio) normalizeArgs.push('-map', '0:a:0')
        normalizeArgs.push('-vf', `scale=${W}:${H}:force_original_aspect_ratio=${scaleMode}:force_divisible_by=2`)
        if (item.kind === 'image') normalizeArgs.push('-frames:v', '1', normalizedName)
        else {
          normalizeArgs.push(...(encoder
            ? mp4VideoEncodingArgs(H, encoder)
            : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p']))
          if (info.hasAudio) normalizeArgs.push('-c:a', 'aac', '-b:a', '192k')
          else normalizeArgs.push('-an')
          normalizeArgs.push(normalizedName)
        }
        return normalizeArgs
      }

      progressReporter.setStage(stageStart, 0.2 / Math.max(1, visualCount))
      logBuffer = []
      let normalizeExitCode = await fp.exec(makeNormalizeArgs(item.kind === 'video' ? nativeVideoEncoder : null))
      if (normalizeExitCode !== 0 && item.kind === 'video' && nativeVideoEncoder) {
        externalLog?.('하드웨어 미디어 준비가 실패해 호환 인코딩으로 다시 시도합니다.')
        await fp.deleteFile(normalizedName).catch(() => {})
        logBuffer = []
        normalizeExitCode = await fp.exec(makeNormalizeArgs(null))
      }
      if (normalizeExitCode !== 0) {
        resetEngine = true
        const useful = logBuffer.filter((line) => /error|invalid|failed|unable|unsupported|cannot|memory/i.test(line))
        const detail = (useful.length ? useful : logBuffer).slice(-8).join('\n')
        throw new Error(`원본 미디어 정규화에 실패했습니다: ${item.name} (FFmpeg 종료 코드 ${normalizeExitCode})${detail ? `\n${detail}` : ''}`)
      }
      await fp.deleteFile(sourceName).catch(() => {})
      progressReporter.setStage(0.05 + (0.2 * visualIndex) / Math.max(1, visualCount), 0)
      progressReporter.report(0)
      return { fileName: normalizedName, trimStart: 0, hasAudio: item.kind === 'video' && info.hasAudio }
    }

    // 1. Stage each clip without copying it through renderer memory, then
    // probe and normalize only inputs that would overburden the final graph.
    //    (Color clips have no file — they become a lavfi color source.)
    const audioFlags: boolean[] = []
    const inputFiles: string[] = []
    const inputTrimStarts: number[] = []
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i]
      if (clip.kind === 'color') {
        audioFlags.push(false)
        inputFiles.push('')
        inputTrimStarts.push(0)
        continue
      }
      if (!clip.sourceSize) throw new Error(`원본 영상 파일이 비어 있습니다: ${clip.name}`)
      const sourceName = `in${i}`
      await stageMedia(sourceName, clip)
      const cropped = Boolean(clip.crop.top || clip.crop.right || clip.crop.bottom || clip.crop.left)
      const prepared = await prepareVisual(sourceName, `norm${i}`, clip, cropped)
      audioFlags.push(prepared.hasAudio)
      inputFiles.push(prepared.fileName)
      inputTrimStarts.push(prepared.trimStart)
    }

    // 2. Render each text overlay to a PNG at output resolution.
    for (let k = 0; k < texts.length; k++) {
      await fp.writeFile(`text${k}.png`, await renderTextPng(texts[k], W, H))
    }

    // 2b. Write free-track media once and remember which video layers carry audio.
    const overlayAudioFlags: boolean[] = []
    const overlayFiles: string[] = []
    const overlayTrimStarts: number[] = []
    for (let k = 0; k < overlays.length; k++) {
      if (!overlays[k].sourceSize) throw new Error(`원본 오버레이 파일이 비어 있습니다: ${overlays[k].name}`)
      await stageMedia(`ov${k}`, overlays[k])
      const prepared = await prepareVisual(`ov${k}`, `normov${k}`, overlays[k], false)
      overlayFiles.push(prepared.fileName)
      overlayTrimStarts.push(prepared.trimStart)
      overlayAudioFlags.push(prepared.hasAudio)
    }
    const backgroundAudioFlags: boolean[] = []
    const backgroundFiles: string[] = []
    const backgroundTrimStarts: number[] = []
    for (let k = 0; k < backgrounds.length; k++) {
      const b = backgrounds[k]
      if (b.kind === 'color') {
        backgroundAudioFlags.push(false)
        backgroundFiles.push('')
        backgroundTrimStarts.push(0)
        continue
      }
      if (!b.sourceSize) throw new Error(`원본 배경 파일이 비어 있습니다: ${b.name}`)
      await stageMedia(`bg${k}`, b)
      const prepared = await prepareVisual(`bg${k}`, `normbg${k}`, b, true)
      backgroundFiles.push(prepared.fileName)
      backgroundTrimStarts.push(prepared.trimStart)
      backgroundAudioFlags.push(prepared.hasAudio)
    }
    const audioFiles: string[] = []
    const audioTrimStarts: number[] = []
    for (let k = 0; k < audios.length; k++) {
      if (!audios[k].sourceSize) throw new Error(`원본 음성 파일이 비어 있습니다: ${audios[k].name}`)
      await stageMedia(`audio${k}`, audios[k])
      if (audios[k].repeat > 1) {
        const normalizedName = `normaudio${k}.m4a`
        logBuffer = []
        const normalizeExitCode = await fp.exec([
          '-y', '-ss', String(audios[k].trimStart), '-t', String(audios[k].trimEnd - audios[k].trimStart),
          '-i', `audio${k}`, '-vn', '-c:a', 'aac', '-b:a', '192k', normalizedName,
        ])
        if (normalizeExitCode !== 0) {
          resetEngine = true
          const useful = logBuffer.filter((line) => /error|invalid|failed|unable|unsupported|cannot|memory/i.test(line))
          const detail = (useful.length ? useful : logBuffer).slice(-8).join('\n')
          throw new Error(`반복 음성 준비에 실패했습니다: ${audios[k].name} (FFmpeg 종료 코드 ${normalizeExitCode})${detail ? `\n${detail}` : ''}`)
        }
        await fp.deleteFile(`audio${k}`).catch(() => {})
        audioFiles.push(normalizedName)
        audioTrimStarts.push(0)
      } else {
        audioFiles.push(`audio${k}`)
        audioTrimStarts.push(audios[k].trimStart)
      }
    }

    // 3. Assemble inputs. Each source is opened once; -stream_loop handles
    // repeats without creating dozens of parallel decoder instances.
    const args: string[] = ['-y']
    const inputIdxOf: number[] = []
    let inputCount = 0
    clips.forEach((c, fileIndex) => {
      if (c.kind === 'color') { inputIdxOf.push(-1); return }
      const repeat = Math.max(1, c.repeat)
      const sourceDuration = c.trimEnd - c.trimStart
      if (c.kind === 'image') {
        args.push('-loop', '1', '-t', String(clipTimelineDuration(c)), '-i', inputFiles[fileIndex])
      } else {
        if (repeat > 1) args.push('-stream_loop', String(repeat - 1))
        args.push('-ss', String(inputTrimStarts[fileIndex]), '-t', String(sourceDuration * repeat), '-i', inputFiles[fileIndex])
      }
      inputIdxOf.push(inputCount++)
    })
    texts.forEach((_, k) => {
      args.push('-loop', '1', '-i', `text${k}.png`)
    })
    const ovBase = inputCount + texts.length
    overlays.forEach((o, k) => {
      if (o.kind === 'image') args.push('-loop', '1', '-t', String(ovLen(o)), '-i', overlayFiles[k])
      else {
        if (o.repeat > 1) args.push('-stream_loop', String(o.repeat - 1))
        args.push('-ss', String(overlayTrimStarts[k]), '-t', String((o.trimEnd - o.trimStart) * Math.max(1, o.repeat)), '-i', overlayFiles[k])
      }
    })
    const bgBase = ovBase + overlays.length
    const bgInputIdx: number[] = []
    let freeInputCount = bgBase
    backgrounds.forEach((b, k) => {
      if (b.kind === 'color') { bgInputIdx.push(-1); return }
      const sourceDuration = (b.trimEnd - b.trimStart) * Math.max(1, b.repeat)
      if (b.kind === 'image') args.push('-loop', '1', '-t', String(clipTimelineDuration(b)), '-i', backgroundFiles[k])
      else {
        if (b.repeat > 1) args.push('-stream_loop', String(b.repeat - 1))
        args.push('-ss', String(backgroundTrimStarts[k]), '-t', String(sourceDuration), '-i', backgroundFiles[k])
      }
      bgInputIdx.push(freeInputCount++)
    })
    const audioBase = freeInputCount
    audios.forEach((a, k) => {
      args.push('-stream_loop', String(Math.max(0, a.repeat - 1)), '-ss', String(audioTrimStarts[k]), '-t', String(audioLength(a)), '-i', audioFiles[k])
      freeInputCount++
    })

    // 4. Build the filter graph (one v/a pair per timeline clip).
    const filters: string[] = []
    clips.forEach((c, p) => {
      const sp = c.speed
      const segDur = clipTimelineDuration(c)
      if (c.kind === 'color') {
        const hex = (c.bgColor || '#000000').replace('#', '0x')
        filters.push(`color=c=${hex}:s=${W}x${H}:r=30:d=${segDur.toFixed(3)},setsar=1,format=rgba[v${p}]`)
      } else {
        // Cropped clips fill the frame (cover) like the preview; uncropped clips
        // keep their aspect with letterbox padding so no content is lost.
        const cr = c.crop
        const cropped = cr.top || cr.right || cr.bottom || cr.left
        const fit = cropped
          ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`
          : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`
        filters.push(
          `[${inputIdxOf[p]}:v]setpts=PTS/${sp},${spatialFilters(c)}${fit},setsar=1,fps=30,format=rgba[v${p}]`,
        )
      }

      const useAudio = c.kind === 'video' && audioFlags[p] && !c.muted && c.volume > 0
      if (useAudio) {
        filters.push(
          `[${inputIdxOf[p]}:a]${buildAtempo(sp)}volume=${c.volume},aresample=44100,` +
            `aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${segDur.toFixed(3)},asetpts=N/SR/TB[a${p}]`,
        )
      } else {
        filters.push(
          `anullsrc=r=44100:cl=stereo,atrim=0:${segDur.toFixed(3)},` +
            `aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=N/SR/TB[a${p}]`,
        )
      }
    })

    // concat requires inputs interleaved per segment: [v0][a0][v1][a1]...
    const concatInputs = clips.map((_, p) => `[v${p}][a${p}]`).join('')
    filters.push(`${concatInputs}concat=n=${clips.length}:v=1:a=1[cv][ca]`)

    // Build a true background canvas, then place the main track on top. Main
    // letterboxing is transparent so the background remains visible.
    filters.push(`color=c=black:s=${W}x${H}:r=30:d=${duration.toFixed(3)},format=rgba[bgbase]`)
    let lastBg = '[bgbase]'
    backgrounds.forEach((b, k) => {
      const len = clipTimelineDuration(b)
      const shift = b.start
      const out = `[bgo${k}]`
      if (b.kind === 'color') {
        const color = (b.bgColor || '#000000').replace('#', '0x')
        filters.push(`color=c=${color}:s=${W}x${H}:r=30:d=${len.toFixed(3)},format=rgba,setpts=PTS+${shift.toFixed(3)}/TB[bgv${k}]`)
      } else {
        const speedF = b.kind === 'video' ? `setpts=PTS/${b.speed},` : ''
        filters.push(
          `[${bgInputIdx[k]}:v]${speedF}${spatialFilters(b)}` +
          `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},format=rgba,` +
          `tpad=start_duration=${shift.toFixed(3)}:start_mode=add:color=0x00000000[bgv${k}]`,
        )
      }
      filters.push(`${lastBg}[bgv${k}]overlay=0:0:eof_action=pass:enable='between(t,${shift.toFixed(3)},${(shift + len).toFixed(3)})'${out}`)
      lastBg = out
    })
    filters.push(`${lastBg}[cv]overlay=0:0:eof_action=pass[mainv]`)

    // Composite PiP overlays (video/image) onto the running video, shifting
    // each to its timeline start and scaling/positioning per x/y/scale.
    let lastV = '[mainv]'
    overlays.forEach((o, k) => {
      const ovIdx = ovBase + k
      const len = ovLen(o)
      const shift = o.start
      const ovW = Math.max(2, Math.round((o.scale * W) / 2) * 2)
      // Pad the overlay's START with `shift` seconds (instead of shifting PTS) so
      // its timestamps begin at 0 like the base — avoids an overlay-sync deadlock.
      const speedF = o.kind === 'video' ? `setpts=PTS/${o.speed},` : ''
      // Free rotation: rotate=… expands the canvas to the rotated bounding box with
      // transparent fill, so corners aren't clipped.
      const rad = ((o.angle || 0) * Math.PI) / 180
      const rotF = o.angle
        ? `rotate=a=${rad.toFixed(5)}:ow=rotw(${rad.toFixed(5)}):oh=roth(${rad.toFixed(5)}):c=0x00000000,`
        : ''
      filters.push(
        `[${ovIdx}:v]${speedF}${spatialFilters(o)}scale=${ovW}:-2,format=rgba,${rotF}` +
          `tpad=start_duration=${shift.toFixed(3)}:start_mode=add:color=0x00000000[ovv${k}]`,
      )
      const out = `[ovo${k}]`
      filters.push(
        `${lastV}[ovv${k}]overlay=x='${o.x.toFixed(4)}*W-w/2':y='${o.y.toFixed(4)}*H-h/2':` +
          `eof_action=pass:enable='between(t,${shift.toFixed(3)},${(shift + len).toFixed(3)})'${out}`,
      )
      lastV = out
    })

    // Overlay each text PNG over its time window (above the PiP layers).
    texts.forEach((t, k) => {
      const inputIdx = inputCount + k
      const out = `[txt${k}]`
      filters.push(
        `${lastV}[${inputIdx}:v]overlay=0:0:eof_action=pass:` +
          `enable='between(t,${t.start.toFixed(3)},${t.end.toFixed(3)})'${out}`,
      )
      lastV = out
    })

    // Mix the main-track audio with timed overlay, background and music tracks.
    const mixInputs: string[] = []
    filters.push(`[ca]apad=whole_dur=${duration.toFixed(3)},atrim=0:${duration.toFixed(3)}[amain]`)
    mixInputs.push('[amain]')
    overlays.forEach((o, k) => {
      if (!overlayAudioFlags[k] || o.muted || o.volume <= 0 || o.kind !== 'video') return
      const label = `aov${k}`
      filters.push(
        `[${ovBase + k}:a]${buildAtempo(o.speed)}volume=${o.volume},aresample=44100,` +
        `aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${Math.round(o.start * 1000)}:all=1,` +
        `apad=whole_dur=${duration.toFixed(3)},atrim=0:${duration.toFixed(3)}[${label}]`,
      )
      mixInputs.push(`[${label}]`)
    })
    backgrounds.forEach((b, k) => {
      if (!backgroundAudioFlags[k] || b.muted || b.volume <= 0 || b.kind !== 'video') return
      const label = `abg${k}`
      filters.push(
        `[${bgInputIdx[k]}:a]${buildAtempo(b.speed)}volume=${b.volume},aresample=44100,` +
        `aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${Math.round(b.start * 1000)}:all=1,` +
        `apad=whole_dur=${duration.toFixed(3)},atrim=0:${duration.toFixed(3)}[${label}]`,
      )
      mixInputs.push(`[${label}]`)
    })
    audios.forEach((a, k) => {
      if (a.muted || a.volume <= 0) return
      const label = `amusic${k}`
      filters.push(
        `[${audioBase + k}:a]volume=${a.volume},aresample=44100,` +
        `aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${Math.round(a.start * 1000)}:all=1,` +
        `apad=whole_dur=${duration.toFixed(3)},atrim=0:${duration.toFixed(3)}[${label}]`,
      )
      mixInputs.push(`[${label}]`)
    })
    if (mixInputs.length === 1) filters.push(`${mixInputs[0]}anull[finala]`)
    else filters.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:normalize=0,atrim=0:${duration.toFixed(3)}[finala]`)

    args.push('-filter_complex', filters.join(';'))
    args.push('-map', lastV, '-map', '[finala]', '-t', duration.toFixed(3))
    const finalArgs = (encoder: 'h264_videotoolbox' | null) => {
      const next = [...args]
      if (format === 'webm') {
        next.push(
        '-c:v', 'libvpx', '-b:v', '1.5M', '-crf', '12', '-pix_fmt', 'yuv420p',
        '-c:a', 'libvorbis', '-q:a', '4', outName,
        )
      } else {
        next.push(
        ...mp4VideoEncodingArgs(H, encoder),
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outName,
        )
      }
      return next
    }

    progressReporter.setStage(0.25, 0.7)
    logBuffer = []
    let exitCode = await fp.exec(finalArgs(format === 'mp4' ? nativeVideoEncoder : null))
    if (exitCode !== 0 && format === 'mp4' && nativeVideoEncoder) {
      externalLog?.('하드웨어 인코딩이 실패해 호환 인코딩으로 자동 재시도합니다.')
      await fp.deleteFile(outName).catch(() => {})
      logBuffer = []
      exitCode = await fp.exec(finalArgs(null))
    }
    if (exitCode !== 0) {
      resetEngine = true
      const useful = logBuffer.filter((line) => /error|invalid|failed|unable|not found|no such|unsupported|cannot|memory/i.test(line))
      const detail = (useful.length ? useful : logBuffer).slice(-8).join('\n')
      throw new Error(`영상 변환에 실패했습니다. (FFmpeg 종료 코드 ${exitCode})${detail ? `\n${detail}` : ''}`)
    }
    progressReporter.setStage(0.95, 0.03)
    progressReporter.report(1)
    if (fp.fileSize) {
      const size = await fp.fileSize(outName)
      if (size <= 0) throw new Error('영상 변환 결과가 비어 있습니다. 설정을 낮추거나 원본 파일을 다시 확인해 주세요.')
      logBuffer = []
      const validationCode = await fp.exec(['-v', 'error', '-i', outName, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-'])
      if (validationCode !== 0) {
        resetEngine = true
        const detail = logBuffer.slice(-8).join('\n')
        throw new Error(`완성된 영상의 재생 검증에 실패했습니다.${detail ? `\n${detail}` : ''}`)
      }
      await cleanup(fp, outName, clips.length, texts.length, overlays.length, backgrounds.length, audios.length, true)
      return { kind: 'native-file', name: outName, size, format }
    }

    const data = await fp.readFile(outName)
    // Copy into a fresh ArrayBuffer-backed array (readFile may be SharedArrayBuffer-backed).
    const bytes = new Uint8Array(data as Uint8Array)
    if (bytes.byteLength === 0) {
      throw new Error('영상 변환 결과가 비어 있습니다. 설정을 낮추거나 원본 파일을 다시 확인해 주세요.')
    }

    // 5. Clean up the virtual filesystem for the next run.
    await cleanup(fp, outName, clips.length, texts.length, overlays.length, backgrounds.length, audios.length)

    return new Blob([bytes], { type: format === 'webm' ? 'video/webm' : 'video/mp4' })
  } catch (error) {
    await cleanup(fp, outName, clips.length, texts.length, overlays.length, backgrounds.length, audios.length)
    if (resetEngine) {
      fp.terminate()
      ffmpeg = null
    }
    throw error
  } finally {
    fp.off('progress', onProg)
  }
}

async function cleanup(fp: FFmpegEngine, outName: string, nClips: number, nTexts: number, nOv: number, nBg: number, nAudio: number, keepOutput = false) {
  const names = keepOutput ? [] : [outName]
  for (let i = 0; i < nClips; i++) names.push(`in${i}`, `norm${i}.mp4`)
  for (let i = 0; i < nClips; i++) names.push(`norm${i}.png`)
  for (let k = 0; k < nTexts; k++) names.push(`text${k}.png`)
  for (let k = 0; k < nOv; k++) names.push(`ov${k}`, `normov${k}.mp4`, `normov${k}.png`)
  for (let k = 0; k < nBg; k++) names.push(`bg${k}`, `normbg${k}.mp4`, `normbg${k}.png`)
  for (let k = 0; k < nAudio; k++) names.push(`audio${k}`, `normaudio${k}.m4a`)
  for (const n of names) await fp.deleteFile(n).catch(() => {})
}
