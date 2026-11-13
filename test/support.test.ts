import { describe, expect, it } from 'vitest'
import { MAX_CIRCLE_NAME, SUPPORT_CONTACT_LINK, supportCircleName, supportFormComplete, supportInviteMessage, supportMessage, truncateName } from '../src/core/support'

describe('support', () => {
  it('has the contact link of the support identity', () => {
    expect(SUPPORT_CONTACT_LINK).toMatch(/^https:\/\/anynear\.app\/c#[A-Za-z0-9_-]+$/)
  })

  it('names the circle after the subject', () => {
    expect(supportCircleName('  Bild lädt   nicht ')).toBe('Support: Bild lädt nicht')
  })

  it('cuts the circle name to the name limit', () => {
    const name = supportCircleName('Nachrichten kommen auf dem Computer nicht an')
    expect(Array.from(name)).toHaveLength(MAX_CIRCLE_NAME)
    expect(name.startsWith('Support: Nachrichten kommen')).toBe(true)
    expect(name.endsWith('…')).toBe(true)
  })

  it('does not split emoji when cutting', () => {
    expect(truncateName('😀😀😀😀', 3)).toBe('😀😀…')
    expect(truncateName('abc', 3)).toBe('abc')
  })

  it('builds the first message with kind, description and version line', () => {
    expect(supportMessage('Fehler', '  Es geht nicht.\nGar nicht.  ', 'anynear 0.1.0 · Web (Firefox auf Mac)')).toBe(
      'Fehler\n\nEs geht nicht.\nGar nicht.\n\nanynear 0.1.0 · Web (Firefox auf Mac)',
    )
  })

  it('builds the message to the support with the invite link', () => {
    expect(supportInviteMessage('Neue Anfrage: ', ' Bild lädt nicht ', 'https://anynear.app/c#x')).toBe('Neue Anfrage: Bild lädt nicht\nhttps://anynear.app/c#x')
  })

  it('needs subject and description', () => {
    expect(supportFormComplete('a', 'b')).toBe(true)
    expect(supportFormComplete(' ', 'b')).toBe(false)
    expect(supportFormComplete('a', '\n')).toBe(false)
  })
})
