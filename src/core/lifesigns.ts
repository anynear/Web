// Signs of life (ADR 0083 §5), as the app shows them (lifesigns/LifeSigns.kt): start with templates in a circle of
// choice, the own card with „Alles gut“, the helpers' cards with hint and alarm. The deadlines come from the core;
// here are only view, templates and notifications. In the browser alarms are normal notifications (ADR 0062 §6), and
// they come only while the page is open.
import { batch, signal } from '@preact/signals'
import type { AliveStatus, AnmpCoreWeb } from 'anmp-core'
import { texts } from '../i18n'
import { formatDateTime, formatTime } from '../ui/format'
import { local } from './storage'

// Values as in the core (AliveStatus, AnmpAliveState, AnmpCareState); fixed in the protocol.
export const RUNNING = 1
export const ASK = 2
export const HINT = 3
export const ALARM = 4
export const ENDED = 5
export const REASON_MISSED = 1
export const STATE_BATTERY = 6
export const STATE_TIMEOUT = 7
export const LOOKING = 1
export const AWAY = 2
export const BACK = 3

const MINUTE = 60_000
const HOUR = 60 * MINUTE
/** Shortest time before asking (AliveLogic.MIN_QUIET) and once a day (MAX_QUIET). */
export const MIN_QUIET = 15 * MINUTE
export const MAX_QUIET = 24 * HOUR
/** The phone asks again after this (AliveLogic.ASK_AGAIN). */
const ASK_AGAIN = 2 * MINUTE

export type Template = 'work' | 'outside' | 'home' | 'daily' | 'custom'
export const TEMPLATES: Template[] = ['work', 'outside', 'home', 'daily', 'custom']

/** A sign of life for the view, times in ms. */
export interface LifeSign {
  id: string
  circleId: string
  owner: string
  label: string
  start: number
  until: number
  due: number
  lastAt: number
  confirmedAt: number
  state: number
  battery: number | null
  own: boolean
  phase: number
  reason: number
  looking: string[]
  away: string[]
  heard: string[]
  notArriving: boolean
  /** Where the owner's phone was when nobody confirmed, if the person allowed it (ADR 0121 §10); otherwise `null`. */
  place: LifeSignPlace | null
}

/** A place in degrees, when the phone located it (ms) and how accurate in metres, if known. */
export interface LifeSignPlace {
  latitude: number
  longitude: number
  at: number
  accuracy: number | null
}

/** „10 m“, „250 m“, „3 km“ (as formatAccuracy in the app): rounded so that it does not look more exact than it is. */
export function accuracyText(meters: number): string {
  return meters < 1000 ? texts.location.metres(Math.max(10, Math.floor((meters + 5) / 10) * 10)) : texts.location.kilometres(String(Math.floor((meters + 500) / 1000)))
}

/** The place on a map. The browser has no maps app, so it is OpenStreetMap; opened only by a button. */
export function mapLink(p: LifeSignPlace): string {
  const lat = p.latitude.toFixed(5)
  const lon = p.longitude.toFixed(5)
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`
}

export interface Request {
  label: string
  until: number
  quiet: number
  firstDue: number
  singleQuestion: boolean
}

/** Next full hour [hour] in local time after [now] plus [lead], e.g. „morgen um 7“ (as nextLocalHour in the app). */
export function nextLocalHour(now: number, hour: number, lead = 0): number {
  const d = new Date(now)
  d.setHours(hour, 0, 0, 0)
  if (d.getTime() <= now + lead) d.setDate(d.getDate() + 1)
  return d.getTime()
}

/** Values a template starts with (as LifeSigns.request in the app); [firstDue] 0 = after [quiet]. */
export function request(t: Template, now: number, customHours = 2, customMinutes = 30): Request {
  const l = texts.lifeSigns
  switch (t) {
    case 'work':
      return { label: l.templateWork, until: now + 8 * HOUR, quiet: 20 * MINUTE, firstDue: 0, singleQuestion: false }
    case 'outside':
      return { label: l.templateOutside, until: now + 2 * HOUR, quiet: 30 * MINUTE, firstDue: 0, singleQuestion: false }
    case 'home': {
      const morning = nextLocalHour(now, 7, MIN_QUIET)
      const quiet = Math.min(Math.max(morning - now, MIN_QUIET), MAX_QUIET)
      return { label: l.templateHome, until: morning + HOUR, quiet, firstDue: morning, singleQuestion: true }
    }
    case 'daily':
      return { label: l.templateDaily, until: now + 30 * 24 * HOUR, quiet: MAX_QUIET, firstDue: nextLocalHour(now, 10, MIN_QUIET), singleQuestion: false }
    case 'custom': {
      const hours = Math.min(Math.max(customHours, 1), 24)
      const minutes = Math.min(Math.max(customMinutes, 15), 24 * 60)
      return { label: l.templateCustom, until: now + hours * HOUR, quiet: minutes * MINUTE, firstDue: 0, singleQuestion: false }
    }
  }
}

export function viewOf(s: AliveStatus): LifeSign {
  const p = s.plan
  return {
    id: p.id,
    circleId: p.circleId,
    owner: p.owner,
    label: p.label,
    start: Number(p.start),
    until: Number(p.until),
    due: Number(p.due),
    lastAt: Number(p.lastAt),
    confirmedAt: Number(p.confirmedAt),
    state: p.state,
    battery: p.battery ?? null,
    own: s.own,
    phase: s.phase,
    reason: s.reason,
    looking: s.looking.asJsReadonlyArrayView().slice(),
    away: s.away.asJsReadonlyArrayView().slice(),
    heard: p.heard.asJsReadonlyArrayView().map((h) => h.person),
    notArriving: s.notArriving,
    place: p.position
      ? { latitude: p.position.latitude, longitude: p.position.longitude, at: Number(p.position.at), accuracy: p.position.accuracy ?? null }
      : null,
  }
}

/**
 * The alarm for a helper: „nicht bestätigt“ if the phone said so, otherwise „nicht erreichbar“. Both name the place
 * if one came along: with „nicht bestätigt“ (ADR 0121 §10) or with the alarm the phone left at the relays for the
 * case that it is switched off or has no network (ADR 0083 §5.7).
 */
export function alarmNotice(s: LifeSign, who: string, now: number): { title: string; body: string } {
  const l = texts.lifeSigns
  const missed = s.reason === REASON_MISSED
  const place = s.place ? ` ${l.placeIncluded(formatDateTime(s.place.at, now))}` : ''
  return {
    title: missed ? l.missedTitle(who) : l.unreachableTitle(who),
    body: (missed ? l.missedText : l.unreachableText(formatTime(s.lastAt))) + place,
  }
}

/** Own question „Alles gut?“: first at the due time, once more after 2 minutes ([shown]: last notice). */
export function askNotice(s: LifeSign, shown: string, now: number): { key: string; title: string; body: string } | null {
  if (!s.own || s.phase !== ASK) return null
  const l = texts.lifeSigns
  const first = `ask:${s.due}`
  const again = `ask2:${s.due}`
  if (shown !== first && shown !== again) return { key: first, title: l.askTitle, body: l.askText(s.label) }
  if (shown === first && now >= s.due + ASK_AGAIN) return { key: again, title: l.askTitle, body: l.askText(s.label) }
  return null
}

// --- State -------------------------------------------------------------------------------------------------

export type Notifier = (title: string, body: string, tag: string, requireInteraction: boolean) => void

interface Deps {
  nameOf: (person: string) => string
  /** Other persons in the circle, without the own one. */
  helpersOf: (circleId: string) => string[]
  me: () => string | null
  /** Support circles (ADR 0065) are no place for a check-in. */
  isSupport: (circleId: string) => boolean
}

export const lifeSigns = signal<LifeSign[]>([])
/** The big button over everything (ADR 0083 §5.2). */
export const fullScreen = signal(false)

let core: AnmpCoreWeb | null = null
let notifier: Notifier | null = null
let deps: Deps | null = null
let timer: ReturnType<typeof setTimeout> | undefined

export function startLifeSigns(c: AnmpCoreWeb, notify: Notifier, d: Deps) {
  core = c
  notifier = notify
  deps = d
  void evaluate()
}

/** From the core's event `AliveChanged`. */
export function onAliveChanged() {
  void evaluate()
}

/** Ask the core what is due, read the state anew, notify; then look again at the next time (at the latest in a minute). */
export async function evaluate() {
  if (!core) return
  clearTimeout(timer)
  try {
    await core.aliveTick()
  } catch {
    // Not reachable right now; the state is still read.
  }
  const now = Date.now()
  const list = core.aliveStatuses(now).map(viewOf)
  batch(() => {
    lifeSigns.value = list
    if (!list.some((s) => s.own && s.phase !== ENDED)) fullScreen.value = false
  })
  for (const s of list) notify(s, now)
  const next = core.aliveNextAt(now)
  const wait = next > 0 ? Math.min(Math.max(next - now, 1_000), 60_000) : 60_000
  timer = setTimeout(() => void evaluate(), wait)
}

function shownMap(): Record<string, string> {
  try {
    return JSON.parse(local.get('lifesigns.shown') ?? '{}')
  } catch {
    return {}
  }
}

function mark(id: string, value: string) {
  const all = Object.entries({ ...shownMap(), [id]: value }).slice(-50)
  local.set('lifesigns.shown', JSON.stringify(Object.fromEntries(all)))
}

/** Notifications as in the app: own question; helpers: start, hint, alarm, all good again, ended, battery. */
function notify(s: LifeSign, now: number) {
  if (!notifier || !deps) return
  const l = texts.lifeSigns
  const shown = shownMap()[s.id] ?? ''
  const tag = `alive:${s.id}`
  if (s.own) {
    const n = askNotice(s, shown, now)
    if (n) {
      notifier(n.title, n.body, tag, true)
      mark(s.id, n.key)
    } else if (s.phase !== ASK && shown.startsWith('ask')) {
      mark(s.id, `ok:${s.due}`)
    }
    return
  }
  const off = loudness(s.circleId) === 'off'
  const who = deps.nameOf(s.owner) || '?'
  const show = (title: string, body: string, value: string, important = false) => {
    if (!off) notifier!(title, body, tag, important)
    mark(s.id, value)
  }
  if (s.phase === ENDED) {
    if (shown && shown !== 'ended') show(s.state === STATE_TIMEOUT ? l.timedOut(who) : l.ended(who), l.endedText, 'ended')
  } else if (s.phase === RUNNING) {
    if (!shown) {
      // Older ones (e.g. from the history of a new circle) are taken over quietly.
      if (now - s.start < HOUR) show(l.started(who), l.startedText(s.label, formatTime(s.until)), 'start')
      else mark(s.id, 'start')
    } else if (shown.startsWith('hint') || shown.startsWith('alarm')) {
      show(l.confirmedAgain(who), '', `ok:${s.due}`)
    } else if (s.state === STATE_BATTERY && shown !== `battery:${s.lastAt}`) {
      show(l.battery(who, s.battery ?? 0), '', `battery:${s.lastAt}`)
    }
  } else if (s.phase === HINT) {
    if (shown !== `hint:${s.due}` && shown !== `alarm:${s.due}`) {
      show(s.reason === REASON_MISSED ? l.missedTitle(who) : l.hintTitle(who), l.hintText, `hint:${s.due}`)
    }
  } else if (s.phase === ALARM && shown !== `alarm:${s.due}`) {
    const n = alarmNotice(s, who, now)
    show(n.title, n.body, `alarm:${s.due}`, true)
  }
}


// --- Actions -----------------------------------------------------------------------------------------------

/** Notification of a sign of life tapped: section „Meldungen“, with the big button for an own one. */
export const openSection = signal(0)

export function openLifeSign() {
  openSection.value++
  if (lifeSigns.value.some((s) => s.own && s.phase !== ENDED)) fullScreen.value = true
}

export function defaultCircle(): string | null {
  return local.get('lifesigns.circle')
}

/**
 * Circles to choose from when starting (as LifeSigns.choices in the app): not removed, no support circle; also circles
 * where no other member is known yet, whoever is in it still gets the check-in.
 */
export function choices<C extends { id: string; removed: boolean }>(circles: C[], isSupport = (id: string) => deps?.isSupport(id) ?? false): C[] {
  return circles.filter((c) => !c.removed && !isSupport(c.id))
}

/** Preselected circle: the last one chosen, otherwise the first with known helpers, otherwise the first. */
export function preselect<C extends { id: string }>(list: C[], helperCount: (id: string) => number, last = defaultCircle()): string | null {
  return list.find((c) => c.id === last)?.id ?? list.find((c) => helperCount(c.id) > 0)?.id ?? list[0]?.id ?? null
}

export async function start(t: Template, circleId: string, customHours = 2, customMinutes = 30): Promise<boolean> {
  if (!core) return false
  const r = request(t, Date.now(), customHours, customMinutes)
  const plan = await core.startAlive(circleId, r.label, r.until, r.quiet, r.firstDue)
  if (!plan) return false
  local.set('lifesigns.circle', circleId)
  if (r.singleQuestion) local.set('lifesigns.single', JSON.stringify([...singles(), plan.id].slice(-20)))
  await evaluate()
  return true
}

function singles(): string[] {
  try {
    return JSON.parse(local.get('lifesigns.single') ?? '[]')
  } catch {
    return []
  }
}

/** „Alles gut“; with only one question it ends. */
export async function confirm(id: string) {
  if (!core) return
  if (singles().includes(id)) await core.endAlive(id)
  else await core.confirmAlive(id)
  await evaluate()
}

export async function end(id: string) {
  if (!core) return
  await core.endAlive(id)
  await evaluate()
}

export async function care(id: string, state: number) {
  if (!core) return
  await core.careAlive(id, state)
  await evaluate()
}

export function helpers(s: LifeSign): { all: string[]; heard: string[] } {
  const all = deps?.helpersOf(s.circleId) ?? []
  return { all, heard: s.heard.filter((p) => all.includes(p)) }
}

export function nameOf(person: string): string {
  return deps?.nameOf(person) || '?'
}

export function meAway(s: LifeSign): boolean {
  const me = deps?.me()
  return !!me && s.away.includes(me)
}

export type Loudness = 'loud' | 'normal' | 'off'

/** As in the app per circle on this device; the browser only knows normal notifications, „Aus“ silences them. */
export function loudness(circleId: string): Loudness {
  try {
    return (JSON.parse(local.get('lifesigns.loudness') ?? '{}')[circleId] as Loudness) ?? 'loud'
  } catch {
    return 'loud'
  }
}

export function setLoudness(circleId: string, value: Loudness) {
  let all: Record<string, Loudness> = {}
  try {
    all = JSON.parse(local.get('lifesigns.loudness') ?? '{}')
  } catch {
    // start fresh
  }
  local.set('lifesigns.loudness', JSON.stringify({ ...all, [circleId]: value }))
  lifeSigns.value = [...lifeSigns.value]
}
