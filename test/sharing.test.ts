import { describe, expect, it } from 'vitest'
import { EMPTY, KEYS, Sharing, decodeSetting, encodeSetting, levelFor, takeSettings, type LocalStore } from '../src/core/sharing'

function memory(): LocalStore & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return { map, get: (k) => map.get(k) ?? null, set: (k, v) => (v == null ? map.delete(k) : map.set(k, v)) }
}

function setup() {
  const written = new Map<string, string>()
  const lowered: [string, number][] = []
  const local = memory()
  const s = new Sharing({ write: (n, v) => written.set(n, v) }, local, (p, w) => lowered.push([p, w]))
  return { s, written, lowered, local }
}

describe('Wer sieht mich (ADR 0121 §27)', () => {
  it('liest die Einstellungen so, wie die App sie schreibt', () => {
    expect(decodeSetting('1exact')).toBe('exact')
    expect(decodeSetting('0')).toBeNull()
    expect(decodeSetting('x')).toBeUndefined()
    expect(encodeSetting(null)).toBe('0')
    const state = takeSettings(
      EMPTY,
      new Map([
        [KEYS.default, '1when'],
        [KEYS.circles, '1' + JSON.stringify({ c1: 'area' })],
        [KEYS.persons, '1' + JSON.stringify({ p1: 'exact', p2: 'neu' })],
        [KEYS.until, '1' + JSON.stringify({ 'p:p1': '100' })],
        [KEYS.paused, '0'],
        [KEYS.approved, '1p1,p3'],
      ]),
    )
    expect(state.default).toBe('when')
    expect(state.circles).toEqual({ c1: 'area' })
    // A level of a newer version is at least „Nur bei SOS“.
    expect(state.persons).toEqual({ p1: 'exact', p2: 'when' })
    expect(state.until).toEqual({ 'p:p1': 100 })
    expect(state.approved).toEqual(['p1', 'p3'])
  })

  it('rechnet wie die App: Person vor Kreis vor allen, Pause, Freigabe für Neue', () => {
    const state = { ...EMPTY, default: 'when' as const, circles: { c1: 'exact' as const }, persons: { p2: 'off' as const }, approved: ['p1'] }
    expect(levelFor(state, 'p1', ['c1'], 0)).toBe('exact')
    // Without the ok a circle shows the place all the time only to those it was meant for.
    expect(levelFor(state, 'p3', ['c1'], 0)).toBe('when')
    expect(levelFor(state, 'p2', ['c1'], 0)).toBe('off')
    expect(levelFor(state, 'p4', [], 0)).toBe('when')
    expect(levelFor({ ...state, paused: true }, 'p1', ['c1'], 0)).toBe('off')
    expect(levelFor({ ...state, paused: true }, 'p1', ['c1'], 0, true)).toBe('exact')
    // An own setting for a time no longer counts afterwards.
    expect(levelFor({ ...state, until: { 'p:p2': 10 } }, 'p2', ['c1'], 20)).toBe('when')
  })

  it('schreibt Änderungen in die Einstellungen der Person', () => {
    const { s, written } = setup()
    s.setDefault('when')
    s.setCircle('c1', 'area', ['p1'])
    s.setPaused(true)
    expect(written.get(KEYS.default)).toBe('1when')
    expect(JSON.parse(written.get(KEYS.circles)!.slice(1))).toEqual({ c1: 'area' })
    expect(written.get(KEYS.approved)).toBe('1p1')
    expect(written.get(KEYS.paused)).toBe('11')
    // The level for everyone itself is no own setting of the circle.
    s.setCircle('c1', 'when')
    expect(written.get(KEYS.circles)).toBe('0')
  })
})

describe('Standort gegenseitig teilen (ADR 0121 §28)', () => {
  it('wer fragt, zeigt zuerst; nach einem Nein gilt wieder, was vorher galt', () => {
    const { s } = setup()
    s.setPerson('p1', 'when')
    s.askMutual('p1', 'exact')
    expect(s.state.persons.p1).toBe('exact')
    expect(s.mutualOpen('p1')).toBe(true)
    s.mutualAnswered('p1', 0)
    expect(s.state.persons.p1).toBe('when')
    expect(s.agreed('p1')).toBeNull()
  })

  it('nach dem Entziehen ohne Freigabe vorher fällt sie auf nichts', () => {
    const { s } = setup()
    s.askMutual('p1', 'area')
    s.mutualAnswered('p1', 0)
    expect(s.state.persons.p1).toBeUndefined()
  })

  it('ein Ja zu weniger senkt auch die eigene Freigabe', () => {
    const { s } = setup()
    s.askMutual('p1', 'exact')
    s.mutualAnswered('p1', 2)
    expect(s.agreed('p1')).toBe('area')
    expect(s.state.persons.p1).toBe('area')
  })

  it('wer unter das Vereinbarte senkt, sagt es der anderen Seite', () => {
    const { s, lowered } = setup()
    s.agreeMutual('p1', 'exact')
    s.setPerson('p1', 'exact')
    expect(lowered).toEqual([])
    s.setPerson('p1', 'area')
    expect(lowered).toEqual([['p1', 2]])
    expect(s.agreed('p1')).toBe('area')
    s.setPerson('p1', 'off')
    expect(lowered).toEqual([
      ['p1', 2],
      ['p1', 0],
    ])
    expect(s.agreed('p1')).toBeNull()
  })

  it('die andere Seite senkt: die eigene folgt, „Weiter zeigen“ holt sie zurück', () => {
    const { s, lowered } = setup()
    s.setPerson('p1', 'when')
    s.agreeMutual('p1', 'exact')
    expect(s.remoteLowered('p1', 2)).toBe(true)
    expect(s.state.persons.p1).toBe('area')
    expect(s.kept('p1')).toBe('exact')
    s.keepShowing('p1')
    expect(s.state.persons.p1).toBe('exact')
    expect(s.kept('p1')).toBeNull()
    // Entzogen: back to before the request, and nothing is sent for it.
    expect(s.remoteLowered('p1', 0)).toBe(true)
    expect(s.state.persons.p1).toBe('when')
    expect(lowered).toEqual([])
    // Without an agreement nothing changes.
    expect(s.remoteLowered('p2', 0)).toBe(false)
  })
})
