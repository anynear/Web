// Own names for other people („Namen ändern“ on the person page), like ContactNames in the app: only for oneself, they
// cover the name from the person's profile everywhere (list, chat, circle members, notifications, search). They go to
// all own devices via the person's settings (ADR 0050, key [CONTACT_NAMES_SETTING]). Pure functions, without core and DOM.

/** Name of the person's setting; value: JSON `{ "<person ID>": { "n": "<own name>", "t": <change time ms> } }`. */
export const CONTACT_NAMES_SETTING = 'contact_names'

/** Own names are as long as own display names. */
export const MAX_CONTACT_NAME = 40

/** Own name [n], changed at [t]; empty: reset to the profile name („Zurücksetzen“, also goes to the other devices). */
export interface ContactNameEntry {
  n: string
  t: number
}

export type ContactNameEntries = Record<string, ContactNameEntry>

/** Anything unreadable counts as empty so that a broken value from another device blocks nothing. */
export function decodeContactNames(text: string | null | undefined): ContactNameEntries {
  const out: ContactNameEntries = {}
  try {
    const v = text ? JSON.parse(text) : {}
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    for (const [id, e] of Object.entries(v as Record<string, unknown>)) {
      if (!e || typeof e !== 'object') continue
      const { n, t } = e as { n?: unknown; t?: unknown }
      out[id] = { n: typeof n === 'string' ? n : '', t: typeof t === 'number' ? t : 0 }
    }
  } catch {
    return {}
  }
  return out
}

/** Per person the later change wins; on a tie the greater name, so that all devices end up the same (as in the app). */
export function mergeContactNames(a: ContactNameEntries, b: ContactNameEntries): ContactNameEntries {
  const out: ContactNameEntries = { ...a }
  for (const [id, y] of Object.entries(b)) {
    const x = out[id]
    if (!x || y.t > x.t || (y.t === x.t && y.n > x.n)) out[id] = y
  }
  return out
}

/** Whether [a] knows something [b] does not (another entry for some person). */
export function contactNamesDiffer(a: ContactNameEntries, b: ContactNameEntries): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if (a[k]?.n !== b[k]?.n || a[k]?.t !== b[k]?.t) return true
  return false
}

/** The own names in effect, person ID → name (resets left out). */
export function activeContactNames(entries: ContactNameEntries): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [id, e] of Object.entries(entries)) {
    const n = e.n.trim()
    if (n) out[id] = n
  }
  return out
}

/** The own name as it is stored: trimmed and at most [MAX_CONTACT_NAME] characters. */
export function cleanContactName(name: string): string {
  return [...name.trim()].slice(0, MAX_CONTACT_NAME).join('')
}

/**
 * Entries after giving [id] the name [name] at [now]; unchanged if the name stays the same. The time is strictly later
 * than the stored change, so that it also wins with a clock that is slightly behind.
 */
export function withContactName(entries: ContactNameEntries, id: string, name: string, now: number): ContactNameEntries {
  const n = cleanContactName(name)
  const current = entries[id]
  if ((current?.n ?? '') === n) return entries
  return { ...entries, [id]: { n, t: Math.max(now, (current?.t ?? 0) + 1) } }
}
