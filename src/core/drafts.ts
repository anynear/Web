// Draft per conversation as in the app (DraftStore): the text survives switching and reloading, attachments switching.
// Like the history, the text lives only in this browser; after sending or clearing it is gone.
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

/** Attachments in the draft, only in the page's memory (files do not survive a reload). */
const files = new Map<ConvKey, unknown[]>()

export function draftFiles<T>(conv: ConvKey): T[] {
  return (files.get(conv) as T[] | undefined) ?? []
}

export function saveDraftFiles<T>(conv: ConvKey, list: T[]) {
  if (list.length) files.set(conv, list)
  else files.delete(conv)
}
