import { describe, expect, it } from 'vitest'
import { defaultLoginName, isLoginLink, loginLinkFromUrl, loginNameOk } from '../src/core/loginLink'

describe('login with anynear (ADR 0122)', () => {
  it('takes the deep link /l#… of the web app', () => {
    expect(loginLinkFromUrl('/l', '#abc_-1')).toBe('https://anynear.app/l#abc_-1')
    expect(loginLinkFromUrl('/l/', '#abc')).toBe('https://anynear.app/l#abc')
    expect(loginLinkFromUrl('/a', '#abc')).toBeNull()
    expect(loginLinkFromUrl('/legal', '#abc')).toBeNull()
    expect(loginLinkFromUrl('/l', '#a b')).toBeNull()
  })

  it('recognizes login links in pasted text', () => {
    expect(isLoginLink('Melde dich an: https://anynear.app/l#xyz')).toBe(true)
    expect(isLoginLink('https://anynear.net/l/#xyz')).toBe(true)
    expect(isLoginLink('https://anynear.app/legal')).toBe(false)
  })

  it('checks the name like the issuer', () => {
    expect(loginNameOk('  Kim  ')).toBe(true)
    expect(loginNameOk('   ')).toBe(false)
    expect(loginNameOk('Kim\u0007')).toBe(false)
    expect(loginNameOk('😀'.repeat(40))).toBe(true)
    expect(loginNameOk('😀'.repeat(41))).toBe(false)
    expect(defaultLoginName('😀'.repeat(50))).toBe('😀'.repeat(40))
  })
})
