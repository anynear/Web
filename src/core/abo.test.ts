import { describe, expect, it } from 'vitest'
import { compareValue, parseAbo, planCompare, yearlyPerMonth, yearlySaving, type AboPlan } from './abo'

const plan = (monthlyCents: number, yearlyCents: number) => ({ id: 'x', monthlyCents, yearlyCents }) as AboPlan

describe('yearly price', () => {
  it('saving in percent, like the app and the website', () => {
    expect(yearlySaving(plan(299, 2690))).toBe(25)
    expect(yearlySaving(plan(599, 5390))).toBe(25)
    expect(yearlySaving(plan(999, 8990))).toBe(25)
    expect(yearlySaving(plan(299, 2900))).toBe(19)
    expect(yearlySaving(plan(0, 0))).toBe(0)
    expect(yearlySaving(plan(100, 1500))).toBe(0)
  })

  it('per month', () => {
    expect(yearlyPerMonth(plan(299, 2690))).toBe(224)
    expect(yearlyPerMonth(plan(999, 8990))).toBe(749)
  })
})

describe('comparison table', () => {
  const plans = [
    { ...plan(0, 0), id: 'free' },
    { ...plan(500, 5000), id: 'plus' },
  ]
  const text = (compare: unknown) => JSON.stringify({ trialMonths: 3, plans, compare })

  it('in the language, otherwise English; a dash for a missing value', () => {
    const p = parseAbo(text({ en: { rows: [{ label: 'Bin', values: { free: '7 days' } }], note: 'All plans' } }))!
    const c = planCompare(p, true)!
    expect(c.rows[0].label).toBe('Bin')
    expect(compareValue(c.rows[0], plans[0])).toBe('7 days')
    expect(compareValue(c.rows[0], plans[1])).toBe('–')
    expect(c.note).toBe('All plans')
  })

  it('none for older previews, then the text blocks apply', () => {
    expect(planCompare(parseAbo(text(undefined))!, true)).toBeNull()
    expect(planCompare(parseAbo(text({ de: { rows: [] } }))!, true)).toBeNull()
  })
})
