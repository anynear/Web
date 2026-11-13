// Passwords in the browser (ADR 0059 §5, §6, following ADR 0039, 0048, 0052): the state lives with `pv` in the
// person's password space on the relays. It opens with the computer's lock (lock.ts, default) or, if that is missing
// or not at hand, with a confirmation on the phone. `pv` lives in the browser only behind the computer lock, the logins
// only in memory while unlocked. Every change first merges with the state of the relays and then stores it.
import { signal } from '@preact/signals'
import { VaultResult } from 'anmp-core'
import { createLock, forgetLock, hasLock, lockAvailable, rewrap, unlock, type LockError } from './lock'
import { local } from './storage'
import { b64u } from './messages'
import { coreRef, me, ownDataListeners, ownDevices, ownName, visible } from './session'
import { type Login, type Vault, deleteLogin, mergeVaults, openVault, sealVault, upsertLogin } from './vault'

export type PasswordState =
  /** Neither computer lock nor another own device: not possible here. */
  | { kind: 'unavailable' }
  /** This browser has no lock yet; [remote]: what lies on the relays; [computer]: lock of the computer usable. */
  | { kind: 'setup'; remote: 'found' | 'noKey' | 'empty' | 'later'; computer: boolean }
  /** [computer]: can be opened with the lock of this computer; otherwise only via the phone. */
  | { kind: 'locked'; computer: boolean }
  /** Waits for the confirmation on the phone. */
  | { kind: 'phone' }
  | { kind: 'unlocked'; logins: Login[] }

/** Topics of the data to own devices; the app answers `pv-ask` after the device lock (ADR 0059 §6). */
export const TOPIC_ASK = 'pv-ask'
export const TOPIC_OK = 'pv-ok'
export const TOPIC_NO = 'pv-no'
/** This long the browser waits for the phone. */
const PHONE_WAIT_MS = 120_000

/** How long the section stays open when one leaves it or the page is in the background (ADR 0048 item 6). */
const GRACE_MS = 180_000

export const passwordState = signal<PasswordState>({ kind: 'locked', computer: false })
export const passwordBusy = signal(false)
export const passwordError = signal<LockError | 'noKey' | 'later' | 'mismatch' | 'phoneDenied' | 'phoneTimeout' | 'noPhone' | null>(null)

let pv: Uint8Array | null = null
let vault: Vault = { logins: [], removed: [] }
/** Whether the section is open right now. */
let inArea = false
/** Since when (ms) nobody is looking (section left or page in the background); 0 as long as one is in the section. */
let awaySince = 0

function updateAway() {
  if (inArea && visible.value) awaySince = 0
  else if (!awaySince) awaySince = Date.now()
}

function graceOver(): boolean {
  return awaySince > 0 && Date.now() - awaySince > GRACE_MS
}

/** When opening the section: determine the state without unlocking. */
export async function enterPasswords() {
  if (graceOver()) lockNow()
  inArea = true
  updateAway()
  passwordError.value = null
  if (pv) return
  const computer = lockAvailable()
  if (!computer && !hasOtherDevice()) {
    passwordState.value = { kind: 'unavailable' }
    return
  }
  if (hasLock()) {
    passwordState.value = { kind: 'locked', computer: true }
    return
  }
  if (local.get('pv.phone')) {
    passwordState.value = { kind: 'locked', computer: false }
    return
  }
  passwordState.value = { kind: 'setup', remote: await remoteKind(), computer }
}

function hasOtherDevice(): boolean {
  return ownDevices.value.some((d) => d.deviceId !== me.value?.deviceId)
}

/** Leaving the section locks only after the grace period, e.g. for a short switch to a chat (ADR 0048 item 6). */
export function leavePasswords() {
  inArea = false
  updateAway()
}

export function lockNow() {
  pv = null
  vault = { logins: [], removed: [] }
  cancelPhone()
  if (passwordState.value.kind === 'unlocked' || passwordState.value.kind === 'phone') passwordState.value = { kind: 'locked', computer: hasLock() }
}

async function remoteKind(): Promise<'found' | 'noKey' | 'empty' | 'later'> {
  const r = await coreRef()?.vaultGet()
  if (!r) return 'later'
  if ((r as unknown) === VaultResult.Empty) return 'empty'
  if (r instanceof VaultResult.Found) return r.key ? 'found' : 'noKey'
  return 'later'
}

/** Set up: put `pv` from the relays (or a new one if nothing lies there) behind the computer lock. */
export async function setUpPasswords() {
  const core = coreRef()
  if (!core) return
  passwordBusy.value = true
  passwordError.value = null
  try {
    const r = await core.vaultGet()
    let key: Uint8Array
    let start: Vault = { logins: [], removed: [] }
    if (r instanceof VaultResult.Found) {
      if (!r.key) {
        passwordError.value = 'noKey'
        return
      }
      key = bytes(r.key)
      const opened = await openVault(key, bytes(r.data))
      if (!opened) {
        passwordError.value = 'mismatch'
        return
      }
      start = opened
    } else if ((r as unknown) === VaultResult.Empty) {
      // No state on the relays: new key, store it right away with an empty state (ADR 0048 item 2).
      key = crypto.getRandomValues(new Uint8Array(32))
    } else {
      passwordError.value = 'later'
      return
    }
    const err = await createLock(key, ownName.value)
    if (err) {
      passwordError.value = err
      // If the computer cannot do it after all, the phone remains.
      if (err === 'unsupported') passwordState.value = { kind: 'setup', remote: (r as unknown) === VaultResult.Empty ? 'empty' : 'found', computer: false }
      return
    }
    pv = key
    vault = start
    if ((r as unknown) === VaultResult.Empty) await push(vault, 0)
    show()
  } finally {
    passwordBusy.value = false
  }
}

/** Unlock with the computer lock and fetch the state of the relays. */
export async function unlockPasswords() {
  passwordBusy.value = true
  passwordError.value = null
  try {
    const r = await unlock()
    if (typeof r === 'string') {
      passwordError.value = r
      return
    }
    pv = r
    await pull()
    show()
  } finally {
    passwordBusy.value = false
  }
}

/** Take over the state of the relays; a different key there wins (ADR 0048 item 3). Returns its change time. */
async function pull(): Promise<number> {
  const core = coreRef()
  if (!core || !pv) return 0
  const r = await core.vaultGet()
  if (!(r instanceof VaultResult.Found)) return 0
  let opened = await openVault(pv, bytes(r.data))
  if (!opened && r.key) {
    const remoteKey = bytes(r.key)
    opened = await openVault(remoteKey, bytes(r.data))
    if (opened && !(await rewrap(remoteKey))) pv = remoteKey
  }
  if (!opened) {
    passwordError.value = 'mismatch'
    return Number(r.changed)
  }
  vault = mergeVaults(opened, vault)
  return Number(r.changed)
}

async function push(next: Vault, remoteChanged: number) {
  const core = coreRef()
  if (!core || !pv) return
  const sealed = await sealVault(pv, next)
  const changed = Math.max(Date.now(), remoteChanged + 1)
  await core.vaultPut(sealed as unknown as Int8Array, BigInt(changed), pv as unknown as Int8Array)
}

async function change(apply: (v: Vault) => Vault) {
  if (!pv) return
  passwordBusy.value = true
  try {
    const remoteChanged = await pull()
    vault = apply(vault)
    show()
    await push(vault, remoteChanged)
  } finally {
    passwordBusy.value = false
  }
}

export function saveLogin(login: { id: string; website: string; username: string; password: string; otp?: string }) {
  return change((v) => upsertLogin(v, login))
}

export function removeLogin(id: string) {
  return change((v) => deleteLogin(v, id))
}

/** Reload (e.g. page visible again) while unlocked. */
export async function refreshPasswords() {
  if (!pv) return
  await pull()
  show()
}

// --- Confirm on the phone (ADR 0059 §6) ----------------------------------------------------------------

let phoneWait: { nonce: string; done: (answer: 'ok' | 'no' | 'timeout') => void } | null = null

ownDataListeners.add((topic, data, fromDevice) => {
  if (!phoneWait || (topic !== TOPIC_OK && topic !== TOPIC_NO)) return
  if (b64u(data) !== phoneWait.nonce) return
  if (!ownDevices.value.some((d) => d.deviceId === fromDevice)) return
  phoneWait.done(topic === TOPIC_OK ? 'ok' : 'no')
})

function cancelPhone() {
  phoneWait?.done('no')
  phoneWait = null
}

/**
 * Have it confirmed on the phone: request to all other own devices, the app asks „Passwörter am Computer
 * öffnen?“ and confirms with the device lock. Then the browser fetches `pv` from the password space, only into memory.
 */
export async function unlockWithPhone() {
  const core = coreRef()
  if (!core) return
  passwordError.value = null
  if (!hasOtherDevice()) {
    passwordError.value = 'noPhone'
    return
  }
  const before = passwordState.value
  const nonce = crypto.getRandomValues(new Uint8Array(16))
  passwordState.value = { kind: 'phone' }
  const answer = new Promise<'ok' | 'no' | 'timeout'>((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), PHONE_WAIT_MS)
    phoneWait = {
      nonce: b64u(nonce),
      done: (a) => {
        clearTimeout(timer)
        resolve(a)
      },
    }
  })
  const sent = await core.sendOwnData(TOPIC_ASK, nonce as unknown as Int8Array, null)
  if (!sent) phoneWait?.done('timeout')
  const a = await answer
  phoneWait = null
  if (a !== 'ok') {
    if (passwordState.value.kind === 'phone') passwordState.value = before
    passwordError.value = a === 'no' ? 'phoneDenied' : 'phoneTimeout'
    return
  }
  passwordBusy.value = true
  try {
    const r = await core.vaultGet()
    if (r instanceof VaultResult.Found) {
      if (!r.key) {
        passwordError.value = 'noKey'
        passwordState.value = before
        return
      }
      const key = bytes(r.key)
      const opened = await openVault(key, bytes(r.data))
      if (!opened) {
        passwordError.value = 'mismatch'
        passwordState.value = before
        return
      }
      pv = key
      vault = opened
    } else if ((r as unknown) === VaultResult.Empty) {
      pv = crypto.getRandomValues(new Uint8Array(32))
      vault = { logins: [], removed: [] }
      await push(vault, 0)
    } else {
      passwordError.value = 'later'
      passwordState.value = before
      return
    }
    // Only remember "phone only" if the computer cannot do a lock; otherwise the computer stays the default.
    if (!hasLock() && !lockAvailable()) local.set('pv.phone', '1')
    show()
  } finally {
    passwordBusy.value = false
  }
}

/** Remove the lock in this browser (the logins stay on the relays and the other devices). */
export function forgetPasswordsHere() {
  lockNow()
  forgetLock()
  local.set('pv.phone', null)
  void enterPasswords()
}

function show() {
  passwordState.value = { kind: 'unlocked', logins: vault.logins }
}

function bytes(a: Int8Array): Uint8Array {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
}

// Grace period: section left or page in the background, open for 180 s, then locked; on coming back the
// elapsed time applies.
visible.subscribe((v) => {
  if (v && graceOver()) lockNow()
  else if (v && pv) void refreshPasswords()
  updateAway()
})
setInterval(() => {
  if (pv && graceOver()) lockNow()
}, 15_000)
