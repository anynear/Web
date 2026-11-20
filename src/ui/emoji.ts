// Emoji picker in the input (web only; on the phone the keyboard brings emoji): categories, search, recently used
// and inserting at the cursor. The names come from emojibase-data (vite.config.ts), loaded only when the picker opens.
import { textLeft } from '../core/messages'

export type Emoji = { emoji: string; group: number; label: string; search: string }

/** Categories in the order of Unicode (emojibase groups; 2 are skin tone components and left out). */
export const GROUPS = [
  { group: 0, key: 'smileys', icon: '😀' },
  { group: 1, key: 'people', icon: '👋' },
  { group: 3, key: 'animals', icon: '🐻' },
  { group: 4, key: 'food', icon: '🍎' },
  { group: 5, key: 'travel', icon: '🚗' },
  { group: 6, key: 'activities', icon: '⚽' },
  { group: 7, key: 'objects', icon: '💡' },
  { group: 8, key: 'symbols', icon: '❤️' },
  { group: 9, key: 'flags', icon: '🏁' },
] as const

export type GroupKey = (typeof GROUPS)[number]['key']

/** Lower case without accents, so that „tschuss“ finds „tschüss“ and „cafe“ finds „café“. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export function toEmojis(rows: readonly (readonly [string, number, string, string])[]): Emoji[] {
  return rows.map(([emoji, group, label, tags]) => ({ emoji, group, label, search: fold(`${label} ${tags}`) }))
}

/** Emoji whose name or search words contain every word of [query]; names starting with it first. */
export function searchEmojis(all: readonly Emoji[], query: string): Emoji[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const hits = all.filter((e) => words.every((w) => e.search.includes(w)))
  const first = words.join(' ')
  const rank = (e: Emoji) => {
    const name = fold(e.label)
    if (name === first) return 0
    if (name.startsWith(first)) return 1
    if (name.split(/[\s:,-]+/).some((w) => w.startsWith(words[0]))) return 2
    return 3
  }
  return hits.map((e, i) => ({ e, i, r: rank(e) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.e)
}

/** At most this many recently used emoji, newest first. */
export const RECENT_MAX = 24

export function addRecent(list: readonly string[], emoji: string, max = RECENT_MAX): string[] {
  return [emoji, ...list.filter((e) => e !== emoji)].slice(0, max)
}

/** Recently used emoji from a stored value; anything unreadable counts as none. */
export function parseRecent(stored: string | null): string[] {
  if (!stored) return []
  try {
    const v: unknown = JSON.parse(stored)
    return Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string' && e.length > 0 && e.length <= 32).slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

/**
 * Inserts [emoji] in place of the selection [start]..[end] of [text], whole or not at all: if the text would then be
 * longer than [max] characters (Unicode code points, as the counter counts), `null`. Returns the new text and the
 * cursor behind the emoji.
 */
export function insertEmoji(text: string, start: number, end: number, emoji: string, max: number): { text: string; caret: number } | null {
  const a = Math.max(0, Math.min(start, text.length))
  const b = Math.max(a, Math.min(end, text.length))
  const next = text.slice(0, a) + emoji + text.slice(b)
  if (textLeft(next, max) < 0) return null
  return { text: next, caret: a + emoji.length }
}
