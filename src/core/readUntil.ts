// Read up to a point per conversation, for the person on all own devices (setting `read_until`, like ReadUntil in the
// app). A device back from the emergency card or newly added takes it over, so the messages that come back are unread
// only where they were unread before (ADR 0107 §8). Pure functions, without core and DOM.

import type { ConvKey } from './messages'

/** Name of the person's setting (ADR 0050); value: JSON `{ "<conversation key>": <send time ms> }`. */
export const READ_UNTIL_SETTING = 'read_until'

export type ReadMarks = Record<ConvKey, number>

/** Anything unreadable counts as empty so that a broken value from another device blocks nothing. */
export function decodeMarks(text: string | null | undefined): ReadMarks {
  const out: ReadMarks = {}
  try {
    const v = text ? JSON.parse(text) : {}
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, at] of Object.entries(v)) if (typeof at === 'number') out[k] = at
  } catch {
    return {}
  }
  return out
}

/** Per conversation the later point in time wins. */
export function mergeMarks(a: ReadMarks, b: ReadMarks): ReadMarks {
  const out: ReadMarks = { ...a }
  for (const [k, at] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, at)
  return out
}

/** Whether [a] knows something [b] does not (a later time for some conversation). */
export function hasNewer(a: ReadMarks, b: ReadMarks): boolean {
  return Object.entries(a).some(([k, at]) => at > (b[k] ?? 0))
}

/**
 * Whether a received message with send time [sentAt] that comes back while its conversation still loads counts as read:
 * up to the conversation's [mark]; without one (never read since this was introduced), everything sent before
 * [loadingSince], the moment this device began to load. Send times are whole seconds: one from the second loading began
 * counts as sent after it.
 */
export function readOnArrival(sentAt: number, mark: number | undefined, loadingSince: number): boolean {
  return mark !== undefined ? sentAt <= mark : sentAt < loadingSince - (loadingSince % 1000)
}
