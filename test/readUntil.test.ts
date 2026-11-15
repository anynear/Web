import { describe, expect, it } from 'vitest'
import { decodeMarks, hasNewer, mergeMarks, readOnArrival } from '../src/core/readUntil'

// Read up to a point per conversation on all own devices and after the emergency card (FUT B9).
describe('read until', () => {
  it('takes the later time per conversation and ignores broken values', () => {
    const merged = mergeMarks({ 'c:k': 100, 'd:p': 7 }, { 'c:k': 50, 'c:x': 3 })
    expect(merged).toEqual({ 'c:k': 100, 'd:p': 7, 'c:x': 3 })
    expect(decodeMarks(JSON.stringify(merged))).toEqual(merged)
    expect(decodeMarks('kaputt')).toEqual({})
    expect(decodeMarks('[1]')).toEqual({})
    expect(hasNewer({ 'c:k': 100 }, { 'c:k': 50 })).toBe(true)
    expect(hasNewer({ 'c:k': 50 }, { 'c:k': 100, 'd:p': 1 })).toBe(false)
  })

  it('keeps only messages after the mark unread', () => {
    expect(readOnArrival(100, 100, 50)).toBe(true)
    expect(readOnArrival(101, 100, 500)).toBe(false)
  })

  it('without a mark counts everything before loading as read', () => {
    expect(readOnArrival(499, undefined, 500)).toBe(true)
    expect(readOnArrival(500, undefined, 500)).toBe(false)
  })
})
