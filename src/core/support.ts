// Support as chat (as in the app): pure rules for circle name and texts, without core and DOM.

/**
 * Contact link of the support identity, like `SUPPORT_CONTACT_LINK` in the app (`AppConfig`). Without it (`null`) the
 * form shows „Der Support ist bald erreichbar.“ and sending is off. Link from the identity's web app (09.11.2026) with
 * mailbox key (field 8, ADR 0084); link for publishing,
 * write permission until 09.11.2027 (ADR 0084 §6); SUPPORT_LINK_URL is loaded first, this one here is the fallback.
 */
export const SUPPORT_CONTACT_LINK: string | null =
  'https://anynear.app/c#qAABAVggro9NwRU2zyAA-5xRZy0U48TOfL5kGHDZABeekQ1utVkCb2FueW5lYXIgU3VwcG9ydANYIMaQxOzgmTT_-VwDRC6yHLdYOya-uEp6TQTpodJKQ_q-BFggvcvp_7PbSPpvn7NZgwhMyP-xL9EQj1I4ME2zwQSYnXgFWCBcjZlP2w-YrAKcMHAyOoMOhXX-xldLtLkuesGNXF_1qAZYd4JYMqQBWCBcjZlP2w-YrAKcMHAyOoMOhXX-xldLtLkuesGNXF_1qAIEBRps0twtBhpq8ahxWECm6kvVaxdW8yYOgIVdDpEfBdGRTezljVWrNWbtpLYekP0Fzn01VUbkZC2--GJFmT05pgoG4BA__4O1Sd9m3uoDCFggQFwlvXXLrQTmBmyg9vtLWOhXUZrZv1UQwyVt24GS8wE'

/** Here the website provides the current support link (ADR 0084 §7); the built-in one is only a fallback. */
export const SUPPORT_LINK_URL = 'https://anynear.app/v1/support.json'

/** Name of the support identity; a loaded link with a different name is not accepted. */
export const SUPPORT_NAME = 'anynear Support'

/** Contact link from `/v1/support.json`, `null` on an unusable response. The core then checks network and name. */
export function parseSupportJson(text: string): string | null {
  try {
    const j = JSON.parse(text) as { version?: unknown; contact?: unknown }
    if (j.version !== 1 || typeof j.contact !== 'string') return null
    return /^https:\/\/anynear\.app\/c#[A-Za-z0-9_-]+$/.test(j.contact) ? j.contact : null
  } catch {
    return null
  }
}

/** Name limit of a circle in the core (`AnmpLinks.MAX_NAME`). */
export const MAX_CIRCLE_NAME = 40

/** Maximum length of the field „Worum geht es?“. */
export const MAX_SUBJECT = 80

export type SupportKind = 'bug' | 'question'

/** Shortens to [max] characters (by code points, so that no emoji breaks); shortened ends with „…“. */
export function truncateName(text: string, max: number): string {
  const chars = Array.from(text.trim())
  if (chars.length <= max) return chars.join('')
  return chars.slice(0, max - 1).join('').trimEnd() + '…'
}

/** Start of the name of every circle of a request, like `texts.support.circlePrefix` in the app. */
export const SUPPORT_CIRCLE_PREFIX = 'Support:'

/** Name of the circle for a request: `Support: <subject>`, shortened to the name limit. */
export function supportCircleName(subject: string, max = MAX_CIRCLE_NAME): string {
  return truncateName(`${SUPPORT_CIRCLE_PREFIX} ${subject.trim().replace(/\s+/g, ' ')}`, max)
}

/**
 * First message into the circle: kind, description, below it a line with version and platform.
 * [kindLabel] e.g. „Fehler“, [versionLine] e.g. „anynear 0.1.0 · Web (Firefox auf Mac)“.
 */
export function supportMessage(kindLabel: string, description: string, versionLine: string): string {
  return `${kindLabel}\n\n${description.trim()}\n\n${versionLine}`
}

/** Message directly to support: „Neue Anfrage: <subject>“ and the invitation link of the circle. */
export function supportInviteMessage(prefix: string, subject: string, inviteLink: string): string {
  return `${prefix}${subject.trim()}\n${inviteLink}`
}

/** Both mandatory fields filled in? */
export function supportFormComplete(subject: string, description: string): boolean {
  return subject.trim().length > 0 && description.trim().length > 0
}

// --- On the support identity: accept and report requests (ADR 0065, like `forwardSupportRequests` in the app) ---

/** Name of the own channel for alerts about new requests, like `AppConfig.SUPPORT_ALERT_CHANNEL`. */
export const SUPPORT_ALERT_CHANNEL = 'anynear-support'

/** Only requests from the last 7 days, not the whole history after pairing. */
export const SUPPORT_FORWARD_WINDOW = 7 * 24 * 60 * 60 * 1000

/** This many handled requests the browser remembers. */
export const SUPPORT_FORWARDED_MAX = 500

/** Beginnings of the direct message „Neue Anfrage: …“ in all languages (app: `newRequestPrefix`). */
export const NEW_REQUEST_PREFIXES = ['Neue Anfrage:', 'New request:']

/** The channel for alerts about requests: own, non-curated channel with the name [SUPPORT_ALERT_CHANNEL]. */
export function isSupportAlertChannel(c: { name: string; owner: boolean; curated: boolean }): boolean {
  return c.owner && !c.curated && c.name.trim().toLowerCase() === SUPPORT_ALERT_CHANNEL
}

/**
 * Subject of a new request if [text] is the direct message to support (first line „Neue Anfrage: <subject>“,
 * below it an invitation link with `/k#`); otherwise `null`.
 */
export function requestSubject(text: string, prefixes: string[] = NEW_REQUEST_PREFIXES): string | null {
  const lines = text.trim().split('\n')
  const first = lines[0] ?? ''
  const prefix = prefixes.find((p) => first.startsWith(p))
  if (prefix === undefined) return null
  if (!lines.slice(1).some((l) => l.includes('/k#'))) return null
  return first.slice(prefix.length).trim() || null
}

/** Invitation link in the direct message to support (the line with `/k#`), otherwise `null`. */
export function requestInvite(text: string): string | null {
  return text.split('\n').map((l) => l.trim()).find((l) => l.includes('/k#')) ?? null
}

export interface SupportRequest {
  id: string
  subject: string
  invite: string | null
  ts: number
}

/** New, not yet handled requests: incoming direct messages „Neue Anfrage: …“ since [since]. */
export function pendingRequests(
  messages: { id: string; conv: string; outgoing: boolean; text: string; ts: number }[],
  done: ReadonlySet<string>,
  since: number,
): SupportRequest[] {
  const out: SupportRequest[] = []
  for (const m of messages) {
    if (m.outgoing || !m.conv.startsWith('d:') || m.ts < since || done.has(m.id)) continue
    const subject = requestSubject(m.text)
    if (subject) out.push({ id: m.id, subject, invite: requestInvite(m.text), ts: m.ts })
  }
  return out
}

/**
 * Is the alert about a request already in the channel? The support identity can run on several devices (app and
 * browser); whoever reports first wins, the others do not report again.
 */
export function alreadyAlerted(
  alerts: { channelId: string; text: string; ts: number }[],
  channelId: string,
  text: string,
  requestTs: number,
): boolean {
  return alerts.some((a) => a.channelId === channelId && a.text.trim() === text.trim() && a.ts >= requestTs - 60_000)
}
