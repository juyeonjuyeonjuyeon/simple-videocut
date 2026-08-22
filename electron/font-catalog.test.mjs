import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeFontFamilies } from './font-catalog.mjs'

test('font catalog removes unsafe, hidden, empty, and duplicate family names', () => {
  assert.deepEqual(normalizeFontFamilies(' Helvetica \n.NS Hidden\nApple Gothic\nHelvetica\n\nBad\u0001Name\n'), [
    'Apple Gothic',
    'Helvetica',
  ])
})
