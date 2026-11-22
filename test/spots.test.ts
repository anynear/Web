import { describe, expect, it } from 'vitest'
import type { Msg } from '../src/core/messages'
import { SPOT, answerTo, answersQuestion, newestShare, spotLine } from '../src/core/spots'
import { SOS_CARD, sosCards, sosHelpers, takeHelpers } from '../src/core/sos'
import { urgent } from '../src/core/lifesigns'
import { texts } from '../src/i18n'
import { de } from '../src/i18n/de'
import { en } from '../src/i18n/en'

function msg(id: string, ts: number, outgoing: boolean, kind: number, extra: Partial<NonNullable<Msg['spot']>> = {}): Msg {
  return { id, conv: 'd:p1', outgoing, text: 'Ersatztext https://anynear.app/…', ts, attachments: [], spot: { kind, ...extra } }
}

describe('Karten im Chat (ADR 0121 §26)', () => {
  it('Übersicht und Mitteilung sagen, was die Karte sagt', () => {
    // The page speaks the browser's language; the texts are those of the card.
    const t = texts.place
    expect(spotLine(SPOT.HERE, undefined, false)).toBe(t.noticeHere)
    expect(spotLine(SPOT.HERE, undefined, true)).toBe(t.spotHereOwn)
    expect(spotLine(SPOT.ARRIVED, 'Zuhause', false)).toBe(t.noticeArrived('Zuhause'))
    expect(spotLine(SPOT.ARRIVED, undefined, false)).toBe(t.noticeArrived(null))
    expect(spotLine(SPOT.MEET, 'Haupteingang', false)).toBe(t.spotMeetText('Haupteingang'))
    expect(spotLine(SPOT.ASK, undefined, false)).toBe(t.spotAsk)
    expect(spotLine(SPOT.SHARE, undefined, false)).toBe(t.mutualNotice)
    expect(de.place.noticeArrived('Zuhause')).toBe('Ist angekommen: Zuhause')
    expect(en.place.levelArea).toBe('Approximate, precise with SOS')
    expect(de.place.levelWhen).toBe('Nur bei SOS')
  })

  it('„Wo bist du?“ füllt sich mit der Antwort der anderen Seite', () => {
    const ask = msg('a', 1, false, SPOT.ASK)
    const own = msg('b', 2, false, SPOT.HERE)
    const answer = msg('c', 3, true, SPOT.HERE, { latitude: 50, longitude: 8 })
    expect(answerTo(ask, [ask, own])).toBeUndefined()
    expect(answerTo(ask, [ask, own, answer])?.id).toBe('c')
  })

  it('unterscheidet Antwort und späteres Senken älterer Apps; nur die neueste Frage hat Knöpfe', () => {
    const question = msg('q', 1, true, SPOT.SHARE, { level: 3 })
    const yes = msg('y', 2, false, SPOT.SHARED, { level: 3 })
    const lowered = msg('l', 3, false, SPOT.SHARED, { level: 2 })
    const ended = msg('e', 4, false, SPOT.ENDED)
    const again = msg('a', 5, true, SPOT.SHARE, { level: 2 })
    const all = [question, yes, lowered, ended, again]
    expect(answersQuestion(yes, all)).toBe(true)
    expect(answersQuestion(lowered, all)).toBe(false)
    expect(newestShare(question, all)).toBe(false)
    expect(newestShare(again, all)).toBe(true)
    expect(spotLine(SPOT.ENDED, undefined, false)).toBe(texts.place.sharingEndedNotice)
    expect(spotLine(SPOT.WITHDRAWN, undefined, false)).toBe(texts.place.sharingWithdrawnNotice)
  })
})

describe('SOS-Kontakte (ADR 0121 §25)', () => {
  it('liest die Auswahl der SOS-Kontakte so, wie die App sie schreibt', () => {
    takeHelpers('1c:familie,p:anna,x:ben')
    expect(sosHelpers.value).toEqual({ circles: ['familie'], persons: ['anna'], except: ['ben'] })
    takeHelpers('0')
    expect(sosHelpers.value).toEqual({ circles: [], persons: [], except: [] })
  })

  it('jeder Schritt wird eine Karte im Chat (ADR 0123 §5)', () => {
    expect(sosCards(false, true, false, false, undefined, undefined, false)).toEqual([SOS_CARD.ASKED_US])
    expect(sosCards(true, false, false, true, undefined, undefined, false)).toEqual([SOS_CARD.WE_YES])
    expect(sosCards(true, false, false, false, undefined, undefined, false)).toEqual([SOS_CARD.WE_NO])
    expect(sosCards(false, false, true, false, undefined, undefined, false)).toEqual([SOS_CARD.OVER_FOR_US])
    expect(sosCards(false, false, false, false, 1, 2, false)).toEqual([SOS_CARD.THEY_YES])
    expect(sosCards(false, false, false, false, 2, undefined, false)).toEqual([SOS_CARD.OVER_FOR_THEM])
    expect(sosCards(false, false, false, false, 1, 1, false)).toEqual([])
    expect(de.sos.card(SOS_CARD.THEY_YES, 'Anna')).toBe('Anna ist jetzt dein SOS-Kontakt')
    expect(en.sos.card(SOS_CARD.WE_YES, 'Anna')).toBe("You're now Anna's SOS contact")
    expect(de.place.sharingAccept).toBe('Annehmen')
    expect(en.people.requestsPage).toBe('Requests')
  })

  it('ein ausgebliebenes Lebenszeichen drängt nur bei Zusage und „Laut“', () => {
    const agreed = (p: string) => p === 'anna'
    expect(urgent('anna', 'loud', agreed)).toBe(true)
    expect(urgent('ben', 'loud', agreed)).toBe(false)
    expect(urgent('anna', 'normal', agreed)).toBe(false)
  })
})
