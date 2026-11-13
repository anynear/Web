// Acknowledged alerts („Gesehen“), as in the app (alerts/AlertAcks.kt): pure rules without core and DOM.
// Per alert ID a point in time in ms, positive = acknowledged, negative = shown again (absolute value = time). Applies
// to the person and reaches all own devices via the person's settings (ADR 0050, key [SETTING_KEY]).
// When merging, the later point in time wins per ID (larger absolute value). An alert that replaces another one has
// a new ID and therefore appears again.

export type Acks = Record<string, number>

/** Key in the person's settings, the same in app and web app. */
export const SETTING_KEY = 'alerts_acked'

/** Entries that are older are dropped; alerts live at most 30 days (ADR 0062). */
export const KEEP_MS = 30 * 24 * 60 * 60 * 1000

export function isAcked(acks: Acks, alertId: string): boolean {
  return (acks[alertId] ?? 0) > 0
}

export function ack(acks: Acks, alertId: string, now: number): Acks {
  return { ...acks, [alertId]: now }
}

export function unack(acks: Acks, alertId: string, now: number): Acks {
  return { ...acks, [alertId]: -now }
}

/** Per ID the later point in time wins; on a tie "acknowledged". */
export function mergeAcks(a: Acks, b: Acks): Acks {
  const out: Acks = { ...a }
  for (const [id, y] of Object.entries(b)) {
    const x = out[id]
    out[id] = x === undefined ? y : Math.abs(x) > Math.abs(y) ? x : Math.abs(y) > Math.abs(x) ? y : Math.max(x, y)
  }
  return out
}

/** Without entries that are older than [KEEP_MS]. */
export function pruneAcks(acks: Acks, now: number): Acks {
  return Object.fromEntries(Object.entries(acks).filter(([, t]) => now - Math.abs(t) <= KEEP_MS))
}

export function encodeAcks(acks: Acks): string {
  return JSON.stringify(acks)
}

/** Anything unreadable counts as empty, so that a broken value from another device blocks nothing. */
export function decodeAcks(text: string | null | undefined): Acks {
  if (!text) return {}
  try {
    const v: unknown = JSON.parse(text)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isInteger(e[1])))
  } catch {
    return {}
  }
}

export function sameAcks(a: Acks, b: Acks): boolean {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

/**
 * Take over the state from another device: merge and drop old entries. [writeBack]: the new state
 * differs from the received one and belongs back into the person's settings.
 */
export function takeRemoteAcks(local: Acks, received: Acks, now: number): { acks: Acks; writeBack: boolean } {
  const acks = pruneAcks(mergeAcks(local, received), now)
  return { acks, writeBack: !sameAcks(acks, received) }
}
