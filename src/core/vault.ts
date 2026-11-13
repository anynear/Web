// Password file `vault` as in the app (app passwords/PasswordVault.kt, ADR 0039, 0048, 0052): UTF-8 JSON,
// AES-256-GCM under the key `pv`, 12 byte nonce in front, 16 byte tag at the end. Unknown fields (e.g. passkeys)
// are kept unchanged, so that the browser loses nothing when merging.

export interface Login {
  id: string
  website: string
  username: string
  password: string
  /** Unix milliseconds of the last change. */
  changed: number
  /** `otpauth://` link (ADR 0052). */
  otp?: string
  passkeys?: unknown[]
  [extra: string]: unknown
}

export interface Removed {
  id: string
  changed: number
}

export interface Vault {
  logins: Login[]
  removed: Removed[]
}

export const VAULT_VERSION = 2

/** Version 2 only if a login has a one-time code or passkey (ADR 0052, item 5). */
function versionOf(v: Vault): number {
  return v.logins.some((l) => l.otp != null || (l.passkeys?.length ?? 0) > 0) ? 2 : 1
}

async function aesKey(pv: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', pv as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function sealVault(pv: Uint8Array, vault: Vault): Promise<Uint8Array> {
  const json = JSON.stringify({ v: versionOf(vault), logins: vault.logins, removed: vault.removed })
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, await aesKey(pv), new TextEncoder().encode(json)))
  const out = new Uint8Array(12 + ct.length)
  out.set(nonce)
  out.set(ct, 12)
  return out
}

/** `null` if [sealed] is not encrypted with [pv], is damaged or comes from a newer version. */
export async function openVault(pv: Uint8Array, sealed: Uint8Array): Promise<Vault | null> {
  if (sealed.length < 28) return null
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, 12) }, await aesKey(pv), sealed.slice(12))
    const content = JSON.parse(new TextDecoder().decode(plain))
    if (typeof content !== 'object' || content === null || (content.v ?? 1) > VAULT_VERSION) return null
    return { logins: Array.isArray(content.logins) ? content.logins : [], removed: Array.isArray(content.removed) ? content.removed : [] }
  } catch {
    return null
  }
}

/**
 * Merge two states (ADR 0048, like Vault.merge in the app): per login the newest change applies, a
 * deletion applies if it is not older than the last change; at the same time the content decides.
 */
export function mergeVaults(a: Vault, b: Vault): Vault {
  const removedById = new Map<string, Removed>()
  for (const r of [...a.removed, ...b.removed]) {
    const cur = removedById.get(r.id)
    if (!cur || r.changed > cur.changed) removedById.set(r.id, r)
  }
  const byId = new Map<string, Login>()
  for (const l of [...a.logins, ...b.logins]) {
    const cur = byId.get(l.id)
    if (!cur || compareLogins(l, cur) > 0) byId.set(l.id, l)
  }
  const logins = [...byId.values()].filter((l) => (removedById.get(l.id)?.changed ?? -Infinity) < l.changed)
  const removed = [...removedById.values()].filter((r) => !logins.some((l) => l.id === r.id))
  return { logins, removed }
}

function compareLogins(x: Login, y: Login): number {
  const keys: ((l: Login) => string | number)[] = [
    (l) => l.changed,
    (l) => l.password,
    (l) => l.username,
    (l) => l.website,
    (l) => l.otp ?? '',
    (l) => (l.passkeys ?? []).map((p) => (p as { credentialId?: string }).credentialId ?? '').join(', '),
  ]
  for (const k of keys) {
    const a = k(x)
    const b = k(y)
    if (a < b) return -1
    if (a > b) return 1
  }
  return 0
}

/** Create or change a login; the time is never older than the last known change. */
export function upsertLogin(v: Vault, login: Omit<Login, 'changed'> & { changed?: number }, now = Date.now()): Vault {
  const prev = v.logins.find((l) => l.id === login.id)
  const changed = Math.max(now, (prev?.changed ?? 0) + 1)
  const next = { ...prev, ...login, changed } as Login
  if (!next.otp) delete next.otp
  return { logins: [...v.logins.filter((l) => l.id !== login.id), next], removed: v.removed.filter((r) => r.id !== login.id) }
}

export function deleteLogin(v: Vault, id: string, now = Date.now()): Vault {
  const prev = v.logins.find((l) => l.id === id)
  const changed = Math.max(now, (prev?.changed ?? 0) + 1)
  return { logins: v.logins.filter((l) => l.id !== id), removed: [...v.removed.filter((r) => r.id !== id), { id, changed }] }
}

// --- Matching and display (LoginMatch in the app) -------------------------------------------------------

/** Host of an input like „https://www.Bank.de/login“ → „bank.de“; `null` if none can be recognised. */
export function hostOf(website: string): string | null {
  let s = website.trim().toLowerCase()
  const scheme = s.indexOf('://')
  if (scheme >= 0) s = s.slice(scheme + 3)
  s = s.split('/')[0].split('?')[0].split('#')[0]
  s = s.slice(s.lastIndexOf('@') + 1).split(':')[0].replace(/\.+$/, '')
  if (s.startsWith('www.')) s = s.slice(4)
  if (!s || !/^[\p{L}\p{N}.-]+$/u.test(s) || s.startsWith('.') || s.includes('..')) return null
  return s
}

export function displayName(website: string): string {
  return hostOf(website) ?? website.trim()
}

export function sortLogins(logins: Login[]): Login[] {
  return [...logins].sort(
    (a, b) => displayName(a.website).toLowerCase().localeCompare(displayName(b.website).toLowerCase()) || a.username.toLowerCase().localeCompare(b.username.toLowerCase()),
  )
}

/** New identifier as in the app: 12 random bytes, b64u. */
export function newLoginId(): string {
  const b = crypto.getRandomValues(new Uint8Array(12))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// --- One-time codes (Otp.kt in the app, RFC 6238) ----------------------------------------------------------

export interface Otp {
  secret: Uint8Array
  digits: number
  period: number
  algorithm: 'SHA1' | 'SHA256' | 'SHA512'
  issuer: string
  label: string
}

export function parseOtp(text: string): Otp | null {
  const t = text.trim()
  if (!/^otpauth:\/\/totp\//i.test(t)) return null
  const rest = t.slice(t.indexOf('://') + 3)
  const label = safeDecode(rest.slice(rest.indexOf('/') + 1).split('?')[0])
  const params = new Map<string, string>()
  for (const p of (rest.split('?')[1] ?? '').split('&')) {
    const i = p.indexOf('=')
    if (i > 0) params.set(p.slice(0, i).toLowerCase(), safeDecode(p.slice(i + 1)))
  }
  const secret = base32(params.get('secret') ?? '')
  if (!secret || secret.length === 0) return null
  const algorithm = (params.get('algorithm') ?? 'SHA1').toUpperCase()
  if (algorithm !== 'SHA1' && algorithm !== 'SHA256' && algorithm !== 'SHA512') return null
  const digits = Number(params.get('digits') ?? 6)
  const period = Number(params.get('period') ?? 30)
  if (!(digits >= 6 && digits <= 8) || !(period > 0)) return null
  return { secret, digits, period, algorithm, issuer: params.get('issuer') ?? '', label }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}

function base32(text: string): Uint8Array | null {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = text.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const c of clean) {
    const i = alphabet.indexOf(c)
    if (i < 0) return null
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

export async function otpCode(otp: Otp, nowMillis = Date.now()): Promise<string> {
  const counter = Math.floor(nowMillis / 1000 / otp.period)
  const msg = new Uint8Array(8)
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter))
  const hash = otp.algorithm === 'SHA1' ? 'SHA-1' : otp.algorithm === 'SHA256' ? 'SHA-256' : 'SHA-512'
  const key = await crypto.subtle.importKey('raw', otp.secret as BufferSource, { name: 'HMAC', hash }, false, ['sign'])
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
  const offset = h[h.length - 1] & 0x0f
  const binary = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3]
  return String(binary % 10 ** otp.digits).padStart(otp.digits, '0')
}

export function otpSecondsLeft(otp: Otp, nowMillis = Date.now()): number {
  return otp.period - (Math.floor(nowMillis / 1000) % otp.period)
}

/** A strong password (20 characters, easy to read). */
export function generatePassword(length = 20): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_!?'
  const out: string[] = []
  const buf = new Uint32Array(length)
  crypto.getRandomValues(buf)
  for (const n of buf) out.push(chars[n % chars.length])
  return out.join('')
}
