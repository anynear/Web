import { describe, expect, it } from 'vitest'
import { EMPTY, KEYS, Sharing, betweenOf, circleLevelFor, decodeSetting, encodeSetting, levelFor, takeSettings, type LocalStore } from '../src/core/sharing'
import { de } from '../src/i18n/de'
import { en } from '../src/i18n/en'

function memory(): LocalStore & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return { map, get: (k) => map.get(k) ?? null, set: (k, v) => (v == null ? map.delete(k) : map.set(k, v)) }
}

function setup() {
  const written = new Map<string, string>()
  const local = memory()
  const s = new Sharing({ write: (n, v) => written.set(n, v) }, local)
  return { s, written, local }
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

describe('Standort freigeben (ADR 0123)', () => {
  it('eine Freigabe gibt mindestens ihre Stufe und lässt beim Beenden nichts zurück', () => {
    const { s } = setup()
    s.setDefault('when')
    expect(levelFor(s.state, 'anna', [], 0)).toBe('when')
    expect(levelFor(s.state, 'anna', [], 0, false, 'exact')).toBe('exact')
    // Ended: the core gives no level any more, and nothing is left to put back.
    expect(levelFor(s.state, 'anna', [], 0, false, null)).toBe('when')
    s.setPaused(true)
    expect(levelFor(s.state, 'anna', [], 0, false, 'exact')).toBe('off')
  })

  it('eine eigene Einstellung für eine Person kann nur weniger zeigen als die Kreise', () => {
    const { s } = setup()
    s.setCircle('familie', 'exact', ['anna'])
    expect(circleLevelFor(s.state, 'anna', ['familie'], 0)).toBe('exact')
    s.setPerson('anna', 'when')
    expect(levelFor(s.state, 'anna', ['familie'], 0)).toBe('when')
  })

  it('was der Browser selbst behielt, geht einmal in den Kern', async () => {
    const { s, local } = setup()
    local.set('location.mutual.agreed.anna', 'exact')
    local.set('location.mutual.before.anna', 'when')
    local.set('location.mutual.open.tom', '1')
    local.set('location.mutual.before.tom', '-')
    s.setPerson('anna', 'exact')
    s.setPerson('tom', 'area')
    const adopted: [string, string | null, string | null][] = []
    await s.migrateMutual(['anna', 'tom', 'ben'], async (id, level, asked) => {
      adopted.push([id, level, asked])
      return true
    })
    expect(adopted).toEqual([
      ['anna', 'exact', null],
      ['tom', null, 'area'],
    ])
    expect(s.state.persons.anna).toBe('when')
    expect(s.state.persons.tom).toBeUndefined()
    await s.migrateMutual(['anna', 'tom'], async () => true)
    expect(adopted.length).toBe(2)
  })

  // The reported bug (21.11.2026): a sharing that holds is shown, and only another level is offered.
  it('„Standort freigeben“ erkennt eine bestehende Freigabe und bietet nur eine andere Stufe an', () => {
    const { s } = setup()
    const b = s.between('anna', [], 'exact', 0, 'exact')
    expect(b.exists).toBe(true)
    expect(b.shared).toBe('exact')
    expect(b.askable).toEqual(['area'])
    const tom = betweenOf('off', 'off', null, 'exact', true)
    expect(tom.exists).toBe(true)
    expect(tom.askable).toEqual(['area'])
    const eva = s.between('eva', [], null, 0)
    expect(eva.exists).toBe(false)
    expect(eva.askable).toEqual(['area', 'exact'])
    expect(eva.suggested).toBe('area')
  })

  it('heißt in beiden Sprachen „Standort freigeben“', () => {
    expect(de.place.mutualStart).toBe('Standort freigeben')
    expect(en.place.mutualStart).toBe('Share location')
    expect(de.place.mutualAnswerNotice.startsWith('Standort freigeben')).toBe(true)
    expect(en.place.mutualAnswerNotice.startsWith('Share location')).toBe(true)
    expect(de.place.mutualTitle('Anna')).toBe('Standort für Anna freigeben')
    for (const t of [de, en]) {
      for (const text of [t.place.mutualStart, t.place.mutualAnswerNotice, t.place.mutualTitle('Anna')]) {
        expect(text).not.toMatch(/gegenseitig teilen|with each other/)
      }
    }
  })
})
