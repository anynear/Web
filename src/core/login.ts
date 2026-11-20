// Login with anynear at a service (ADR 0122, ANIP §10a), as in the app (ui/LoginUi.kt). Link, signature and the calls
// to the issuer come from the core (`AnmpCoreWeb.loginInfo`, `confirmLogin`); here only the deep link and the lock.
import { signal } from '@preact/signals'
import type { LoginInfo } from 'anmp-core'
import { hasLock, unlock } from './lock'
import { coreRef } from './session'

export { defaultLoginName, isLoginLink, loginLinkFromUrl, loginNameOk } from './loginLink'

/** Login link opened in the browser (`web.anynear.app/l#…`) or pasted, waiting for „Bei … anmelden?“. */
export const pendingLogin = signal<string | null>(null)

/** Status of `LoginResult` in the core; the strings are its constants. */
export type LoginStatus = 'ok' | 'wrong-number' | 'expired' | 'rejected' | 'too-many' | 'offline' | 'no-chain' | 'bad-name' | 'invalid' | 'locked'

export async function loginInfo(text: string): Promise<LoginInfo | LoginStatus> {
  const core = coreRef()
  const link = core?.parseLoginLink(text)
  if (!core || !link) return 'invalid'
  const info = await core.loginInfo(link)
  return info.status === 'ok' ? info : (info.status as LoginStatus)
}

/**
 * Confirms after the computer lock, where this browser has one (the lock of the passwords, ADR 0059); without it the
 * browser itself is the device, like when it was paired.
 */
export async function confirmLogin(info: LoginInfo, n: number, name: string): Promise<LoginStatus> {
  const core = coreRef()
  if (!core) return 'offline'
  if (hasLock()) {
    const r = await unlock()
    if (r === 'cancelled') return 'locked'
    if (typeof r === 'string') return 'locked'
  }
  const res = await core.confirmLogin(info, n, name)
  return res.status as LoginStatus
}
