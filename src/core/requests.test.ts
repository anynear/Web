import { describe, expect, it } from 'vitest'
import { texts } from '../i18n'
import { circleKey, directKey, type IntroCard } from './messages'
import { introState, introStatus, requestOriginText, withoutAsking } from './requests'

const NOW = 1_800_000_000_000
const intro: IntroCard = { id: 'i', person: 'ilse', name: 'Ilse', byPerson: 'anna', until: NOW + 1000, card: 'c' }

describe('Kontaktanfragen und Vorstellungen (ADR 0116)', () => {
  it('zeigt „Hinzufügen“ nur, solange nichts anderes gilt', () => {
    expect(introState(intro, false, false, false, NOW)).toBe('open')
    expect(introState(intro, true, false, false, NOW)).toBe('own')
    expect(introState(intro, false, true, true, NOW)).toBe('known')
    expect(introState(intro, false, false, true, NOW)).toBe('pending')
    expect(introState(intro, false, false, false, NOW + 2000)).toBe('expired')
  })

  it('sagt unter der Karte, was gilt', () => {
    expect(introStatus('open')).toBeUndefined()
    expect(introStatus('own')).toBeUndefined()
    expect(introStatus('known')).toBe(texts.people.alreadyContact)
    expect(introStatus('pending')).toBe(texts.people.requestPending)
    expect(introStatus('expired')).toBe(texts.people.introExpired)
  })

  it('lässt Gespräche von Fragenden aus der Übersicht, bis man zustimmt', () => {
    const convs = [circleKey('familie'), directKey('ben'), directKey('ilse')]
    expect(withoutAsking(convs, ['ilse'])).toEqual([circleKey('familie'), directKey('ben')])
    expect(withoutAsking(convs, [])).toEqual(convs)
  })

  it('nennt, woher die Anfrage kommt', () => {
    expect(requestOriginText('Anna')).toBe(texts.people.introducedBy('Anna'))
    expect(requestOriginText(null)).toBe(texts.people.viaYourContactLink)
  })
})
