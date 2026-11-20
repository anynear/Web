// Login links and names (ADR 0122) without the core, so tests can use them alone. See login.ts.
import { LINK_HOST } from './alerts'

/** Login link as deep link of the web app: path `/l`, request in the fragment; `null` otherwise. */
export function loginLinkFromUrl(pathname: string, hash: string): string | null {
  if (!/^\/l\/?$/.test(pathname) || !/^#[A-Za-z0-9_-]+$/.test(hash)) return null
  return `https://${LINK_HOST}/l${hash}`
}

/** Whether [text] holds a login link at all (also a broken one or of an unknown issuer). */
export function isLoginLink(text: string): boolean {
  return /anynear\.(app|net)\/l\/?#/.test(text)
}

/** Profile name shortened to fit „Dein Name dort“, like the app. */
export function defaultLoginName(name: string): string {
  const cps = Array.from(name.replace(/\s+/g, ' ').trim())
  return cps.slice(0, 40).join('').trim()
}

/** 1 to 40 characters without control characters, as the issuer takes it. */
export function loginNameOk(name: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return false
  const n = Array.from(name.replace(/\s+/g, ' ').trim()).length
  return n >= 1 && n <= 40
}

