// Network status of a file (ADR 0028 §7), as in the app (data/PersonalFiles.kt, NetState): „Im Netz verteilt“ only
// from two providers on (core: StoredFile.secured). If a file was distributed once and no longer is now, that is
// called „Teilweise verteilt“. For this, this browser remembers the file IDs it has already seen backed up.
import { local } from './storage'

export type NetState = 'securing' | 'secured' | 'incomplete'

/** Key among the web app's own markers. */
export const SEEN_KEY = 'net-secured'

/** Remember at most this many IDs; the oldest are dropped first. */
export const MAX_SEEN = 5000

/** Pure rule: states per file ID and the IDs remembered afterwards (newly backed-up ones appended at the end). */
export function netStates(files: { file: string; secured: boolean }[], seen: string[]): { states: Map<string, NetState>; seen: string[] } {
  const known = new Set(seen)
  const added: string[] = []
  const states = new Map<string, NetState>()
  for (const f of files) {
    if (f.secured) {
      states.set(f.file, 'secured')
      if (!known.has(f.file)) {
        known.add(f.file)
        added.push(f.file)
      }
    } else {
      states.set(f.file, known.has(f.file) ? 'incomplete' : 'securing')
    }
  }
  const next = added.length ? [...seen, ...added].slice(-MAX_SEEN) : seen
  return { states, seen: next }
}

function readSeen(): string[] {
  try {
    const v = JSON.parse(local.get(SEEN_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** States for a freshly loaded list; remembers newly backed-up files in this browser. */
export function rememberNetStates(files: { file: string; secured: boolean }[]): Map<string, NetState> {
  const before = readSeen()
  const { states, seen } = netStates(files, before)
  if (seen !== before) {
    try {
      local.set(SEEN_KEY, JSON.stringify(seen))
    } catch {
      // Without storage (private window, full): then simply without "incomplete".
    }
  }
  return states
}
