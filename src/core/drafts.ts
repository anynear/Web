// Draft per conversation as in the app (DraftStore): the text survives switching and reloading, attachments switching.
// Like the history, the text lives only in this browser; after sending or clearing it is gone.
import { signal } from '@preact/signals'
import type { ConvKey } from './messages'
import { local } from './storage'

const key = (conv: ConvKey) => `draft:${conv}`

export function draftText(conv: ConvKey): string {
  try {
    return local.get(key(conv)) ?? ''
  } catch {
    return ''
  }
}

export function saveDraftText(conv: ConvKey, text: string) {
  try {
    local.set(key(conv), text.trim() ? text : null)
  } catch {}
}

/** The draft came from „Weiterleiten“ (ADR 0118): it goes out marked „Weitergeleitet“. Kept like the text. */
export function draftPassedOn(conv: ConvKey): boolean {
  try {
    return local.get(`draftPassedOn:${conv}`) === '1'
  } catch {
    return false
  }
}

export function saveDraftPassedOn(conv: ConvKey, passedOn: boolean) {
  try {
    local.set(`draftPassedOn:${conv}`, passedOn ? '1' : null)
  } catch {}
}

/** Attachments in the draft, only in the page's memory (files do not survive a reload). */
const files = new Map<ConvKey, unknown[]>()

export function draftFiles<T>(conv: ConvKey): T[] {
  return (files.get(conv) as T[] | undefined) ?? []
}

export function saveDraftFiles<T>(conv: ConvKey, list: T[]) {
  if (list.length) files.set(conv, list)
  else files.delete(conv)
}

/**
 * Forwarded into a conversation („Weiterleiten“), not yet taken over by its input: the input adds it to its draft as soon
 * as the conversation is open, also when it is open already (it then keeps what it has and adds this below).
 */
const incoming = new Map<ConvKey, { text: string; files: unknown[] }>()
/** Counts up with every [addToDraft], so that an open input looks again. */
export const incomingDrafts = signal(0)

export function addToDraft<T>(conv: ConvKey, text: string, list: T[]) {
  const cur = incoming.get(conv)
  incoming.set(conv, { text: [cur?.text, text.trim()].filter(Boolean).join('\n'), files: [...(cur?.files ?? []), ...list] })
  incomingDrafts.value++
}

/** What was forwarded into [conv] since the last call; `null` if nothing. */
export function takeIncoming<T>(conv: ConvKey): { text: string; files: T[] } | null {
  const v = incoming.get(conv)
  if (!v) return null
  incoming.delete(conv)
  return v as { text: string; files: T[] }
}
