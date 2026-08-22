import type { MosaicRegion } from '../types'
import { sanitizeMosaicRegions } from '../utils/mosaic'

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2)

/** Appends regional pixelize branches and returns the final labelled stream. */
export function appendMosaicFilters(
  filters: string[],
  input: string,
  regions: MosaicRegion[] | undefined,
  prefix: string,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  outputHeight: number,
): string {
  let current = input
  sanitizeMosaicRegions(regions).forEach((region, index) => {
    const width = even(region.width * sourceWidth)
    const height = even(region.height * sourceHeight)
    const x = Math.max(0, Math.min(even(region.x * sourceWidth), Math.max(0, even(sourceWidth) - width)))
    const y = Math.max(0, Math.min(even(region.y * sourceHeight), Math.max(0, even(sourceHeight) - height)))
    const outputBlock = region.pixelSize * outputHeight / 720
    const blockWidth = Math.max(2, Math.min(1024, Math.round(outputBlock * sourceWidth / Math.max(1, targetWidth))))
    const blockHeight = Math.max(2, Math.min(1024, Math.round(outputBlock * sourceHeight / Math.max(1, targetHeight))))
    const keep = `[${prefix}keep${index}]`
    const effect = `[${prefix}effect${index}]`
    const patch = `[${prefix}patch${index}]`
    const output = `[${prefix}out${index}]`
    filters.push(`${current}format=rgba,split=2${keep}${effect}`)
    filters.push(`${effect}crop=${width}:${height}:${x}:${y},pixelize=w=${blockWidth}:h=${blockHeight}:mode=avg${patch}`)
    filters.push(`${keep}${patch}overlay=x=${x}:y=${y}:eval=init:eof_action=pass${output}`)
    current = output
  })
  return current
}
