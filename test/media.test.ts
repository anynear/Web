import { describe, expect, it } from 'vitest'
import { quarterTurns } from '../src/core/media'

// Rotating in the storage: angles like `quarterTurns` in the app.
describe('quarterTurns', () => {
  it('normalizes to a quarter turn', () => {
    expect(quarterTurns(0)).toBe(0)
    expect(quarterTurns(90)).toBe(90)
    expect(quarterTurns(-90)).toBe(270)
    expect(quarterTurns(360)).toBe(0)
    expect(quarterTurns(540)).toBe(180)
  })
})
