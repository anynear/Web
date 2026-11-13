import { describe, expect, it } from 'vitest'
import { WANT_PAUSE_MS, attachmentHash, mayAsk, shareable, waiting } from './attachmentWants'
import type { Att, Msg } from './messages'

const att = (id: string, hash?: string): Att => ({ id, key: 'k', type: 'jpg', name: '', size: 1, width: 0, height: 0, duration: 0, ...(hash ? { hash } : {}) })
const msg = (id: string, conv: string, attachments: Att[], extra: Partial<Msg> = {}): Msg => ({ id, conv, outgoing: false, text: '', ts: 0, attachments, ...extra })

describe('attachments via their hash (ADR 0014, 0088)', () => {
  const list = [
    msg('1', 'c:kreis', [att('a1', 'h1')]),
    msg('2', 'd:person', [att('a2', 'h1')]),
    msg('3', 'c:kreis', [att('a3', 'h2')], { deleted: true }),
    msg('4', 'c:kreis', [], { link: { url: 'https://example.org', image: att('a4', 'h3') } }),
  ]

  it('gives out only attachments of the asking conversation', () => {
    expect(shareable(list, 'h1', 'c:kreis').map((a) => a.id)).toEqual(['a1'])
    expect(shareable(list, 'h1', 'd:person').map((a) => a.id)).toEqual(['a2'])
    expect(shareable(list, 'h1', 'c:anderer')).toEqual([])
  })

  it('never gives out or fills deleted messages, but link pictures', () => {
    expect(shareable(list, 'h2', 'c:kreis')).toEqual([])
    expect(waiting(list, 'h2')).toEqual([])
    expect(shareable(list, 'h3', 'c:kreis').map((a) => a.id)).toEqual(['a4'])
  })

  it('one have fills every attachment with the hash', () => {
    expect(waiting(list, 'h1').map((a) => a.id)).toEqual(['a1', 'a2'])
  })

  it('asks at most once per pause and hash', () => {
    const asked = new Map<string, number>()
    expect(mayAsk(asked, 'h1', 1_000)).toBe(true)
    expect(mayAsk(asked, 'h1', 2_000)).toBe(false)
    expect(mayAsk(asked, 'h2', 2_000)).toBe(true)
    expect(mayAsk(asked, 'h1', 1_000 + WANT_PAUSE_MS)).toBe(true)
  })

  it('hash: first 16 bytes of SHA-256, b64u', async () => {
    // SHA-256("abc") = ba7816bf 8f01cfea 414140de 5dae2223 …
    expect(await attachmentHash(new TextEncoder().encode('abc'))).toBe('ungWv48Bz-pBQUDeXa4iIw')
  })
})
