const TARGET_RMS = 0.16

/** Returns a safe gain that makes quiet recordings clearer without clipping peaks. */
export function recommendedAudioGain(channels: ReadonlyArray<ArrayLike<number>>): number {
  if (!channels.length || !channels.some((channel) => channel.length)) return 1
  let squares = 0
  let count = 0
  let peak = 0
  const totalSamples = channels.reduce((sum, channel) => sum + channel.length, 0)
  const stride = Math.max(1, Math.floor(totalSamples / 2_000_000))
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += stride) {
      const sample = Number(channel[index]) || 0
      squares += sample * sample
      peak = Math.max(peak, Math.abs(sample))
      count += 1
    }
  }
  if (!count) return 1
  const rms = Math.sqrt(squares / count)
  if (rms < 1e-5 || peak < 1e-5) return 1
  const gain = Math.min(TARGET_RMS / rms, .98 / peak, 2)
  return Number(Math.max(.25, gain).toFixed(2))
}

const cache = new Map<string, Promise<number>>()

export function analyzeAudioGain(file: File, src: string, cacheKey: string): Promise<number> {
  const previous = cache.get(cacheKey)
  if (previous) return previous
  const task = (async () => {
    const bytes = file.size ? await file.arrayBuffer() : await (await fetch(src)).arrayBuffer()
    const Context = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Context) throw new Error('이 기기에서는 오디오 분석을 지원하지 않습니다.')
    const context = new Context()
    try {
      const buffer = await context.decodeAudioData(bytes.slice(0))
      return recommendedAudioGain(Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index)))
    } finally {
      await context.close().catch(() => {})
    }
  })()
  cache.set(cacheKey, task)
  task.catch(() => cache.delete(cacheKey))
  return task
}

