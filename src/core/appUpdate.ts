// Update notice of the web app (ADR 0096, together with `clients.min` from ADR 0061 decision 13). The ANMP core reads
// the signed radio list and says for our build number: none, soon (with date) or required (from that date).
// The web app has one way to update: reload. „required“ reloads once by itself; if it is still old afterwards (the
// deployment is not out yet), only the notice stays (ADR 0096 §6, row „Webapp“).
import { local } from './storage'

export type UpdateKind = 'none' | 'soon' | 'required'

/** What the core says (`AnmpCoreWeb.webUpdate`). */
export interface WebUpdateState {
  kind: UpdateKind
  /** Unix milliseconds from when `min` applies; 0 if none. */
  from: number
}

/** Which notice the bar shows: `outdated` = „Bitte aktualisiere anynear“ (clients.min or still required after reloading). */
export type UpdateBanner = 'none' | 'soon' | 'outdated'

export interface UpdateDecision {
  banner: UpdateBanner
  /** Reload the page now (once, see [RELOAD_PAUSE]). */
  reload: boolean
}

/** At most one reload of its own per hour, so that a deployment that is not out yet never ends in a loop. */
export const RELOAD_PAUSE = 60 * 60 * 1000

export interface UpdateInput {
  update: WebUpdateState
  /** The relays require a newer protocol level (`clients.min`). */
  clientsMin: boolean
  now: number
  /** When this browser last reloaded by itself for „required“; null if never. */
  lastReload: number | null
  /** „Später“ on the notice with date: hidden until this time (start of the next day); 0 if not. */
  soonLaterUntil: number
}

/** Pure rule: notice and whether to reload. */
export function decideUpdate(i: UpdateInput): UpdateDecision {
  if (i.update.kind === 'required') {
    const reloadedRecently = i.lastReload !== null && i.now - i.lastReload >= 0 && i.now - i.lastReload < RELOAD_PAUSE
    if (!reloadedRecently) return { banner: 'outdated', reload: true }
    return { banner: 'outdated', reload: false }
  }
  if (i.clientsMin) return { banner: 'outdated', reload: false }
  if (i.update.kind === 'soon') return { banner: i.now < i.soonLaterUntil ? 'none' : 'soon', reload: false }
  return { banner: 'none', reload: false }
}

/** Start of the day after [now] (local time): until then „Später“ hides the notice with date. */
export function nextDay(now: number): number {
  const d = new Date(now)
  d.setHours(24, 0, 0, 0)
  return d.getTime()
}

/** Reads what the core returned; anything unknown counts as none. */
export function updateState(u: { kind: string; from: number } | null | undefined): WebUpdateState {
  const kind = u?.kind
  if (kind === 'soon' || kind === 'required') return { kind, from: Number.isFinite(u?.from) ? (u?.from ?? 0) : 0 }
  return { kind: 'none', from: 0 }
}

// Markers in the browser. Storage can be missing or blocked (private mode): then nothing is remembered.
const RELOAD_KEY = 'update-reload'
const SOON_KEY = 'update-later'

export function readMarkers(): Pick<UpdateInput, 'lastReload' | 'soonLaterUntil'> {
  let lastReload: number | null = null
  let soonLaterUntil = 0
  try {
    const r = Number(local.get(RELOAD_KEY))
    if (r > 0) lastReload = r
    soonLaterUntil = Number(local.get(SOON_KEY)) || 0
  } catch {}
  return { lastReload, soonLaterUntil }
}

/** „Später“: hides the notice with date until the next day. */
export function later(now = Date.now()) {
  try {
    local.set(SOON_KEY, String(nextDay(now)))
  } catch {}
}

/** Remembers the reload of its own; false if that is not possible (then do not reload, or it could loop). */
export function markReload(now = Date.now()): boolean {
  try {
    local.set(RELOAD_KEY, String(now))
    return Number(local.get(RELOAD_KEY)) === now
  } catch {
    return false
  }
}

/**
 * Loads the new version: asks the service worker for an update and waits (at most a few seconds) until a new one is
 * active, otherwise the reload would come from the old cache. The service worker takes over at once (`autoUpdate`,
 * skipWaiting); if it becomes active while waiting, `registerSW` reloads the page itself.
 */
export async function reloadToNewVersion(wait = 8000) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.update()
      const worker = reg.installing ?? reg.waiting
      if (worker) {
        await new Promise<void>((done) => {
          const timer = setTimeout(done, wait)
          const check = () => {
            if (worker.state === 'activated' || worker.state === 'redundant') {
              clearTimeout(timer)
              done()
            }
          }
          worker.addEventListener('statechange', check)
          check()
        })
      }
    }
  } catch {}
  location.reload()
}
