import { describe, expect, it } from 'vitest'
import type { Msg } from '../src/core/messages'
import { SPOT, answerTo, answersQuestion, mutualAnswered, newestShared, spotLine } from '../src/core/spots'
import { currentAsk } from '../src/core/sos'
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

  it('unterscheidet Antwort und späteres Senken', () => {
    const question = msg('q', 1, true, SPOT.SHARE, { level: 3 })
    const yes = msg('y', 2, false, SPOT.SHARED, { level: 3 })
    const lowered = msg('l', 3, false, SPOT.SHARED, { level: 2 })
    const all = [question, yes, lowered]
    expect(mutualAnswered(question, all)).toBe(true)
    expect(answersQuestion(yes, all)).toBe(true)
    expect(answersQuestion(lowered, all)).toBe(false)
    expect(newestShared(yes, all)).toBe(false)
    expect(newestShared(lowered, all)).toBe(true)
  })
})

describe('SOS-Kontakte (ADR 0121 §25)', () => {
  it('zeigt die älteste Anfrage, die nicht auf später gelegt ist', () => {
    const asks = [
      { person: 'a', at: 1, circleId: null },
      { person: 'b', at: 2, circleId: 'c' },
    ]
    expect(currentAsk(asks, [])?.person).toBe('a')
    expect(currentAsk(asks, ['a'])?.person).toBe('b')
    expect(currentAsk(asks, ['a', 'b'])).toBeNull()
  })

  it('ein ausgebliebenes Lebenszeichen drängt nur bei Zusage und „Laut“', () => {
    const agreed = (p: string) => p === 'anna'
    expect(urgent('anna', 'loud', agreed)).toBe(true)
    expect(urgent('ben', 'loud', agreed)).toBe(false)
    expect(urgent('anna', 'normal', agreed)).toBe(false)
  })
})
