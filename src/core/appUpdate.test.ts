import { describe, expect, it } from 'vitest'
import { RELOAD_PAUSE, decideUpdate, nextDay, updateState, type UpdateInput, type UpdateKind } from './appUpdate'

const NOW = new Date(2026, 10, 13, 15, 30).getTime()

function input(kind: UpdateKind, over: Partial<UpdateInput> = {}): UpdateInput {
  return { update: { kind, from: kind === 'soon' || kind === 'required' ? NOW + 1000 : 0 }, clientsMin: false, now: NOW, lastReload: null, soonLaterUntil: 0, ...over }
}

describe('decideUpdate', () => {
  it('nothing without a rule', () => {
    expect(decideUpdate(input('none'))).toEqual({ banner: 'none', reload: false })
  })

  it('the notice with date never reloads', () => {
    expect(decideUpdate(input('soon'))).toEqual({ banner: 'soon', reload: false })
    expect(decideUpdate(input('soon', { lastReload: NOW - RELOAD_PAUSE }))).toEqual({ banner: 'soon', reload: false })
  })

  it('required reloads once, not again within the hour', () => {
    expect(decideUpdate(input('required'))).toEqual({ banner: 'outdated', reload: true })
    expect(decideUpdate(input('required', { lastReload: NOW - 5_000 }))).toEqual({ banner: 'outdated', reload: false })
    expect(decideUpdate(input('required', { lastReload: NOW - RELOAD_PAUSE + 1 }))).toEqual({ banner: 'outdated', reload: false })
  })

  it('required may reload again after the pause, and with a clock set back', () => {
    expect(decideUpdate(input('required', { lastReload: NOW - RELOAD_PAUSE }))).toEqual({ banner: 'outdated', reload: true })
    expect(decideUpdate(input('required', { lastReload: NOW + 60_000 }))).toEqual({ banner: 'outdated', reload: true })
  })

  it('„Später“ does not hide required or clients.min', () => {
    expect(decideUpdate(input('required', { lastReload: NOW, soonLaterUntil: NOW + 1 })).banner).toBe('outdated')
    expect(decideUpdate(input('soon', { clientsMin: true, soonLaterUntil: NOW + 1 })).banner).toBe('outdated')
  })

  it('clients.min comes before the notice with date, required still reloads', () => {
    expect(decideUpdate(input('none', { clientsMin: true }))).toEqual({ banner: 'outdated', reload: false })
    expect(decideUpdate(input('soon', { clientsMin: true }))).toEqual({ banner: 'outdated', reload: false })
    expect(decideUpdate(input('required', { clientsMin: true }))).toEqual({ banner: 'outdated', reload: true })
  })

  it('„Später“ hides the notice with date until the next day', () => {
    const until = nextDay(NOW)
    expect(decideUpdate(input('soon', { soonLaterUntil: until })).banner).toBe('none')
    expect(decideUpdate(input('soon', { soonLaterUntil: until, now: until })).banner).toBe('soon')
    expect(decideUpdate(input('none', { soonLaterUntil: until })).banner).toBe('none')
  })
})

describe('nextDay', () => {
  it('is the next midnight in local time', () => {
    expect(nextDay(NOW)).toBe(new Date(2026, 10, 14).getTime())
    expect(nextDay(new Date(2026, 10, 13).getTime())).toBe(new Date(2026, 10, 14).getTime())
  })
})

describe('updateState', () => {
  it('takes known kinds, anything else is none', () => {
    expect(updateState({ kind: 'soon', from: 5 })).toEqual({ kind: 'soon', from: 5 })
    expect(updateState({ kind: 'required', from: 7 })).toEqual({ kind: 'required', from: 7 })
    expect(updateState({ kind: 'later', from: 7 })).toEqual({ kind: 'none', from: 0 })
    expect(updateState({ kind: 'hint', from: 0 })).toEqual({ kind: 'none', from: 0 })
    expect(updateState(null)).toEqual({ kind: 'none', from: 0 })
  })
})
