// SOS contacts say yes once (ADR 0121 §25): a person asks to be woken by our calls; we answer yes, no or later. The
// answer goes to the person alone, and through the profile space to every own device, so the phone rings loudly only
// for persons we agreed to. The browser itself never rings; it only answers and shows.
import { signal } from '@preact/signals'
import type { AnmpCoreWeb } from 'anmp-core'

export interface SosAskView {
  person: string
  at: number
  circleId: string | null
}

/** Persons asking us, not answered yet. */
export const sosAsks = signal<SosAskView[]>([])

/** Persons we said yes to. */
export const sosAgreed = signal<string[]>([])

/** „Später“: not asked again in this page until opened from the list. */
export const askedLater = signal<string[]>([])

let core: AnmpCoreWeb | null = null

export function startSos(c: AnmpCoreWeb) {
  core = c
  refreshSos()
}

/** Reads the state from the core (after start, `SosAsked`, `SosContactsChanged`, a new profile). */
export function refreshSos() {
  const c = core
  if (!c) return
  try {
    sosAsks.value = c.sosAsks().map((a) => ({ person: a.person, at: Number(a.at), circleId: a.circleId ?? null }))
    sosAgreed.value = c.sosAgreed().slice()
  } catch {
    // An older core without the functions: nothing to show.
  }
}

/** The question shown right now: the oldest one not put off. */
export function currentAsk(asks: SosAskView[], later: string[]): SosAskView | null {
  return asks.find((a) => !later.includes(a.person)) ?? null
}

export function askLater(person: string) {
  if (!askedLater.value.includes(person)) askedLater.value = [...askedLater.value, person]
}

/** From the list of open questions: show it again. */
export function askNow(person: string) {
  askedLater.value = askedLater.value.filter((p) => p !== person)
}

/** Yes or no to [person], also later to take a yes back. `false` if it did not go out. */
export async function answerSos(person: string, agree: boolean): Promise<boolean> {
  const c = core
  if (!c) return false
  const ok = await c.answerSosAsk(person, agree).catch(() => false)
  if (ok) askNow(person)
  refreshSos()
  return ok
}

/** Does a call of [person] count as one we agreed to (ADR 0121 §25)? Only then may it be urgent. */
export function agreedTo(person: string): boolean {
  return sosAgreed.peek().includes(person)
}
