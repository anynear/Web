import { describe, expect, it } from 'vitest'
import {
  type Alert,
  type Channel,
  ALARM,
  INFO,
  WARNING,
  activeAlerts,
  alertNotice,
  canEnd,
  channelLinkFromUrl,
  channelRows,
  inRegion,
  looksLikeChannelLink,
  notifiedKey,
  notifyOf,
  priorityOf,
  readNotifySettings,
  rememberNotified,
  replacedIds,
  statusAt,
  unreadCount,
  visibleAlerts,
} from '../src/core/alerts'

const H = 3_600_000

function alert(over: Partial<Alert> = {}): Alert {
  return {
    channelId: 'k',
    id: 'a1',
    ts: 1000,
    prio: INFO,
    title: null,
    text: 'Test',
    url: null,
    until: 1000 + 24 * H,
    replaces: null,
    ended: false,
    source: null,
    area: [],
    attachments: [],
    sender: '',
    endedByOther: false,
    ...over,
  }
}

function channel(over: Partial<Channel> = {}): Channel {
  return { id: 'k', name: 'Haus', owner: true, curated: false, joinedAt: 0, ingress: [], subscribers: [], seenByOwner: false, ...over }
}

describe('Zustand einer Meldung', () => {
  it('aktiv, abgelaufen, entwarnt', () => {
    expect(statusAt(alert(), 2000)).toBe('active')
    expect(statusAt(alert(), 1000 + 24 * H)).toBe('expired')
    expect(statusAt(alert({ ended: true }), 2000)).toBe('ended')
    expect(statusAt(alert({ endedByOther: true }), 2000)).toBe('ended')
  })

  it('Priorität aus dem Paket', () => {
    expect(priorityOf(0)).toBe(INFO)
    expect(priorityOf(2)).toBe(WARNING)
    expect(priorityOf(7)).toBe(ALARM)
  })
})

describe('Gerade aktiv', () => {
  it('ab Warnung, ohne ersetzte und Entwarnungen, Alarme zuerst', () => {
    const list = [
      alert({ id: 'info' }),
      alert({ id: 'warn', prio: WARNING, ts: 3000 }),
      alert({ id: 'alarm', prio: ALARM, ts: 2000 }),
      alert({ id: 'old', prio: ALARM, ts: 1500 }),
      alert({ id: 'clear', prio: ALARM, ts: 4000, ended: true, replaces: 'old' }),
    ]
    expect(activeAlerts(list, 5000).map((a) => a.id)).toEqual(['alarm', 'warn'])
  })
})

describe('Entwarnen', () => {
  const none = new Set<string>()
  it('nur bei aktiven Meldungen eigener Kanäle', () => {
    expect(canEnd(alert({ prio: ALARM }), channel(), none, 2000)).toBe(true)
    expect(canEnd(alert(), channel(), none, 2000)).toBe(true)
    // Arrived via an address for devices: also.
    expect(canEnd(alert({ sender: 'geraet' }), channel(), none, 2000)).toBe(true)
    // Subscribed, official, unknown: no.
    expect(canEnd(alert(), channel({ owner: false }), none, 2000)).toBe(false)
    expect(canEnd(alert(), channel({ owner: false, curated: true }), none, 2000)).toBe(false)
    expect(canEnd(alert(), undefined, none, 2000)).toBe(false)
    // Expired, all-clear already given, itself an all-clear, replaced: no.
    expect(canEnd(alert(), channel(), none, 1000 + 24 * H)).toBe(false)
    expect(canEnd(alert({ endedByOther: true }), channel(), none, 2000)).toBe(false)
    expect(canEnd(alert({ id: 'b', ended: true, replaces: 'a1' }), channel(), none, 2000)).toBe(false)
    expect(canEnd(alert(), channel(), new Set(['a1']), 2000)).toBe(false)
  })

  it('nach der Entwarnung nicht mehr oben und nicht mehr zu entwarnen', () => {
    const list = [alert({ id: 'ende', ts: 3000, ended: true, replaces: 'probe' }), alert({ id: 'probe', prio: ALARM })]
    expect(activeAlerts(list, 5000)).toEqual([])
    expect(canEnd(list[1], channel(), replacedIds(list), 5000)).toBe(false)
  })
})

describe('Kreis für amtliche Warnungen', () => {
  it('Präfixe passen in beide Richtungen, ohne Gebiet überall', () => {
    // Frankfurt am Main: warnings for all of Hesse and for the district match, neighbour district and Bavaria do not.
    expect(inRegion(alert({ area: ['06'] }), '06412')).toBe(true)
    expect(inRegion(alert({ area: ['06412'] }), '06412')).toBe(true)
    expect(inRegion(alert({ area: ['09', '06412'] }), '06412')).toBe(true)
    expect(inRegion(alert({ area: ['06433'] }), '06412')).toBe(false)
    expect(inRegion(alert({ area: ['09162'] }), '06412')).toBe(false)
    expect(inRegion(alert(), '06412')).toBe(true)
  })

  it('ohne Kreis zählt keine amtliche Meldung', () => {
    expect(inRegion(alert({ area: ['06'] }), null)).toBe(false)
    expect(inRegion(alert(), null)).toBe(false)
    const channels = [channel(), channel({ id: 'nina', curated: true, owner: false })]
    const list = [alert({ id: 'own', area: ['09'] }), alert({ id: 'hesse', channelId: 'nina', area: ['06'] }), alert({ id: 'everywhere', channelId: 'nina' })]
    expect(visibleAlerts(list, channels, null).map((a) => a.id)).toEqual(['own'])
  })

  it('filtert nur kuratierte Kanäle', () => {
    const channels = [channel(), channel({ id: 'nina', curated: true, owner: false })]
    const list = [alert({ id: 'own', area: ['09'] }), alert({ id: 'bavaria', channelId: 'nina', area: ['09'] }), alert({ id: 'hesse', channelId: 'nina', area: ['06'] })]
    expect(visibleAlerts(list, channels, '06412').map((a) => a.id)).toEqual(['own', 'hesse'])
  })
})

describe('Kanalliste und Ungelesenes', () => {
  it('neueste Meldung zuerst, ungelesen ab Warnung', () => {
    const channels = [channel({ id: 'a', name: 'Auto' }), channel({ id: 'b', name: 'Büro' }), channel({ id: 'h', name: 'Haus' })]
    const list = [alert({ channelId: 'h', ts: 5000, prio: WARNING }), alert({ id: 'x', channelId: 'b', ts: 3000 })]
    const rows = channelRows(channels, list, { h: 1000 })
    expect(rows.map((r) => r.channel.id)).toEqual(['h', 'b', 'a'])
    expect(rows[0].unread).toBe(1)
    expect(rows[1].unread).toBe(0)
    expect(unreadCount(list, { h: 6000 }, channels)).toBe(0)
  })

  it('zählt keine Meldung aus einem Kanal, der nicht mehr in der Liste steht', () => {
    const list = [alert({ channelId: 'h', ts: 5000, prio: WARNING }), alert({ id: 'gone', channelId: 'old', ts: 5000, prio: WARNING })]
    expect(unreadCount(list, {}, [channel({ id: 'h' })])).toBe(1)
    expect(unreadCount(list, {}, [])).toBe(0)
  })
})

describe('Hinweis im Browser', () => {
  it('jede Priorität meldet sich, nie still; ab Alarm bleibt er stehen, Entwarnung nicht', () => {
    expect(alertNotice(alert({ prio: INFO }), true)).toEqual({ requireInteraction: false })
    expect(alertNotice(alert({ prio: WARNING }), true)).toEqual({ requireInteraction: false })
    expect(alertNotice(alert({ prio: ALARM }), true)).toEqual({ requireInteraction: true })
    expect(alertNotice(alert({ prio: ALARM, ended: true }), true)).toEqual({ requireInteraction: false })
  })

  it('Kanal mit Benachrichtigungen aus meldet nichts', () => {
    for (const prio of [INFO, WARNING, ALARM]) expect(alertNotice(alert({ prio }), false)).toBeNull()
  })

  it('Benachrichtigungen sind ohne Einstellung an', () => {
    expect(notifyOf({}, 'k')).toBe(true)
    expect(notifyOf({ k: false }, 'k')).toBe(false)
    expect(notifyOf({ k: false }, 'j')).toBe(true)
  })

  it('alte Einstellung „Hinweis mit Ton ab“ wird zu Benachrichtigungen an, auch „Nie“', () => {
    expect(readNotifySettings(null, JSON.stringify({ a: 3, b: 1, c: null }))).toEqual({ a: true, b: true, c: true })
    expect(readNotifySettings(null, null)).toEqual({})
    expect(readNotifySettings(null, 'kaputt')).toEqual({})
    expect(readNotifySettings(JSON.stringify({ a: false, b: 'x' }), JSON.stringify({ a: 3 }))).toEqual({ a: false })
  })

  it('eine Meldung meldet nur einmal, auch auf zwei Wegen', () => {
    const key = notifiedKey(alert({ channelId: 'k', id: 'a1' }))
    expect(key).toBe('k/a1')
    const first = rememberNotified([], key)
    expect(first).toEqual(['k/a1'])
    expect(rememberNotified(first!, key)).toBeNull()
    expect(rememberNotified(['x', 'y'], 'z', 2)).toEqual(['y', 'z'])
  })
})

describe('Kanallinks', () => {
  it('Deep Link auf die Webapp wird zum Kanallink', () => {
    expect(channelLinkFromUrl('/a', '#abc_-1')).toBe('https://anynear.app/a#abc_-1')
    expect(channelLinkFromUrl('/a/', '#abc')).toBe('https://anynear.app/a#abc')
    expect(channelLinkFromUrl('/', '#abc')).toBeNull()
    expect(channelLinkFromUrl('/a', '')).toBeNull()
  })

  it('erkennt Kanallinks auch unvollständig', () => {
    expect(looksLikeChannelLink('schau mal https://anynear.net/a#xyz')).toBe(true)
    expect(looksLikeChannelLink('https://anynear.net/a/#')).toBe(true)
    expect(looksLikeChannelLink('https://anynear.app/a#xyz')).toBe(true)
    expect(looksLikeChannelLink('https://anynear.app/k#xyz')).toBe(false)
    expect(looksLikeChannelLink('https://anynear.net/k#xyz')).toBe(false)
    expect(looksLikeChannelLink('https://pyrsa.net/a#xyz')).toBe(false)
  })
})
