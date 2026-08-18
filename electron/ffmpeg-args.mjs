import { isAbsolute } from 'node:path'

const BLOCKED_FLAGS = new Set([
  '-attach', '-dump_attachment', '-filter_script', '-filter_complex_script',
  '-protocol_whitelist', '-passlogfile', '-report', '-safe',
])
const EXTERNAL_PROTOCOL = /^[a-z][a-z0-9+.-]*:/i
const FILTER_FILE_SOURCE = /(?:^|[,;])\s*(?:a?movie|subtitles|ass)\s*=|(?:textfile|filename)\s*=|sendcmd=[^,;]*\bf=/i

/**
 * The renderer may choose editor parameters, but it must never turn FFmpeg
 * into a general filesystem or network client. All media is staged into the
 * private render directory before this boundary.
 */
export function validateFFmpegArgs(args) {
  if (!Array.isArray(args) || args.length === 0 || args.length > 4096) {
    throw new Error('FFmpeg 명령이 잘못되었습니다.')
  }
  let totalLength = 0
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.length === 0 || arg.length > 1_000_000 || /[\0\r\n]/.test(arg)) {
      throw new Error('FFmpeg 인수가 잘못되었습니다.')
    }
    totalLength += arg.length
    if (totalLength > 4_000_000) throw new Error('FFmpeg 명령이 너무 큽니다.')
    if (BLOCKED_FLAGS.has(arg)) throw new Error('허용되지 않는 FFmpeg 기능입니다.')
    if (isAbsolute(arg) || /^[a-z]:[\\/]/i.test(arg) || /(^|[\\/])\.\.([\\/]|$)/.test(arg)) {
      throw new Error('안전하지 않은 파일 경로입니다.')
    }
    if (EXTERNAL_PROTOCOL.test(arg)) throw new Error('허용되지 않는 외부 미디어 주소입니다.')
    if (FILTER_FILE_SOURCE.test(arg)) throw new Error('허용되지 않는 필터 파일 입력입니다.')
  }
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== '-i') continue
    const input = args[index + 1]
    if (!input || !/^[a-zA-Z0-9._-]+$/.test(input)) throw new Error('안전하지 않은 입력 파일 이름입니다.')
  }
  return args
}
