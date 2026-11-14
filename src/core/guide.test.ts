import { describe, expect, it } from 'vitest'
import { notificationsOpen, offerGuide, planGuide } from './guide'

describe('notificationsOpen', () => {
  it('bleibt offen, solange die Webapp sie nicht eingeschaltet hat, auch wenn der Browser schon erlaubt', () => {
    expect(notificationsOpen(true, 'default', false)).toBe(true)
    expect(notificationsOpen(true, 'granted', false)).toBe(true)
  })

  it('entfällt, wenn eingeschaltet, blockiert oder nicht möglich', () => {
    expect(notificationsOpen(true, 'granted', true)).toBe(false)
    expect(notificationsOpen(true, 'denied', false)).toBe(false)
    expect(notificationsOpen(false, 'default', false)).toBe(false)
  })
})

describe('offerGuide', () => {
  it('bietet die Schritte gekoppelten Browsern einmal an, wenn etwas offen ist', () => {
    expect(offerGuide(true, false, true)).toBe(true)
  })

  it('nicht ungekoppelt, nicht ein zweites Mal und nicht ohne offenen Schritt', () => {
    expect(offerGuide(false, false, true)).toBe(false)
    expect(offerGuide(true, true, true)).toBe(false)
    expect(offerGuide(true, false, false)).toBe(false)
  })
})

describe('planGuide (ADR 0073 §9)', () => {
  it('fragt nach Benachrichtigungen und Warnungen, solange beides offen ist', () => {
    expect(planGuide(true, true, false)).toEqual(['notifications', 'alerts'])
  })

  it('lässt Erledigtes und Unmögliches weg', () => {
    expect(planGuide(false, true, false)).toEqual(['alerts'])
    expect(planGuide(true, false, false)).toEqual(['notifications'])
    expect(planGuide(true, true, true)).toEqual(['notifications'])
    expect(planGuide(false, true, true)).toEqual([])
  })
})
