import { describe, expect, it } from 'vitest'
import { planGuide } from './guide'

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
