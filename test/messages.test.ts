import { describe, expect, it } from 'vitest'
import {
  type Msg,
  applyReaction,
  applyReceipt,
  parkReceipts,
  withEarlyReceipts,
  b64u,
  fromB64u,
  newMid,
  ownHistoryOf,
  reactionSummary,
  shownStatus,
  summarize,
  listedConversations,
  quoteOf,
  repliedTo,
  replyOf,
  QUOTE_CHARS,
} from '../src/core/messages'
import { pickTexts } from '../src/i18n'
import { de } from '../src/i18n/de'
import { en } from '../src/i18n/en'
import { formatStorageSize, splitLinks } from '../src/ui/format'

function out(over: Partial<Msg> = {}): Msg {
  return { id: 'm1', conv: 'c:k', mid: 'm1', outgoing: true, text: 'Hallo', ts: 1, status: 'sent', attachments: [], ...over }
}

describe('Zustand eigener Nachrichten', () => {
  it('direkt: gesendet, angekommen, gelesen', () => {
    const m = out({ conv: 'd:p', recipients: ['p'] })
    expect(shownStatus(m, false).kind).toBe('sent')
    const [arrived] = applyReceipt([m], 'p', ['m1'], false)
    expect(shownStatus(arrived, false).kind).toBe('arrived')
    const [read] = applyReceipt([arrived], 'p', ['m1'], true)
    expect(shownStatus(read, false).kind).toBe('read')
  })

  it('im Kreis: „Von 1 von 2 gelesen“, dann von allen', () => {
    const m = out({ recipients: ['a', 'b'] })
    const [one] = applyReceipt([m], 'a', ['m1'], true)
    expect(shownStatus(one, true)).toEqual({ kind: 'readSome', n: 1, total: 2 })
    const [all] = applyReceipt([one], 'b', ['m1'], true)
    expect(shownStatus(all, true).kind).toBe('readAll')
  })

  it('wer erst später dazukam, zählt nicht mit', () => {
    const m = out({ recipients: ['a'] })
    const [late] = applyReceipt([m], 'z', ['m1'], true)
    expect(shownStatus(late, true).kind).toBe('arrived')
  })

  it('eine Bestätigung beendet „Wird gesendet“', () => {
    const [m] = applyReceipt([out({ status: 'sending', recipients: ['a'] })], 'a', ['m1'], false)
    expect(m.status).toBe('sent')
  })

  it('doppelte Bestätigung ändert nichts', () => {
    const [m] = applyReceipt([out({ recipients: ['a'] })], 'a', ['m1'], true)
    expect(applyReceipt([m], 'a', ['m1'], true)).toEqual([])
  })

  it('fremde Nachrichten bleiben unberührt', () => {
    expect(applyReceipt([out({ outgoing: false })], 'a', ['m1'], true)).toEqual([])
  })
})

describe('Reaktionen', () => {
  it('die neueste gilt, zurücknehmen mit leerem Emoji', () => {
    let m = out()
    m = applyReaction(m, 'a', '👍', 10)!
    expect(applyReaction(m, 'a', '❤️', 5)).toBeNull()
    m = applyReaction(m, 'self', '👍', 11)!
    expect(reactionSummary(m)).toEqual([{ emoji: '👍', count: 2, mine: true }])
    m = applyReaction(m, 'a', '', 12)!
    expect(reactionSummary(m)).toEqual([{ emoji: '👍', count: 1, mine: true }])
  })
})

describe('Eigener Verlauf für den Kern (ADR 0107)', () => {
  it('direkte Nachrichten: eigene ohne, fremde mit Verfasser; Kreise, Systemzeilen, gelöschte und ohne ID nicht', () => {
    const list: Msg[] = [
      out({ id: 'a', conv: 'd:BEN', mid: 'A', text: 'Hallo', replyTo: 'X', replyFrom: 'T' }),
      out({ id: 'b', conv: 'd:BEN', mid: 'B', outgoing: false, fromDevice: 'BENDEV', text: 'Hi' }),
      out({ id: 'c', conv: 'c:k', mid: 'C' }),
      out({ id: 'd', conv: 'd:BEN', mid: 'D', system: true }),
      out({ id: 'e', conv: 'd:BEN', mid: 'E', deleted: true }),
      out({ id: 'f', conv: 'd:BEN', mid: undefined }),
      out({ id: 'g', conv: 'd:BEN', mid: 'G', outgoing: false }),
    ]
    const items = ownHistoryOf(list)
    expect(items.map((i) => i.mid)).toEqual(['A', 'B'])
    expect(items[0]).toMatchObject({ peer: 'BEN', author: null, replyTo: 'X', replyFrom: 'T' })
    expect(items[1]).toMatchObject({ peer: 'BEN', author: 'BENDEV', replyTo: null })
  })
})

describe('Übersicht', () => {
  it('letzte Nachricht und ungelesene je Gespräch', () => {
    const s = summarize([
      out({ id: '1', ts: 1 }),
      out({ id: '2', ts: 3, outgoing: false, unread: true }),
      out({ id: '3', ts: 2, outgoing: false, unread: true }),
      out({ id: '4', conv: 'd:p', ts: 5 }),
    ])
    expect(s.get('c:k')).toMatchObject({ unread: 2, last: { id: '2' } })
    expect(s.get('d:p')?.unread).toBe(0)
  })
})

describe('Hilfen', () => {
  it('b64u hin und zurück, Nachrichten-ID mit 8 Byte', () => {
    const bytes = new Uint8Array([0, 255, 250, 1, 2, 3, 4, 5, 6])
    expect(Array.from(new Uint8Array(fromB64u(b64u(bytes)).buffer))).toEqual(Array.from(bytes))
    expect(fromB64u(newMid())).toHaveLength(8)
  })

  it('Links im Text', () => {
    expect(splitLinks('Siehe https://anynear.app/app/. Danke')).toEqual([
      { text: 'Siehe ' },
      { text: 'https://anynear.app/app/', href: 'https://anynear.app/app/' },
      { text: '. Danke' },
    ])
  })
})

describe('Sprachen', () => {
  it('Deutsch bei de*, sonst Englisch', () => {
    expect(pickTexts(['de-AT'])).toBe(de)
    expect(pickTexts(['fr-FR', 'de'])).toBe(en)
  })

  it('beide Kataloge haben dieselben Schlüssel', () => {
    const keys = (o: object, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]))
    expect(keys(en).sort()).toEqual(keys(de).sort())
    expect(en.pairing.steps).toHaveLength(de.pairing.steps.length)
  })
})

describe('Bestätigung vor der eigenen Kopie', () => {
  it('wird gemerkt und nachgeholt, sobald die Kopie da ist', () => {
    // The copy from another own device (ADR 0042) arrives after the receipts from a and b.
    let parked = parkReceipts([], [], 'a', ['m1'], false)
    parked = parkReceipts(parked, [], 'b', ['m1', 'm2'], true)
    expect(parked).toHaveLength(3)
    const { list, rest } = withEarlyReceipts([out({ recipients: ['a', 'b'] })], parked)
    expect(list[0].arrivedBy).toEqual(['a', 'b'])
    expect(list[0].readBy).toEqual(['b'])
    expect(rest).toEqual([{ mid: 'm2', person: 'b', read: true }])
  })

  it('merkt nichts für Nachrichten, die schon da sind, und bleibt begrenzt', () => {
    expect(parkReceipts([], [out()], 'a', ['m1'], false)).toEqual([])
    const many = Array.from({ length: 600 }, (_, i) => `x${i}`)
    const parked = parkReceipts([], [], 'a', many, false)
    expect(parked).toHaveLength(500)
    expect(parked[0].mid).toBe('x100')
  })
})

describe('formatStorageSize', () => {
  it('zeigt Kontingente unter 1 GB in ganzen MB', () => {
    expect(formatStorageSize(250 * 1024 * 1024)).toBe('250 MB')
  })
})

describe('listedConversations', () => {
  it('zeigt Kreise, Kontakte und alle, die geschrieben haben, ohne eigene Person und Support', () => {
    const keys = listedConversations(
      [{ id: 'k1' }, { id: 'left', removed: true }, { id: 'leftWithMsgs', removed: true }],
      ['p1'],
      ['c:leftWithMsgs', 'd:p2', 'd:me', 'd:support', 'c:unknown'],
      'me',
      'support',
    )
    expect(keys.sort()).toEqual(['c:k1', 'c:leftWithMsgs', 'd:p1', 'd:p2'])
  })
})

describe('Antworten (ADR 0092)', () => {
  const tagOf = (m: Msg) => (m.fromDevice ? `T-${m.fromDevice}` : null)
  const inc = (over: Partial<Msg> = {}): Msg => ({
    id: 'DEV|MID', conv: 'c:k', mid: 'MID', outgoing: false, fromDevice: 'DEV', fromPerson: 'P', fromName: 'Alex', text: 'Treffen wir uns um 6?', ts: 1, attachments: [], ...over,
  })
  const answer = (over: Partial<Msg> = {}) => out({ id: 'A', mid: 'A', ts: 2, text: 'Ja', replyTo: 'MID', replyFrom: 'T-DEV', ...over })

  it('Verweis nur als Paar', () => {
    expect(replyOf('MID', 'TAG')).toEqual({ replyTo: 'MID', replyFrom: 'TAG' })
    expect(replyOf('MID', null)).toEqual({})
    expect(replyOf(undefined, 'TAG')).toEqual({})
    expect(replyOf('', '')).toEqual({})
  })

  it('findet das Original im selben Gespräch über ID und Autor', () => {
    const original = inc()
    const list = [original, inc({ id: 'X|MID', conv: 'c:other' }), answer()]
    expect(repliedTo(list, answer(), tagOf)).toBe(original)
  })

  it('anderer Autor mit gleicher ID trifft nicht', () => {
    const list = [inc({ id: 'OTHER|MID', fromDevice: 'OTHER' }), answer()]
    expect(repliedTo(list, answer(), tagOf)).toBeNull()
  })

  it('eigene Nachricht aus dem Verlauf ohne Gerät: die ID genügt', () => {
    const own = out({ id: 'MID', mid: 'MID', fromDevice: undefined, history: true, text: 'Bin unterwegs' })
    const a = answer({ outgoing: false, id: 'DEV|A', fromDevice: 'DEV', replyFrom: 'T-ME' })
    expect(repliedTo([own, a], a, tagOf)).toBe(own)
  })

  it('ohne Verweis, Original fehlt oder Kreiszeile: nichts', () => {
    expect(repliedTo([inc()], out({ id: 'A', mid: 'A' }), tagOf)).toBeNull()
    expect(repliedTo([answer()], answer(), tagOf)).toBeNull()
    expect(repliedTo([inc({ system: true, fromDevice: undefined })], answer(), tagOf)).toBeNull()
  })

  it('Zitat: Text in einer Zeile, gekürzt', () => {
    expect(quoteOf(inc({ text: 'Zeile eins\n  Zeile zwei ' }))).toMatchObject({ kind: 'text', text: 'Zeile eins Zeile zwei', outgoing: false, fromName: 'Alex' })
    const long = quoteOf(inc({ text: 'x'.repeat(500) }))
    expect(long.kind === 'text' && long.text.length).toBe(QUOTE_CHARS)
    expect(long.kind === 'text' && long.text.endsWith('…')).toBe(true)
  })

  it('Zitat: nur Anhang, gelöscht, nicht da', () => {
    const att = (type: string) => ({ id: 'B', key: 'K', type, name: '', size: 1, width: 0, height: 0, duration: 0 })
    expect(quoteOf(inc({ text: '', attachments: [att('jpg')] }))).toMatchObject({ kind: 'attachment', type: 'photo' })
    expect(quoteOf(inc({ text: '', attachments: [att('m4a')] }))).toMatchObject({ kind: 'attachment', type: 'voice' })
    expect(quoteOf(inc({ text: '', attachments: [att('pdf')] }))).toMatchObject({ kind: 'attachment', type: 'document' })
    expect(quoteOf(inc({ text: '', attachments: [att('zip')] }))).toMatchObject({ kind: 'attachment', type: 'file' })
    expect(quoteOf(inc({ text: '', deleted: true }))).toMatchObject({ kind: 'deleted', outgoing: false })
    expect(quoteOf(null)).toEqual({ kind: 'missing' })
  })
})
