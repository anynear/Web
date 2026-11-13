import { describe, expect, it } from 'vitest'
import { MAX_SEEN, netStates } from './netState'

describe('netStates', () => {
  it('secured from two operators, incomplete only after it was secured', () => {
    let r = netStates([{ file: 'a', secured: false }], [])
    expect(r.states.get('a')).toBe('securing')
    r = netStates([{ file: 'a', secured: true }], r.seen)
    expect(r.states.get('a')).toBe('secured')
    expect(r.seen).toEqual(['a'])
    r = netStates([{ file: 'a', secured: false }], r.seen)
    expect(r.states.get('a')).toBe('incomplete')
    r = netStates([{ file: 'a', secured: true }], r.seen)
    expect(r.states.get('a')).toBe('secured')
    expect(r.seen).toEqual(['a'])
  })

  it('keeps the list unchanged when nothing new is secured', () => {
    const seen = ['x']
    expect(netStates([{ file: 'x', secured: true }], seen).seen).toBe(seen)
  })

  it('drops the oldest beyond the limit', () => {
    const seen = Array.from({ length: MAX_SEEN }, (_, i) => `f${i}`)
    const r = netStates([{ file: 'new', secured: true }], seen)
    expect(r.seen.length).toBe(MAX_SEEN)
    expect(r.seen[0]).toBe('f1')
    expect(r.seen.at(-1)).toBe('new')
  })
})
