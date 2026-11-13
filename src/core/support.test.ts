import { describe, expect, it } from 'vitest'
import { alreadyAlerted, isSupportAlertChannel, parseSupportJson, pendingRequests, requestInvite, requestSubject } from './support'

const INVITE = 'https://anynear.app/k#abc'

describe('Support-Anfragen weiterleiten (ADR 0065)', () => {
  it('erkennt die Direktnachricht „Neue Anfrage“ in beiden Sprachen', () => {
    expect(requestSubject(`Neue Anfrage: Login klappt nicht\n${INVITE}`)).toBe('Login klappt nicht')
    expect(requestSubject(`New request: Sync broken\n${INVITE}`)).toBe('Sync broken')
    expect(requestInvite(`Neue Anfrage: x\n ${INVITE} `)).toBe(INVITE)
  })

  it('ignoriert Nachrichten ohne Einladungslink oder ohne Betreff', () => {
    expect(requestSubject('Neue Anfrage: Login klappt nicht')).toBeNull()
    expect(requestSubject(`Neue Anfrage:\n${INVITE}`)).toBeNull()
    expect(requestSubject(`Hallo\n${INVITE}`)).toBeNull()
  })

  it('nimmt nur neue, eingehende Direktnachrichten im Zeitfenster', () => {
    const text = `Neue Anfrage: Frage\n${INVITE}`
    const list = pendingRequests(
      [
        { id: 'a', conv: 'd:p1', outgoing: false, text, ts: 2000 },
        { id: 'b', conv: 'd:p1', outgoing: true, text, ts: 2000 },
        { id: 'c', conv: 'c:k1', outgoing: false, text, ts: 2000 },
        { id: 'd', conv: 'd:p1', outgoing: false, text, ts: 500 },
        { id: 'e', conv: 'd:p1', outgoing: false, text, ts: 2000 },
      ],
      new Set(['e']),
      1000,
    )
    expect(list).toEqual([{ id: 'a', subject: 'Frage', invite: INVITE, ts: 2000 }])
  })

  it('findet nur den eigenen, nicht kuratierten Kanal „anynear-support“', () => {
    expect(isSupportAlertChannel({ name: ' Anynear-Support ', owner: true, curated: false })).toBe(true)
    expect(isSupportAlertChannel({ name: 'anynear-support', owner: false, curated: false })).toBe(false)
    expect(isSupportAlertChannel({ name: 'anynear-support', owner: true, curated: true })).toBe(false)
  })

  it('meldet nicht doppelt, wenn ein anderes Gerät schon gemeldet hat', () => {
    const alerts = [{ channelId: 'ch', text: 'Text', ts: 10_000 }]
    expect(alreadyAlerted(alerts, 'ch', 'Text', 9_000)).toBe(true)
    expect(alreadyAlerted(alerts, 'ch', 'Text', 200_000)).toBe(false)
    expect(alreadyAlerted(alerts, 'other', 'Text', 9_000)).toBe(false)
  })
})

describe('parseSupportJson', () => {
  it('nimmt nur einen Kontaktlink auf anynear.app aus Version 1', () => {
    expect(parseSupportJson('{"version":1,"contact":"https://anynear.app/c#abc_-1"}')).toBe('https://anynear.app/c#abc_-1')
    expect(parseSupportJson('{"version":2,"contact":"https://anynear.app/c#abc"}')).toBeNull()
    expect(parseSupportJson('{"version":1,"contact":"https://evil.example/c#abc"}')).toBeNull()
    expect(parseSupportJson('{"version":1,"contact":"https://anynear.app/k#abc"}')).toBeNull()
    expect(parseSupportJson('kein json')).toBeNull()
  })
})
