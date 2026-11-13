import { describe, expect, it } from 'vitest'
import { findInviteLinks, withoutInviteLinks } from '../src/core/invites'

describe('invites', () => {
  it('finds circle, contact, channel and device links, not other addresses', () => {
    const text = 'a https://anynear.app/k#AAA b https://anynear.net/c/#BBB c https://anynear.app/a#CCC d https://example.org/k#x e https://anynear.app/p#DDD'
    expect(findInviteLinks(text).map((l) => l.kind)).toEqual(['circle', 'contact', 'channel', 'device'])
    expect(findInviteLinks(text)[1].url).toBe('https://anynear.net/c/#BBB')
  })

  it('keeps the rest of the text and drops a trailing colon', () => {
    expect(withoutInviteLinks('Schau mal: https://anynear.app/k#AAA')).toBe('Schau mal')
    expect(withoutInviteLinks('https://anynear.app/k#AAA')).toBe('')
    expect(withoutInviteLinks('vorher https://anynear.app/c#X nachher')).toBe('vorher nachher')
    expect(withoutInviteLinks('nur https://example.org')).toBe('nur https://example.org')
  })

  it('drops the share sentences of the app in both languages', () => {
    expect(withoutInviteLinks('Komm in meinen Kreis „Garten“ bei anynear: https://anynear.app/k#AAA')).toBe('')
    expect(withoutInviteLinks('Join my circle “Garden” on anynear: https://anynear.app/k#AAA')).toBe('')
    expect(withoutInviteLinks('Testname bei anynear. Tippe auf den Link, um mich als Kontakt hinzuzufügen: https://anynear.app/c#B')).toBe('')
    expect(withoutInviteLinks('Testname lädt dich zum Kanal „Haus“ bei anynear ein: https://anynear.app/a#C')).toBe('')
  })
})
