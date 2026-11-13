// Attachments via their plaintext hash: "whoever has it delivers it" (ADR 0014, 0088), as `AttachmentWants` in the app.
// Attachments lie 30 days at the relays; after that a device that still has one puts it again on a `want`. Pure
// functions, without core and DOM.

import type { Att, ConvKey, Msg } from './messages'
import { b64u } from './messages'

/** Pause between two `want` for the same hash, as `WANT_PAUSE` in the app. */
export const WANT_PAUSE_MS = 10 * 60 * 1000

/** Hash of an attachment: first 16 bytes of SHA-256 over the plaintext, b64u (as with pictures, ADR 0014). */
export async function attachmentHash(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
  return b64u(digest.subarray(0, 16))
}

/** Attachments of the conversation [conv] with hash [hash]: only these may be given to someone asking there. */
export function shareable(list: Msg[], hash: string, conv: ConvKey): Att[] {
  return list.filter((m) => m.conv === conv && !m.deleted).flatMap((m) => attachmentsOf(m).filter((a) => a.hash === hash))
}

/** Attachments with hash [hash] in any message (one `have` fills all of them). */
export function waiting(list: Msg[], hash: string): Att[] {
  return list.filter((m) => !m.deleted).flatMap((m) => attachmentsOf(m).filter((a) => a.hash === hash))
}

/** `true` if a `want` for [hash] may go out now; then remembers the time in [askedAt]. */
export function mayAsk(askedAt: Map<string, number>, hash: string, now: number): boolean {
  const last = askedAt.get(hash)
  if (last !== undefined && now - last < WANT_PAUSE_MS) return false
  askedAt.set(hash, now)
  return true
}

function attachmentsOf(m: Msg): Att[] {
  return m.link?.image ? [...m.attachments, m.link.image] : m.attachments
}
