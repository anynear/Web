// Device lock in the browser for the passwords (ADR 0059, like ADR 0039 in the app): a passkey of this page with the
// WebAuthn extension PRF yields a secret on Touch ID, Windows Hello or the computer's PIN. From it comes
// the key under which `pv` is kept here. Without PRF (older browsers) there are no passwords in the browser.
import { local } from './storage'
import { b64u, fromB64u } from './messages'

const CRED = 'pv.cred'
const SALT = 'pv.salt'
const WRAPPED = 'pv.wrapped'
const INFO = new TextEncoder().encode('web/pv-lock')

export type LockError = 'unsupported' | 'cancelled' | 'failed'

export function lockAvailable(): boolean {
  return typeof PublicKeyCredential !== 'undefined' && typeof navigator.credentials?.create === 'function'
}

export function hasLock(): boolean {
  return !!(local.get(CRED) && local.get(SALT) && local.get(WRAPPED))
}

export function forgetLock() {
  local.set(CRED, null)
  local.set(SALT, null)
  local.set(WRAPPED, null)
}

/** Create a new passkey and store [pv] behind it. */
export async function createLock(pv: Uint8Array, userName: string): Promise<LockError | null> {
  if (!lockAvailable()) return 'unsupported'
  const salt = crypto.getRandomValues(new Uint8Array(32))
  let cred: PublicKeyCredential | null
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        rp: { name: 'anynear', id: location.hostname },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: `anynear ${userName}`.trim(), displayName: `anynear ${userName}`.trim() },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 120_000,
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null
  } catch (e) {
    return errorOf(e)
  }
  if (!cred) return 'cancelled'
  const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean; results?: { first?: BufferSource } } }
  if (ext.prf?.enabled === false) return 'unsupported'
  const credId = new Uint8Array(cred.rawId)
  // Some browsers deliver the result already on creation, others only on the first sign-in.
  let secret: Uint8Array | null = ext.prf?.results?.first ? new Uint8Array(ext.prf.results.first as ArrayBuffer) : null
  if (!secret) {
    const r = await prfSecret(credId, salt)
    if (typeof r === 'string') return r
    secret = r
  }
  const key = await wrapKey(secret)
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, pv as BufferSource))
  local.set(CRED, b64u(credId))
  local.set(SALT, b64u(salt))
  local.set(WRAPPED, b64u(concat(nonce, ct)))
  return null
}

/** Unlock with the computer lock; returns `pv`. */
export async function unlock(): Promise<Uint8Array | LockError> {
  const cred = local.get(CRED)
  const salt = local.get(SALT)
  const wrapped = local.get(WRAPPED)
  if (!cred || !salt || !wrapped) return 'failed'
  const secret = await prfSecret(bytes(fromB64u(cred)), bytes(fromB64u(salt)))
  if (typeof secret === 'string') return secret
  const data = bytes(fromB64u(wrapped))
  try {
    const pv = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, await wrapKey(secret), data.slice(12))
    return new Uint8Array(pv)
  } catch {
    return 'failed'
  }
}

/** Put a new `pv` (from the relays) behind the same lock; needs the computer lock once more. */
export async function rewrap(pv: Uint8Array): Promise<LockError | null> {
  const cred = local.get(CRED)
  const salt = local.get(SALT)
  if (!cred || !salt) return 'failed'
  const secret = await prfSecret(bytes(fromB64u(cred)), bytes(fromB64u(salt)))
  if (typeof secret === 'string') return secret
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, await wrapKey(secret), pv as BufferSource))
  local.set(WRAPPED, b64u(concat(nonce, ct)))
  return null
}

async function prfSecret(credId: Uint8Array, salt: Uint8Array): Promise<Uint8Array | LockError> {
  try {
    const a = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: credId as BufferSource }],
        userVerification: 'required',
        timeout: 120_000,
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null
    if (!a) return 'cancelled'
    const ext = a.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }
    const first = ext.prf?.results?.first
    return first ? new Uint8Array(first) : 'unsupported'
  } catch (e) {
    return errorOf(e)
  }
}

async function wrapKey(secret: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', secret as BufferSource, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: INFO },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function errorOf(e: unknown): LockError {
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'AbortError') return 'cancelled'
  if (name === 'NotSupportedError' || name === 'SecurityError') return 'unsupported'
  return 'failed'
}

function bytes(a: Int8Array): Uint8Array {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}
