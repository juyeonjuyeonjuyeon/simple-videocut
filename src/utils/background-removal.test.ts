import { describe, expect, it } from 'vitest'
import { removeConnectedBackground } from './background-removal'

const image = (rows: Array<Array<[number, number, number, number?]>>) => {
  const height = rows.length
  const width = rows[0].length
  const data = new Uint8ClampedArray(width * height * 4)
  rows.flat().forEach(([red, green, blue, alpha = 255], index) => {
    data.set([red, green, blue, alpha], index * 4)
  })
  return { data, width, height }
}

describe('removeConnectedBackground', () => {
  it('automatically removes a dominant edge background but keeps the subject', () => {
    const source = image([
      [[250, 250, 250], [250, 250, 250], [250, 250, 250], [250, 250, 250], [250, 250, 250]],
      [[250, 250, 250], [250, 250, 250], [220, 40, 50], [250, 250, 250], [250, 250, 250]],
      [[250, 250, 250], [220, 40, 50], [220, 40, 50], [220, 40, 50], [250, 250, 250]],
      [[250, 250, 250], [250, 250, 250], [220, 40, 50], [250, 250, 250], [250, 250, 250]],
      [[250, 250, 250], [250, 250, 250], [250, 250, 250], [250, 250, 250], [250, 250, 250]],
    ])

    const result = removeConnectedBackground(source.data, source.width, source.height, 35)
    expect(result.background).toEqual([250, 250, 250])
    expect(result.data[3]).toBe(0)
    expect(result.data[(2 * source.width + 2) * 4 + 3]).toBe(255)
    expect(result.removedPixels).toBeGreaterThan(0)
  })

  it('uses sensitivity to include a wider range of similar edge colours', () => {
    const source = image([
      [[245, 245, 245], [230, 230, 230], [245, 245, 245]],
      [[230, 230, 230], [30, 40, 60], [230, 230, 230]],
      [[245, 245, 245], [230, 230, 230], [245, 245, 245]],
    ])

    const cautious = removeConnectedBackground(source.data, source.width, source.height, 0)
    const broad = removeConnectedBackground(source.data, source.width, source.height, 70)
    const topMiddleAlpha = 1 * 4 + 3
    expect(cautious.data[topMiddleAlpha]).toBeGreaterThan(0)
    expect(broad.data[topMiddleAlpha]).toBe(0)
    expect(broad.data[(source.width + 1) * 4 + 3]).toBe(255)
  })

  it('does not erase a matching colour enclosed inside the subject', () => {
    const white: [number, number, number] = [255, 255, 255]
    const dark: [number, number, number] = [20, 20, 20]
    const source = image([
      [white, white, white, white, white],
      [white, dark, dark, dark, white],
      [white, dark, white, dark, white],
      [white, dark, dark, dark, white],
      [white, white, white, white, white],
    ])

    const result = removeConnectedBackground(source.data, source.width, source.height, 100)
    expect(result.data[(2 * source.width + 2) * 4 + 3]).toBe(255)
  })

  it('walks through existing transparency without treating an all-transparent edge as black', () => {
    const transparent = [0, 0, 0, 0] as [number, number, number, number]
    const white = [255, 255, 255] as [number, number, number]
    const dark = [20, 20, 20] as [number, number, number]
    const connected = image([
      [white, transparent, white],
      [white, transparent, white],
      [white, white, white],
    ])
    expect(removeConnectedBackground(connected.data, connected.width, connected.height, 35).removedPixels).toBeGreaterThan(0)

    const alreadyCutOut = image([
      [transparent, transparent, transparent],
      [transparent, dark, transparent],
      [transparent, transparent, transparent],
    ])
    const result = removeConnectedBackground(alreadyCutOut.data, alreadyCutOut.width, alreadyCutOut.height, 100)
    expect(result.removedPixels).toBe(0)
    expect(result.data[(alreadyCutOut.width + 1) * 4 + 3]).toBe(255)
  })
})
