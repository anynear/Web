import { describe, expect, it } from 'vitest'
import { cleanPhoneNumber, mailHref, smsHref, smsNumber } from './phoneInvite'

describe('invite by text message or email (like the app)', () => {
  it('numbers lose spaces, dashes and brackets', () => {
    expect(cleanPhoneNumber(' +49 (171) 123-45 ')).toBe('+4917112345')
    expect(cleanPhoneNumber('0171 / 123 45')).toBe('017112345')
  })

  it('the first usable number wins, none without digits', () => {
    expect(smsNumber(['', '--', '0171 12345', '0800 999'])).toBe('017112345')
    expect(smsNumber([])).toBeNull()
    expect(smsNumber(['12', 'abc'])).toBeNull()
  })

  it('links carry the text, never anything else', () => {
    const text = 'Hier ist Anna. Tippe: https://anynear.app/c#abc'
    expect(smsHref('+4917112345', text)).toBe(`sms:+4917112345?&body=${encodeURIComponent(text)}`)
    expect(smsHref(null, 'a b')).toBe('sms:?&body=a%20b')
    expect(mailHref('anynear', 'a&b')).toBe('mailto:?subject=anynear&body=a%26b')
  })
})
