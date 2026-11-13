import { describe, expect, it } from 'vitest'
import { chatMatches, type Msg } from '../src/core/messages'
import { kindOf, mimeOf, shortName } from '../src/core/media'
import {
  type Vault,
  deleteLogin,
  hostOf,
  mergeVaults,
  openVault,
  otpCode,
  parseOtp,
  sealVault,
  upsertLogin,
} from '../src/core/vault'

const pv = new Uint8Array(32).fill(7)
const login = (id: string, changed: number, password = 'p') => ({ id, website: 'bank.de', username: 'u', password, changed })

describe('Passwort-Datei', () => {
  it('versiegeln und öffnen, Version nach Inhalt, unbekannte Felder bleiben', async () => {
    const v: Vault = { logins: [{ ...login('a', 1), passkeys: [{ credentialId: 'x', extra: 1 }] }], removed: [] }
    const sealed = await sealVault(pv, v)
    expect(sealed.length).toBeGreaterThan(28)
    const opened = await openVault(pv, sealed)
    expect(opened?.logins[0].passkeys).toEqual([{ credentialId: 'x', extra: 1 }])
    expect(await openVault(new Uint8Array(32), sealed)).toBeNull()
    const plain = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, 12) }, await crypto.subtle.importKey('raw', pv, 'AES-GCM', false, ['decrypt']), sealed.slice(12))))
    expect(plain.v).toBe(2)
  })

  it('neuere Version wird nicht gelesen', async () => {
    const key = await crypto.subtle.importKey('raw', pv, 'AES-GCM', false, ['encrypt'])
    const iv = new Uint8Array(12)
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('{"v":3,"logins":[]}')))
    const sealed = new Uint8Array(12 + ct.length)
    sealed.set(ct, 12)
    expect(await openVault(pv, sealed)).toBeNull()
  })

  it('Zusammenführen: neueste Änderung gewinnt, Löschung gilt, wenn nicht älter', () => {
    const a: Vault = { logins: [login('1', 10, 'alt'), login('2', 5)], removed: [] }
    const b: Vault = { logins: [login('1', 20, 'neu')], removed: [{ id: '2', changed: 6 }] }
    const m = mergeVaults(a, b)
    expect(m.logins.map((l) => [l.id, l.password])).toEqual([['1', 'neu']])
    expect(m.removed).toEqual([{ id: '2', changed: 6 }])
    const revived = mergeVaults(m, { logins: [login('2', 7)], removed: [] })
    expect(revived.logins.map((l) => l.id).sort()).toEqual(['1', '2'])
    expect(revived.removed).toEqual([])
  })

  it('Ändern und Löschen zählen die Zeit weiter', () => {
    let v: Vault = { logins: [login('1', 5000)], removed: [] }
    v = upsertLogin(v, { id: '1', website: 'bank.de', username: 'u', password: 'x' }, 1000)
    expect(v.logins[0].changed).toBe(5001)
    v = deleteLogin(v, '1', 1000)
    expect(v.removed).toEqual([{ id: '1', changed: 5002 }])
  })

  it('Host wie LoginMatch in der App', () => {
    expect(hostOf('https://www.Bank.de/login')).toBe('bank.de')
    expect(hostOf('user@mail.example.com:443')).toBe('mail.example.com')
    expect(hostOf('nicht gültig')).toBeNull()
  })
})

describe('Einmalcodes', () => {
  it('RFC 6238, SHA1, 8 Stellen', async () => {
    // Secret "12345678901234567890" in Base32
    const otp = parseOtp('otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8')!
    expect(await otpCode(otp, 59_000)).toBe('94287082')
    expect(await otpCode(otp, 1_111_111_109_000)).toBe('07081804')
  })

  it('ungültige Links', () => {
    expect(parseOtp('https://example.com')).toBeNull()
    expect(parseOtp('otpauth://totp/x?secret=!!!')).toBeNull()
  })
})

describe('Suche im Chat und Dateien', () => {
  const m = (id: string, text: string, ts: number, extra: Partial<Msg> = {}): Msg => ({ id, conv: 'c:k', outgoing: false, text, ts, attachments: [], ...extra })
  it('Text und Dateinamen, neueste zuerst, ohne Zeilen zu Änderungen', () => {
    const list = [
      m('1', 'Treffen am Markt', 1),
      m('2', '', 2, { attachments: [{ id: 'a', key: 'k', type: 'pdf', name: 'Markt-Plan.pdf', size: 1, width: 0, height: 0, duration: 0 }] }),
      m('3', 'markt', 3, { system: true }),
    ]
    expect(chatMatches(list, ' MARKT ').map((x) => x.id)).toEqual(['2', '1'])
    expect(chatMatches(list, '')).toEqual([])
  })

  it('Dateiarten, MIME, kurze Namen', () => {
    expect(kindOf(new File([], 'a.jpg', { type: 'image/jpeg' }))).toBe('jpg')
    expect(kindOf(new File([], 'a.gif', { type: 'image/gif' }))).toBe('file')
    expect(kindOf(new File([], 'a.PDF'))).toBe('pdf')
    expect(mimeOf('file', 'Tabelle.xlsx')).toContain('spreadsheetml')
    expect(shortName('ein-sehr-langer-dateiname-der-nicht-passt-wirklich.pdf')).toMatch(/^.{35}….pdf$/)
  })
})
