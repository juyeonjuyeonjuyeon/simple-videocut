import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import type { Clip, Overlay, AudioClip, Background, TextOverlay, AspectRatio, Crop, Rotation } from '../types'
import { aspectToWH, projectDuration, overlayLength, audioLength, clipTimelineDuration } from '../utils/time'
import { hexToRgba } from '../utils/color'

// Use the ESM core: @ffmpeg/ffmpeg 0.12 runs its worker as a module worker,
// where `importScripts` is unavailable, so it falls back to `import()` — which
// requires an ES module, not the UMD build.
const CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm'

let ffmpeg: FFmpeg | null = null
let logBuffer: string[] = []
let externalLog: ((line: string) => void) | null = null

async function getFFmpeg(onLog?: (line: string) => void): Promise<FFmpeg> {
  externalLog = onLog ?? null
  if (ffmpeg) return ffmpeg
  const instance = new FFmpeg()
  instance.on('log', ({ message }) => {
    logBuffer.push(message)
    externalLog?.(message)
  })
  await instance.load({
    coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
  })
  ffmpeg = instance
  return instance
}

/** Detect whether an input file in ffmpeg's FS carries an audio stream. */
async function hasAudioStream(fp: FFmpeg, name: string): Promise<boolean> {
  logBuffer = []
  // No output file => ffmpeg exits with an error but still prints stream info.
  await fp.exec(['-hide_banner', '-i', name]).catch(() => {})
  return logBuffer.some((l) => /Stream #.*Audio:/i.test(l))
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

/** Export timeline length of an overlay. */
function ovLen(o: Overlay): number {
  return overlayLength(o)
}

export async function exportVideo(opts: ExportOptions): Promise<Blob> {
  const { clips, texts, aspect, height, onProgress, onLog } = opts
  const overlays = (opts.overlays ?? []).filter((o) => o.kind === 'video' || o.kind === 'image')
  const audios = opts.audios ?? []
  const backgrounds = opts.backgrounds ?? []
  const format = opts.format ?? 'mp4'
  if (clips.length === 0) throw new Error('내보낼 클립이 없습니다.')

  const fp = await getFFmpeg(onLog)
  const { w: W, h: H } = aspectToWH(aspect, height)
  const duration = projectDuration(clips, overlays, audios, texts, backgrounds)

  const onProg = ({ progress }: { progress: number }) => {
    if (onProgress && isFinite(progress)) onProgress(Math.max(0, Math.min(progress, 1)))
  }
  fp.on('progress', onProg)
  const outName = `out.${format}`

  try {
    // 1. Write each unique clip file once and probe it for an audio track.
    //    (Color clips have no file — they become a lavfi color source.)
    const audioFlags: boolean[] = []
    for (let i = 0; i < clips.length; i++) {
      if (clips[i].kind === 'color') { audioFlags.push(false); continue }
      await fp.writeFile(`in${i}`, await fetchFile(clips[i].file))
      audioFlags.push(await hasAudioStream(fp, `in${i}`))
    }

    // "repeat" expands a clip into N back-to-back concat segments that all
    // reference the same input file (added as separate -i streams).
    const expanded: { clip: Clip; fileIndex: number }[] = []
    clips.forEach((c, i) => {
      for (let r = 0; r < Math.max(1, c.repeat); r++) expanded.push({ clip: c, fileIndex: i })
    })

    // 2. Render each text overlay to a PNG at output resolution.
    for (let k = 0; k < texts.length; k++) {
      await fp.writeFile(`text${k}.png`, await renderTextPng(texts[k], W, H))
    }

    // 2b. Write free-track media once and remember which video layers carry audio.
    const overlayAudioFlags: boolean[] = []
    for (let k = 0; k < overlays.length; k++) {
      await fp.writeFile(`ov${k}`, await fetchFile(overlays[k].file))
      overlayAudioFlags.push(overlays[k].kind === 'video' && await hasAudioStream(fp, `ov${k}`))
    }
    const backgroundAudioFlags: boolean[] = []
    for (let k = 0; k < backgrounds.length; k++) {
      const b = backgrounds[k]
      if (b.kind === 'color') { backgroundAudioFlags.push(false); continue }
      await fp.writeFile(`bg${k}`, await fetchFile(b.file))
      backgroundAudioFlags.push(b.kind === 'video' && await hasAudioStream(fp, `bg${k}`))
    }
    for (let k = 0; k < audios.length; k++) {
      await fp.writeFile(`audio${k}`, await fetchFile(audios[k].file))
    }

    // 3. Assemble inputs. Color segments add no -i; track each segment's input index.
    const args: string[] = []
    const inputIdxOf: number[] = []
    let inputCount = 0
    expanded.forEach((e) => {
      const c = e.clip
      if (c.kind === 'color') { inputIdxOf.push(-1); return }
      const dur = c.trimEnd - c.trimStart
      if (c.kind === 'image') args.push('-loop', '1', '-t', String(dur), '-i', `in${e.fileIndex}`)
      else args.push('-ss', String(c.trimStart), '-t', String(dur), '-i', `in${e.fileIndex}`)
      inputIdxOf.push(inputCount++)
    })
    texts.forEach((_, k) => {
      args.push('-loop', '1', '-i', `text${k}.png`)
    })
    const ovBase = inputCount + texts.length
    overlays.forEach((o, k) => {
      if (o.kind === 'image') args.push('-loop', '1', '-t', String(ovLen(o)), '-i', `ov${k}`)
      else args.push('-stream_loop', String(Math.max(0, o.repeat - 1)), '-ss', String(o.trimStart), '-t', String((o.trimEnd - o.trimStart) * Math.max(1, o.repeat)), '-i', `ov${k}`)
    })
    const bgBase = ovBase + overlays.length
    const bgInputIdx: number[] = []
    let freeInputCount = bgBase
    backgrounds.forEach((b, k) => {
      if (b.kind === 'color') { bgInputIdx.push(-1); return }
      const sourceDuration = (b.trimEnd - b.trimStart) * Math.max(1, b.repeat)
      if (b.kind === 'image') args.push('-loop', '1', '-t', String(clipTimelineDuration(b)), '-i', `bg${k}`)
      else args.push('-stream_loop', String(Math.max(0, b.repeat - 1)), '-ss', String(b.trimStart), '-t', String(sourceDuration), '-i', `bg${k}`)
      bgInputIdx.push(freeInputCount++)
    })
    const audioBase = freeInputCount
    audios.forEach((a, k) => {
      args.push('-stream_loop', String(Math.max(0, a.repeat - 1)), '-ss', String(a.trimStart), '-t', String(audioLength(a)), '-i', `audio${k}`)
      freeInputCount++
    })

    // 4. Build the filter graph (one v/a pair per expanded segment).
    const filters: string[] = []
    expanded.forEach((e, p) => {
      const c = e.clip
      const sp = c.speed
      const segDur = (c.trimEnd - c.trimStart) / sp
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

      const useAudio = c.kind === 'video' && audioFlags[e.fileIndex] && !c.muted && c.volume > 0
      if (useAudio) {
        filters.push(
          `[${inputIdxOf[p]}:a]${buildAtempo(sp)}volume=${c.volume},aresample=44100,` +
            `aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=N/SR/TB[a${p}]`,
        )
      } else {
        filters.push(
          `anullsrc=r=44100:cl=stereo,atrim=0:${segDur.toFixed(3)},` +
            `aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=N/SR/TB[a${p}]`,
        )
      }
    })

    // concat requires inputs interleaved per segment: [v0][a0][v1][a1]...
    const concatInputs = expanded.map((_, p) => `[v${p}][a${p}]`).join('')
    filters.push(`${concatInputs}concat=n=${expanded.length}:v=1:a=1[cv][ca]`)

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
    if (format === 'webm') {
      args.push(
        '-c:v', 'libvpx', '-b:v', '1.5M', '-crf', '12', '-pix_fmt', 'yuv420p',
        '-c:a', 'libvorbis', '-q:a', '4', outName,
      )
    } else {
      args.push(
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outName,
      )
    }

    await fp.exec(args)
    const data = await fp.readFile(outName)
    // Copy into a fresh ArrayBuffer-backed array (readFile may be SharedArrayBuffer-backed).
    const bytes = new Uint8Array(data as Uint8Array)

    // 5. Clean up the virtual filesystem for the next run.
    await cleanup(fp, outName, clips.length, texts.length, overlays.length, backgrounds.length, audios.length)

    return new Blob([bytes], { type: format === 'webm' ? 'video/webm' : 'video/mp4' })
  } catch (error) {
    await cleanup(fp, outName, clips.length, texts.length, overlays.length, backgrounds.length, audios.length)
    throw error
  } finally {
    fp.off('progress', onProg)
  }
}

async function cleanup(fp: FFmpeg, outName: string, nClips: number, nTexts: number, nOv: number, nBg: number, nAudio: number) {
  const names = [outName]
  for (let i = 0; i < nClips; i++) names.push(`in${i}`)
  for (let k = 0; k < nTexts; k++) names.push(`text${k}.png`)
  for (let k = 0; k < nOv; k++) names.push(`ov${k}`)
  for (let k = 0; k < nBg; k++) names.push(`bg${k}`)
  for (let k = 0; k < nAudio; k++) names.push(`audio${k}`)
  for (const n of names) await fp.deleteFile(n).catch(() => {})
}
