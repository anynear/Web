import { describe, expect, it } from 'vitest'
import { ALARM, ASK, MAX_QUIET, MIN_QUIET, REASON_MISSED, RUNNING, type LifeSign, accuracyText, alarmNotice, askNotice, choices, mapLink, nextLocalHour, preselect, request } from '../src/core/lifesigns'

// Check-ins (ADR 0083 §5), like LifeSignsTest in the app: templates and the question „Alles gut?“.
const MIN = 60_000
const t0 = new Date(2026, 10, 11, 13, 0).getTime()

function sign(over: Partial<LifeSign> = {}): LifeSign {
  return {
    id: 'p1', circleId: 'c1', owner: 'me', label: 'Allein arbeiten', start: t0, until: t0 + 8 * 60 * MIN, due: t0 + 20 * MIN,
    lastAt: t0, confirmedAt: t0, state: 1, battery: null, own: true, phase: RUNNING, reason: 0, looking: [], away: [], heard: [],
    notArriving: false, place: null, ...over,
  }
}

describe('lifesigns', () => {
  it('templates set the same values as the app', () => {
    expect(request('work', t0)).toMatchObject({ until: t0 + 8 * 60 * MIN, quiet: 20 * MIN, firstDue: 0, singleQuestion: false })
    expect(request('outside', t0)).toMatchObject({ until: t0 + 2 * 60 * MIN, quiet: 30 * MIN })
    const home = request('home', t0)
    expect(home.singleQuestion).toBe(true)
    expect(new Date(home.firstDue).getHours()).toBe(7)
    expect(home.until).toBeGreaterThan(home.firstDue)
    const daily = request('daily', t0)
    expect(daily.quiet).toBe(MAX_QUIET)
    expect(new Date(daily.firstDue).getHours()).toBe(10)
    expect(request('custom', t0, 3, 5).quiet).toBe(MIN_QUIET)
  })

  it('next local hour is tomorrow when today is too close', () => {
    expect(nextLocalHour(new Date(2026, 10, 11, 6, 50).getTime(), 7, MIN_QUIET)).toBe(new Date(2026, 10, 12, 7, 0).getTime())
    expect(nextLocalHour(new Date(2026, 10, 11, 6, 0).getTime(), 7, MIN_QUIET)).toBe(new Date(2026, 10, 11, 7, 0).getTime())
  })

  it('asks at the due time and once more after two minutes', () => {
    const s = sign({ phase: ASK })
    const first = askNotice(s, '', s.due)
    expect(first?.key).toBe(`ask:${s.due}`)
    expect(askNotice(s, first!.key, s.due + MIN)).toBeNull()
    expect(askNotice(s, first!.key, s.due + 2 * MIN)?.key).toBe(`ask2:${s.due}`)
    expect(askNotice(sign(), '', s.due)).toBeNull()
    expect(askNotice(sign({ own: false, phase: ASK }), '', s.due)).toBeNull()
  })

  // ADR 0121 §10, as formatAccuracy in the app: a place never looks more exact than it is.
  it('rounds the accuracy of a place and links to it on a map', () => {
    expect(accuracyText(3)).toBe('10 m')
    expect(accuracyText(12)).toBe('10 m')
    expect(accuracyText(247)).toBe('250 m')
    expect(accuracyText(999)).toBe('1000 m')
    expect(accuracyText(1000)).toBe('1 km')
    expect(accuracyText(2600)).toBe('3 km')
    expect(mapLink({ latitude: 50.1106, longitude: 8.6821, at: t0, accuracy: 12 })).toBe(
      'https://www.openstreetmap.org/?mlat=50.11060&mlon=8.68210#map=16/50.11060/8.68210',
    )
    expect(mapLink({ latitude: -33.8568, longitude: -151.2153, at: t0, accuracy: null })).toContain('mlat=-33.85680&mlon=-151.21530')
  })

  // ADR 0083 §5.7, as LifeSignsTest in the app: a phone that went silent is reported with the place it left at the relays.
  it('names the place in the alarm, also when the phone is not reachable', () => {
    const place = { latitude: 50.1106, longitude: 8.6821, at: t0 + 2 * MIN, accuracy: 12 }
    const silent = sign({ own: false, owner: 'anna', phase: ALARM, reason: 2 }) // 2: nothing came any more (AliveStatus.REASON_UNREACHABLE)
    const bare = alarmNotice(silent, 'Anna', t0 + 31 * MIN)
    expect(bare.title).toContain('Anna')
    const withPlace = alarmNotice({ ...silent, place }, 'Anna', t0 + 31 * MIN)
    expect(withPlace.title).toBe(bare.title)
    expect(withPlace.body.startsWith(bare.body)).toBe(true)
    expect(withPlace.body.length).toBeGreaterThan(bare.body.length)
    const missed = alarmNotice({ ...silent, reason: REASON_MISSED, place }, 'Anna', t0 + 31 * MIN)
    expect(missed.title).not.toBe(bare.title)
    expect(missed.body.endsWith(withPlace.body.slice(bare.body.length))).toBe(true)
  })
})

describe('lifesigns circles', () => {
  const c = (id: string, removed = false) => ({ id, removed })
  it('support circles are no choice, circles without known helpers are', () => {
    const list = choices([c('support'), c('fresh'), c('anna'), c('gone', true)], (id) => id === 'support')
    expect(list.map((x) => x.id)).toEqual(['fresh', 'anna'])
    expect(preselect(list, (id) => (id === 'anna' ? 1 : 0), null)).toBe('anna')
    expect(preselect(list, () => 0, 'fresh')).toBe('fresh')
    expect(preselect([], () => 0, null)).toBeNull()
  })
})
