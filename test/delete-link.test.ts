import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { openMessageDb } from '../src/core/db'
import {
  type Msg,
  DELETE_FOR_ALL_MS,
  PENDING_DELETE_MS,
  applyDelete,
  applyPending,
  canDeleteForAll,
  chatMatches,
  expiredPending,
  isSystemCard,
  pendingDelete,
  shownLink,
  summarize,
} from '../src/core/messages'

const NOW = 1_800_000_000_000
const tagOf = (m: Msg) => (m.fromDevice ? `T-${m.fromDevice}` : null)

function msg(over: Partial<Msg> = {}): Msg {
  return {
    id: 'DEV|M1',
    conv: 'c:k',
    mid: 'M1',
    outgoing: false,
    fromDevice: 'DEV',
    fromPerson: 'P',
    fromName: 'Beispiel',
    text: 'Hallo',
    ts: NOW - 1000,
    attachments: [{ id: 'A', key: 'K', type: 'jpg', name: '', size: 1, width: 1, height: 1, duration: 0 }],
    reactions: { self: { emoji: '👍', ts: 1 } },
    unread: true,
    ...over,
  }
}

describe('Löschen für alle', () => {
  it('leert Text, Anhänge, Reaktionen und Vorschau, behält Absender, Zeit und ID', () => {
    const m = msg({ link: { url: 'https://example.org', title: 'T' } })
    const d = applyDelete([m], 'c:k', 'T-DEV', 'M1', tagOf)!
    expect(d).toMatchObject({ id: 'DEV|M1', mid: 'M1', fromPerson: 'P', ts: m.ts, text: '', attachments: [], deleted: true, unread: false })
    expect(d.reactions).toBeUndefined()
    expect(d.link).toBeUndefined()
  })

  it('trifft nur dieselbe Nachricht im selben Gespräch vom selben Verfasser', () => {
    const m = msg()
    expect(applyDelete([m], 'c:anders', 'T-DEV', 'M1', tagOf)).toBeNull()
    expect(applyDelete([m], 'c:k', 'T-FREMD', 'M1', tagOf)).toBeNull()
    expect(applyDelete([m], 'c:k', 'T-DEV', 'M2', tagOf)).toBeNull()
    expect(applyDelete([msg({ system: true })], 'c:k', 'T-DEV', 'M1', tagOf)).toBeNull()
  })

  it('eigene Nachricht aus dem Verlauf ohne Gerät: die Nachrichten-ID reicht', () => {
    const m = msg({ fromDevice: undefined, outgoing: true, id: 'M1' })
    expect(applyDelete([m], 'c:k', 'T-IRGENDWAS', 'M1', tagOf)?.deleted).toBe(true)
  })

  it('ältere gespeicherte Einträge ohne Feld gelten als nicht gelöscht', () => {
    const old = msg()
    delete (old as Partial<Msg>).deleted
    expect(chatMatches([old], 'hallo')).toHaveLength(1)
    expect(summarize([old]).get('c:k')?.unread).toBe(1)
  })

  it('gelöschte Nachrichten findet die Suche nicht und sie zählen nicht als neu', () => {
    const d = applyDelete([msg()], 'c:k', 'T-DEV', 'M1', tagOf)!
    expect(chatMatches([{ ...d, text: 'Hallo' }], 'hallo')).toEqual([])
    expect(summarize([d]).get('c:k')?.unread).toBe(0)
  })

  it('für alle nur bei eigenen, gesendeten Nachrichten bis 48 Stunden', () => {
    const own = msg({ outgoing: true, status: 'sent', ts: NOW - DELETE_FOR_ALL_MS + 1 })
    expect(canDeleteForAll(own, NOW)).toBe(true)
    expect(canDeleteForAll({ ...own, ts: NOW - DELETE_FOR_ALL_MS - 1 }, NOW)).toBe(false)
    expect(canDeleteForAll({ ...own, outgoing: false }, NOW)).toBe(false)
    expect(canDeleteForAll({ ...own, status: 'failed' }, NOW)).toBe(false)
    expect(canDeleteForAll({ ...own, mid: undefined }, NOW)).toBe(false)
  })
})

describe('Löschen vor der Nachricht', () => {
  it('wird 30 Tage gemerkt und beim Eintreffen angewandt', () => {
    const p = pendingDelete('c:k', 'T-DEV', 'M1', NOW)
    const { list, used } = applyPending([msg(), msg({ id: 'DEV|M2', mid: 'M2' })], [p], tagOf, NOW + 1000)
    expect(list[0].deleted).toBe(true)
    expect(list[0].text).toBe('')
    expect(list[1].deleted).toBeUndefined()
    expect(used).toEqual([p.id])
  })

  it('nach 30 Tagen nicht mehr', () => {
    const p = pendingDelete('c:k', 'T-DEV', 'M1', NOW)
    expect(applyPending([msg()], [p], tagOf, NOW + PENDING_DELETE_MS).used).toEqual([])
    expect(expiredPending([p], NOW + PENDING_DELETE_MS)).toEqual([p.id])
    expect(expiredPending([p], NOW)).toEqual([])
  })

  it('liegt in IndexedDB', async () => {
    const db = await openMessageDb(new IDBFactory())
    const p = pendingDelete('d:P', 'T', 'M', NOW)
    await db.putPendingDelete(p)
    expect(await db.pendingDeletes()).toEqual([p])
    await db.removePendingDeletes([p.id])
    expect(await db.pendingDeletes()).toEqual([])
  })
})

describe('Vorschau für Links', () => {
  const link = { url: 'https://www.example.org/artikel', title: 'Titel', description: 'Kurz', site: 'Andere Seite' }

  it('nur, wenn die Adresse im Text steht, mit dem Namen aus der Adresse', () => {
    expect(shownLink(msg({ text: 'Schau: https://www.example.org/artikel', link }))).toMatchObject({ title: 'Titel', host: 'example.org' })
    expect(shownLink(msg({ text: 'Schau mal', link }))).toBeNull()
  })

  it('keine Karte ohne https, für gelöschte Nachrichten oder ohne Inhalt', () => {
    const http = { ...link, url: 'http://example.org/a' }
    expect(shownLink(msg({ text: http.url, link: http }))).toBeNull()
    expect(shownLink(msg({ text: link.url, link, deleted: true }))).toBeNull()
    expect(shownLink(msg({ text: link.url, link: { url: link.url } }))).toBeNull()
  })

  it('anynear-Einladungen behalten ihre eigene Karte', () => {
    const invite = { url: 'https://anynear.app/k#abc', title: 'Kreis' }
    expect(shownLink(msg({ text: invite.url, link: invite }))).toBeNull()
  })
})

describe('Systemkarten', () => {
  const own = { outgoing: true, status: 'sent' as const, ts: NOW - 1000 }
  it('lassen sich nicht für alle löschen', () => {
    expect(canDeleteForAll(msg({ ...own, spot: { kind: 1, latitude: 50, longitude: 8 } } as Partial<Msg>), NOW)).toBe(false)
    expect(canDeleteForAll(msg({ ...own, intro: { id: 'I', person: 'Q', name: 'B', byPerson: 'P', until: NOW + 1, card: '' } } as Partial<Msg>), NOW)).toBe(false)
    expect(canDeleteForAll(msg(own), NOW)).toBe(true)
  })
  it('bleiben, auch wenn eine ältere App sie für alle löscht', () => {
    const card = msg({ spot: { kind: 3, latitude: 50, longitude: 8 } } as Partial<Msg>)
    expect(applyDelete([card], 'c:k', 'T-DEV', 'M1', tagOf)).toBeNull()
    expect(isSystemCard(card)).toBe(true)
    expect(isSystemCard(msg())).toBe(false)
  })
})
