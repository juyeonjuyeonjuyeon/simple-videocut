import { describe, expect, it } from 'vitest'
import { recommendedAudioGain } from './audio-level'

describe('automatic audio level', () => {
  it('boosts quiet recordings up to the safe 200% editor limit', () => {
    expect(recommendedAudioGain([new Float32Array([.01, -.01, .01, -.01])])).toBe(2)
  })

  it('reduces loud audio and protects peaks from clipping', () => {
    const gain = recommendedAudioGain([new Float32Array([.9, -.9, .3, -.3])])
    expect(gain).toBeLessThan(1)
    expect(gain * .9).toBeLessThanOrEqual(.98)
  })

  it('leaves silence unchanged', () => {
    expect(recommendedAudioGain([new Float32Array(20)])).toBe(1)
  })
})
