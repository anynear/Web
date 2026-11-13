import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Alert } from '../src/core/alerts'

// Notifications of the alerts with a fake core: own alert exactly once, channel off, migration of old settings.

// At runtime channels.ts only needs the state „entwarnt“ from the core.
vi.mock('anmp-core', () => ({ AlertStatus: { ENDED: 'ENDED' } }))

class MemoryStorage {
  private map = new Map<string, string>()
  getItem = (k: string) => this.map.get(k) ?? null
  setItem = (k: string, v: string) => void this.map.set(k, String(v))
  removeItem = (k: string) => void this.map.delete(k)
}

const list = <T>(items: T[]) => ({ asJsReadonlyArrayView: () => items })

function item(over: Record<string, unknown> = {}) {
  return {
    channelId: 'k',
    id: 'a1',
    ts: Date.now() / 1000,
    prio: 1,
    title: 'Probe',
    text: 'Test',
    url: null,
    until: Date.now() / 1000 + 3600,
    replaces: null,
    ended: false,
    source: null,
    area: list([]),
    attachments: list([]),
    sender: '',
    status: null,
    ...over,
  }
}

/** Sent: channel, priority, title, text, link, until, replaces, ended. */
let sent: unknown[][] = []
/** Settings of the person in the fake core (ADR 0050). */
let settings = new Map<string, string>()
/** Alerts in the fake core. */
let coreAlerts: unknown[] = []

function fakeCore() {
  const own = { id: 'k', name: 'Haus', owner: true, curated: false, joinedAt: Date.now() - 3_600_000, ingress: list([]), subscribers: list([]), seenByOwner: false }
  const other = { id: 'f', name: 'Oma', owner: false, curated: false, joinedAt: Date.now() - 3_600_000, ingress: list([]), subscribers: list([]), seenByOwner: false }
  return {
    onAlerts: () => {},
    setting: async (name: string) => settings.get(name) ?? null,
    setSetting: async (name: string, value: string) => void settings.set(name, value),
    channels: () => [own, other],
    alerts: () => coreAlerts,
    sendAlert: async (...args: unknown[]) => {
      sent.push(args)
      const [channelId, prio, title, text, , , replaces, ended] = args
      return item({ id: ended ? 'ende' : 'a1', channelId, prio, title, text, replaces, ended })
    },
  }
}

async function start(storage: MemoryStorage, initial: Record<string, string> = {}) {
  vi.stubGlobal('localStorage', storage)
  vi.resetModules()
  sent = []
  settings = new Map(Object.entries(initial))
  const m = await import('../src/core/channels')
  const shown: { title: string; tag: string; requireInteraction: boolean }[] = []
  m.startChannels(fakeCore() as never, (title, _b, tag, o) => shown.push({ title, tag, requireInteraction: o.requireInteraction }), () => true)
  return { m, shown }
}

describe('Hinweise der Meldungen', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval'] }))
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('eigene Meldung meldet genau einmal, auch wenn sie danach noch ankommt', async () => {
    const { m, shown } = await start(new MemoryStorage())
    expect(await m.sendAlert('k', 1, 'Probe', 'Test', '')).toBe('sent')
    m.onAlert(item() as never)
    expect(shown).toEqual([{ title: expect.stringContaining('Probe'), tag: 'alert:k/a1', requireInteraction: false }])
  })

  it('Alarm bleibt stehen', async () => {
    const { m, shown } = await start(new MemoryStorage())
    m.onAlert(item({ id: 'b2', prio: 3 }) as never)
    expect(shown).toEqual([{ title: expect.any(String), tag: 'alert:k/b2', requireInteraction: true }])
  })

  it('Kanal mit Benachrichtigungen aus meldet nichts, auch keine eigene', async () => {
    const { m, shown } = await start(new MemoryStorage())
    m.setNotify('k', false)
    m.onAlert(item({ id: 'c3', prio: 3 }) as never)
    expect(await m.sendAlert('k', 2, 'Probe', 'Test', '')).toBe('sent')
    expect(shown).toEqual([])
  })

  it('Entwarnung: Info, Titel der Meldung, ersetzt sie und ihren Hinweis, bleibt nicht stehen', async () => {
    const { m, shown } = await start(new MemoryStorage())
    const probe: Alert = {
      channelId: 'k', id: 'probe', ts: Date.now(), prio: 3, title: 'Probe', text: 'Test', url: null, until: Date.now() + 3_600_000,
      replaces: null, ended: false, source: null, area: [], attachments: [], sender: '', endedByOther: false,
    }
    expect(await m.endAlert(probe)).toBe('sent')
    expect(sent).toEqual([['k', 1, 'Probe', expect.any(String), null, 0, 'probe', true]])
    expect(shown).toEqual([{ title: expect.stringContaining('Probe'), tag: 'alert:k/probe', requireInteraction: false }])
    // Subscribed channel: nothing is sent.
    expect(await m.endAlert({ ...probe, channelId: 'f' })).toBe('failed')
    expect(sent).toHaveLength(1)
  })

  it('alte Einstellung „Hinweis mit Ton ab“ wird zu Benachrichtigungen an', async () => {
    const storage = new MemoryStorage()
    storage.setItem('app:web:alerts.loud', JSON.stringify({ k: null }))
    const { m, shown } = await start(storage)
    expect(m.notifyOfChannel('k')).toBe(true)
    expect(storage.getItem('app:web:alerts.loud')).toBeNull()
    expect(JSON.parse(storage.getItem('app:web:alerts.notify')!)).toEqual({ k: true })
    m.onAlert(item({ id: 'd4' }) as never)
    expect(shown).toHaveLength(1)
  })
})

describe('Gesehen (alerts_acked)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    coreAlerts = []
  })

  it('bestätigte verschwinden aus „Gerade aktiv“, die Zahl der ungelesenen bleibt', async () => {
    coreAlerts = [item({ id: 'w', prio: 2 })]
    const { m } = await start(new MemoryStorage())
    expect(m.active.value.map((a) => a.id)).toEqual(['w'])
    const unread = m.unread.value
    m.ackAlert('w')
    expect(m.active.value).toEqual([])
    expect(m.ackedActive.value.map((a) => a.id)).toEqual(['w'])
    expect(m.alerts.value.map((a) => a.id)).toEqual(['w'])
    expect(m.unread.value).toBe(unread)
    m.unackAlert('w')
    expect(m.active.value.map((a) => a.id)).toEqual(['w'])
  })

  it('bestätigt und blendet wieder ein, auch in den Einstellungen der Person', async () => {
    const { m } = await start(new MemoryStorage())
    await Promise.resolve()
    m.ackAlert('a1')
    expect(m.acks.value.a1).toBeGreaterThan(0)
    expect(JSON.parse(settings.get('alerts_acked')!).a1).toBeGreaterThan(0)
    m.unackAlert('a1')
    expect(m.acks.value.a1).toBeLessThan(0)
    expect(JSON.parse(settings.get('alerts_acked')!).a1).toBeLessThan(0)
  })

  it('übernimmt beim Start den Stand der Person und schreibt einen abweichenden zurück', async () => {
    const t = Date.now()
    const storage = new MemoryStorage()
    storage.setItem('app:web:alerts.acked', JSON.stringify({ hier: t - 1000 }))
    const { m } = await start(storage, { alerts_acked: JSON.stringify({ dort: t - 2000 }) })
    await vi.waitFor(() => expect(m.acks.value).toEqual({ hier: t - 1000, dort: t - 2000 }))
    expect(JSON.parse(settings.get('alerts_acked')!)).toEqual({ hier: t - 1000, dort: t - 2000 })
  })

  it('führt einen Stand von einem anderen Gerät je ID zusammen', async () => {
    const t = Date.now()
    const { m } = await start(new MemoryStorage())
    await Promise.resolve()
    m.ackAlert('x')
    const mine = m.acks.value.x
    m.onSettings(new Map([['alerts_acked', new TextEncoder().encode(JSON.stringify({ x: -(mine + 5), y: t }))]]))
    expect(m.acks.value).toEqual({ x: -(mine + 5), y: t })
  })
})

