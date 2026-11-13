// Storage of the core (WebStorage from ANMP): localStorage with its own prefix. The keys lie there b64u under
// `secret:…`; hence a strict CSP in index.html and anynear only on one's own computer (text in pairing).
import type { WebStorage } from 'anmp-core'

const PREFIX = 'app:'

export function browserStorage(store: Storage = localStorage): WebStorage {
  return {
    getItem: (key: string) => store.getItem(PREFIX + key),
    setItem: (key: string, value: string | null | undefined) => (value == null ? store.removeItem(PREFIX + key) : store.setItem(PREFIX + key, value)),
  } as unknown as WebStorage
}

/** Own markers of the web app next to the core. */
export const local = {
  get: (key: string): string | null => localStorage.getItem(`${PREFIX}web:${key}`),
  set: (key: string, value: string | null) =>
    value == null ? localStorage.removeItem(`${PREFIX}web:${key}`) : localStorage.setItem(`${PREFIX}web:${key}`, value),
}

/** Delete everything of anynear in localStorage. */
export function clearStorage(store: Storage = localStorage) {
  for (const k of Object.keys(store)) if (k.startsWith(PREFIX)) store.removeItem(k)
}
