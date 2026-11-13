import { describe, expect, it } from 'vitest'
import { KEEP_MS, SETTING_KEY, ack, decodeAcks, encodeAcks, isAcked, mergeAcks, pruneAcks, takeRemoteAcks, unack } from '../src/core/alertAcks'

const DAY = 24 * 60 * 60 * 1000

describe('alertAcks', () => {
  it('uses the same setting key as the app', () => {
    expect(SETTING_KEY).toBe('alerts_acked')
  })

  it('acks with a positive and unacks with a negative time', () => {
    const a = ack({}, 'aa', 1000)
    expect(a).toEqual({ aa: 1000 })
    expect(isAcked(a, 'aa')).toBe(true)
    const b = unack(a, 'aa', 2000)
    expect(b).toEqual({ aa: -2000 })
    expect(isAcked(b, 'aa')).toBe(false)
    expect(isAcked(b, 'bb')).toBe(false)
  })

  it('merges per ID: the larger magnitude wins, ack wins a tie', () => {
    expect(mergeAcks({ a: 100, b: -300, c: 5 }, { a: -200, b: 250, d: 7 })).toEqual({ a: -200, b: -300, c: 5, d: 7 })
    expect(mergeAcks({ a: -100 }, { a: 100 })).toEqual({ a: 100 })
    expect(mergeAcks({ a: 100 }, { a: -100 })).toEqual({ a: 100 })
  })

  it('drops entries older than 30 days, by magnitude', () => {
    const now = 100 * DAY
    const acks = { old: now - KEEP_MS - 1, oldNeg: -(now - KEEP_MS - 1), edge: now - KEEP_MS, fresh: -(now - DAY) }
    expect(pruneAcks(acks, now)).toEqual({ edge: now - KEEP_MS, fresh: -(now - DAY) })
  })

  it('reads the JSON object format and ignores broken values', () => {
    expect(decodeAcks(encodeAcks({ ab12: 1700000000000, cd34: -1700000000001 }))).toEqual({ ab12: 1700000000000, cd34: -1700000000001 })
    expect(decodeAcks('{"a":1,"b":"x","c":1.5,"d":null}')).toEqual({ a: 1 })
    expect(decodeAcks('not json')).toEqual({})
    expect(decodeAcks('[1,2]')).toEqual({})
    expect(decodeAcks(null)).toEqual({})
  })

  it('takes a remote state and says whether to write back', () => {
    const now = 100 * DAY
    expect(takeRemoteAcks({ a: now - 10 }, { a: now - 20 }, now)).toEqual({ acks: { a: now - 10 }, writeBack: true })
    expect(takeRemoteAcks({ a: now - 30 }, { a: -(now - 20) }, now)).toEqual({ acks: { a: -(now - 20) }, writeBack: false })
    expect(takeRemoteAcks({}, { a: now - 20 }, now)).toEqual({ acks: { a: now - 20 }, writeBack: false })
    // An entry that is too old is dropped; then the state differs from the received one.
    expect(takeRemoteAcks({}, { a: now - KEEP_MS - 1 }, now)).toEqual({ acks: {}, writeBack: true })
  })
})
