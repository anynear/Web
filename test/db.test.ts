import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { deleteMessageDb, openMessageDb } from '../src/core/db'
import type { Msg } from '../src/core/messages'

const m = (id: string, ts: number): Msg => ({ id, conv: 'c:k', outgoing: false, text: id, ts, attachments: [] })

describe('Nachrichten in IndexedDB', () => {
  it('speichert, ersetzt, entfernt und löscht', async () => {
    const factory = new IDBFactory()
    const db = await openMessageDb(factory)
    await db.put([m('a', 1), m('b', 2)])
    await db.put([{ ...m('a', 1), text: 'neu' }])
    expect((await db.all()).map((x) => x.text).sort()).toEqual(['b', 'neu'])
    await db.remove(['b'])
    expect((await db.all()).map((x) => x.id)).toEqual(['a'])
    await db.clear()
    expect(await db.all()).toEqual([])
    await deleteMessageDb(factory)
  })

  it('behält die Dateien des Kerns über das Neuladen', async () => {
    const factory = new IDBFactory()
    const first = await openMessageDb(factory)
    await first.core.write('core/alerts', new Int8Array([1, -2, 3]))
    const again = await openMessageDb(factory)
    expect(Array.from((await again.core.read('core/alerts'))!)).toEqual([1, -2, 3])
    expect(await again.core.read('fehlt')).toBeNull()
    await again.core.delete('core/alerts')
    expect(await again.core.read('core/alerts')).toBeNull()
  })
})
