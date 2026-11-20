// Invite someone by text message or email (like „Aus Telefonkontakten einladen“ in the app, ADR 0003): anynear has
// no directory of phone numbers. A number picked here only goes into the sms: link; it is never stored or sent.

/** Digits only, with a leading „+“ kept: „+49 (171) 123-45“ → „+4917112345“. Like `cleanPhoneNumber` in the app. */
export function cleanPhoneNumber(raw: string): string {
  const trimmed = raw.trim()
  const digits = trimmed.replace(/\D/g, '')
  return trimmed.startsWith('+') ? `+${digits}` : digits
}

/** The number to text: the first one with at least three digits. Like `smsNumber` in the app. */
export function smsNumber(phones: readonly string[]): string | null {
  for (const p of phones) {
    const n = cleanPhoneNumber(p)
    if (n.replace(/\D/g, '').length >= 3) return n
  }
  return null
}

/** sms: link with the text filled in; „?&body=“ is understood by Android and iOS alike. */
export function smsHref(number: string | null, text: string): string {
  return `sms:${number ?? ''}?&body=${encodeURIComponent(text)}`
}

/** mailto: link without recipient; the person chooses them in their mail program. */
export function mailHref(subject: string, text: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`
}

interface ContactPicker {
  select(properties: string[], options?: { multiple?: boolean }): Promise<{ tel?: string[] }[]>
}

/** Contact Picker API (Chrome on Android): the browser hands over only the chosen person, nothing else. */
export function contactPicker(): ContactPicker | null {
  const c = (typeof navigator !== 'undefined' ? (navigator as Navigator & { contacts?: ContactPicker }).contacts : undefined) ?? null
  return c && typeof c.select === 'function' ? c : null
}

/** Phone numbers of one person from the phone's contacts; `null` if canceled or not possible. */
export async function pickPhoneNumbers(): Promise<string[] | null> {
  const picker = contactPicker()
  if (!picker) return null
  try {
    const [person] = await picker.select(['tel'], { multiple: false })
    return person ? person.tel ?? [] : null
  } catch {
    return null
  }
}
