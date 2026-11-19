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
  sortOverview,
  quoteOf,
  repliedTo,
  replyOf,
  QUOTE_CHARS,
  peerMoves,
  tabTitle,
  textChars,
  textLeft,
  charsLeftHint,
  limitInput,
} from '../src/core/messages'
import { pickTexts } from '../src/i18n'
import { de } from '../src/i18n/de'
import { en } from '../src/i18n/en'
import { formatStorageSize, formatVoiceDuration, splitLinks } from '../src/ui/format'

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

  it('Zeile nach einer Vorstellung ersetzt im Direktchat nicht die letzte Nachricht (wie in der App)', () => {
    const line = (id: string, ts: number) => out({ id, conv: 'd:isa', ts, outgoing: false, system: true, text: 'Isa would like to add Kevin. Kevin still has to accept.' })
    const s = summarize([out({ id: '1', conv: 'd:isa', ts: 5, text: 'Fünf, halb sechs' }), line('sys|1', 16)])
    expect(s.get('d:isa')?.last).toMatchObject({ id: '1', ts: 5 })
    // Also in the other order, and with nothing else the line stands for the conversation.
    expect(summarize([line('sys|1', 16), out({ id: '1', conv: 'd:isa', ts: 5 })]).get('d:isa')?.last.id).toBe('1')
    expect(summarize([line('sys|1', 16)]).get('d:isa')?.last.id).toBe('sys|1')
    // Lines in circles (joined, left …) stay the last message, as in the app.
    expect(summarize([out({ id: '1', ts: 1 }), out({ id: 'sys|2', ts: 2, system: true })]).get('c:k')?.last.id).toBe('sys|2')
  })
})

describe('Gespräch unter Geräte-ID („Jemand“)', () => {
  // Kevin's own message „Wohoo“ came from another own device while only the device of the contact was known: its
  // `peer` is the device ID. The web app showed it as a conversation of its own with „Someone“, the app moves it.
  const people = new Map([['isa', ['isa-dev-1', 'isa-dev-2']]])
  const personOfDevice = (id: string) => [...people].find(([, devices]) => devices.includes(id))?.[0] ?? id

  it('wandert zur Person, sobald deren Gerät bekannt ist', () => {
    expect(peerMoves(['d:isa-dev-1', 'd:isa', 'c:kreis'], personOfDevice, 'kevin')).toEqual(new Map([['d:isa-dev-1', 'd:isa']]))
  })

  it('bleibt, solange niemand dazu bekannt ist, und nie zur eigenen Person', () => {
    expect(peerMoves(['d:unbekannt'], personOfDevice, 'kevin').size).toBe(0)
    expect(peerMoves(['d:kevin-dev'], (id) => (id === 'kevin-dev' ? 'kevin' : id), 'kevin').size).toBe(0)
  })
})

describe('Sprachnachricht', () => {
  it('Dauer wie in der App', () => {
    expect(formatVoiceDuration(7_400)).toBe('0:07')
    expect(formatVoiceDuration(59_600)).toBe('1:00')
    expect(formatVoiceDuration(0)).toBe('0:00')
  })
})

describe('Tab-Titel', () => {
  it('mit Zahl nur bei neuen Nachrichten', () => {
    expect(tabTitle('anynear', 12)).toBe('(12) anynear')
    expect(tabTitle('anynear', 0)).toBe('anynear')
  })
})

describe('Textgrenze in Zeichen', () => {
  it('zählt Codepoints, nicht Bytes', () => {
    expect(textChars('Grüße')).toBe(5)
    expect(textChars('👍')).toBe(1)
    expect(textChars('ä'.repeat(1000))).toBe(1000)
    expect(new TextEncoder().encode('ä'.repeat(1000)).length).toBe(2000)
    // Joined emoji count each code point; every code point is at most 4 bytes.
    expect(textChars('👨‍👩‍👧')).toBe(5)
    expect(textChars('🇩🇪')).toBe(2)
    expect(new TextEncoder().encode('😀'.repeat(1000)).length).toBe(4000)
    // The limit of 4096 characters stays within 16384 bytes.
    expect(new TextEncoder().encode('😀'.repeat(4096)).length).toBe(16384)
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

describe('Zähler „Noch n Zeichen“ wie in der App', () => {
  const t = { charsLeft: (n: number) => `Noch ${n} Zeichen`, charsTooMany: (n: number) => `${n} Zeichen zu viel` }
  const fits = (s: string) => textLeft(s, 10) >= 0

  it('zählt nach trim() und zeigt den Hinweis erst kurz vor der Grenze', () => {
    expect(textLeft('  Grüße 👍  ', 1000)).toBe(993)
    expect(charsLeftHint(31, 30, t)).toBeNull()
    expect(charsLeftHint(30, 30, t)).toBe('Noch 30 Zeichen')
    expect(charsLeftHint(0, 30, t)).toBe('Noch 0 Zeichen')
    expect(charsLeftHint(-3, 30, t)).toBe('3 Zeichen zu viel')
  })

  it('kürzt nur das neu Eingefügte, auch in der Mitte, ohne ein Emoji zu zerschneiden', () => {
    expect(limitInput('Hallo', 'Hallo Welt!!', fits)).toBe('Hallo Welt')
    expect(limitInput('Hallo Welt', 'Hallo XXWelt', fits)).toBe('Hallo Welt')
    expect(limitInput('123456789', '123456789😀😀', fits)).toBe('123456789😀')
    expect(limitInput('12345678', '1234😀5678', (s) => textLeft(s, 8) >= 0)).toBe('12345678')
    // Deleting is always possible, also above the limit; leading and trailing spaces do not count.
    expect(limitInput('12345678901', '1234567890', fits)).toBe('1234567890')
    expect(limitInput('1234567890', '1234567890   ', fits)).toBe('1234567890   ')
  })
})

describe('sortOverview', () => {
  it('eine Liste nach neuestem Ereignis, dann ohne bekannten Zeitpunkt nach Name, verlassene Kreise unten (wie die App)', () => {
    const rows = sortOverview([
      { name: 'Familie', ts: 10 },
      { name: 'Freunde', ts: 0 },
      { name: 'Chor', ts: 0, since: 25 },
      { name: 'Alter Kreis', ts: 5, removed: true },
      { name: 'Anna', ts: 20, since: 40 },
      { name: 'Ben', ts: 0, since: 30 },
      { name: 'Clara', ts: 0, since: 15 },
      { name: 'Dora', ts: 0, since: 0 },
    ])
    expect(rows.map((r) => r.name)).toEqual(['Anna', 'Ben', 'Chor', 'Clara', 'Familie', 'Dora', 'Freunde', 'Alter Kreis'])
  })
})
