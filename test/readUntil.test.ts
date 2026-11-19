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
    expect(readOnArrival(499_000, undefined, 500_000)).toBe(true)
    expect(readOnArrival(500_000, undefined, 500_000)).toBe(false)
  })

  it('counts a message from the second loading began as unread', () => {
    // Send times are whole seconds: sent at 500.7 s it says 500 s, after loading began at 500.4 s.
    expect(readOnArrival(500_000, undefined, 500_400)).toBe(false)
    expect(readOnArrival(499_000, undefined, 500_400)).toBe(true)
  })
})
