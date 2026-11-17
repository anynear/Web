import { describe, expect, it } from 'vitest'
import {
  activeContactNames,
  cleanContactName,
  contactNamesDiffer,
  decodeContactNames,
  mergeContactNames,
  withContactName,
} from './contactNames'

describe('own names for other people (setting contact_names, like the app)', () => {
  it('reads the format of the app and ignores broken values', () => {
    expect(decodeContactNames('{"p1":{"n":"Opa","t":10}}')).toEqual({ p1: { n: 'Opa', t: 10 } })
    expect(decodeContactNames('kaputt')).toEqual({})
    expect(decodeContactNames(null)).toEqual({})
  })

  it('later change wins, a reset goes along', () => {
    const phone = withContactName({}, 'p1', '  Opa ', 10)
    expect(activeContactNames(phone)).toEqual({ p1: 'Opa' })
    const tablet = withContactName(phone, 'p1', '', 20)
    const merged = mergeContactNames(phone, tablet)
    expect(activeContactNames(merged)).toEqual({})
    expect(contactNamesDiffer(merged, tablet)).toBe(false)
    // An older state from elsewhere does not bring the name back.
    expect(activeContactNames(mergeContactNames(merged, phone))).toEqual({})
  })

  it('merges the same on all devices', () => {
    const a = { p1: { n: 'A', t: 5 }, p2: { n: 'X', t: 1 } }
    const b = { p1: { n: 'B', t: 5 }, p3: { n: 'Y', t: 2 } }
    expect(mergeContactNames(a, b)).toEqual(mergeContactNames(b, a))
    expect(mergeContactNames(a, b).p1.n).toBe('B')
  })

  it('same name again changes nothing; a clock behind still makes a later change', () => {
    const e = withContactName({}, 'p1', 'Opa', 10)
    expect(withContactName(e, 'p1', 'Opa ', 30)).toBe(e)
    expect(withContactName(e, 'p1', 'Papa', 5).p1.t).toBe(11)
    expect(cleanContactName('x'.repeat(60))).toHaveLength(40)
  })
})
