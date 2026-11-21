// Who sees where the person is (ADR 0121 §3, §27–§29), as LocationSharing in the app. The levels are settings of the
// person on all its devices (ADR 0106): the browser reads and changes them, the phone acts on them. The browser itself
// sends no place: a browser does not locate in the background (ADR 0121, Folgen).
//
// Sharing with each other (§28) is kept here like on the phone: what both agreed on, what held before asking, and what
// one showed before the other side lowered. Those stay in this browser, as they stay on the phone in the app.

/** The four levels (ADR 0121 §24): every level includes the ones before. */
export type Level = 'off' | 'when' | 'area' | 'exact'

export const LEVELS: Level[] = ['off', 'when', 'area', 'exact']

/** The level in ANMP (`AnmpPlace`). */
export function wireOf(level: Level): number {
  return LEVELS.indexOf(level)
}

export function levelOfWire(wire: number): Level {
  return LEVELS[wire] ?? 'off'
}

/** The others see something all the time, not only when something is wrong. */
export function always(level: Level | null | undefined): boolean {
  return level === 'area' || level === 'exact'
}

/** `null` for nothing stored; a level a newer version set that this one does not know is at least „Nur bei SOS“. */
export function levelOf(id: string | null | undefined): Level | null {
  if (!id) return null
  return (LEVELS as string[]).includes(id) ? (id as Level) : 'when'
}

/** Names of the settings in the profile space, as SettingsSync of the app writes them. */
export const KEYS = {
  default: 'kv:location.share',
  circles: 'kv:location.share.circles',
  persons: 'kv:location.share.persons',
  until: 'kv:location.share.until',
  paused: 'kv:location.share.paused',
  approved: 'kv:location.share.approved',
} as const

/** A stored value as the app writes it: `1<value>`, or `0` for removed; `undefined` if unreadable. */
export function decodeSetting(raw: string | null | undefined): string | null | undefined {
  if (raw == null) return null
  if (raw === '0') return null
  if (raw.startsWith('1')) return raw.slice(1)
  return undefined
}

export function encodeSetting(value: string | null): string {
  return value == null ? '0' : `1${value}`
}

export interface SharingState {
  /** For everyone; `null`: the question was never answered (then nobody sees anything). */
  default: Level | null
  /** Circles set apart from [default]. */
  circles: Record<string, Level>
  /** Persons set apart from their circles. */
  persons: Record<string, Level>
  /** `c:<circle>` / `p:<person>` → until when (ms) its own setting holds. */
  until: Record<string, number>
  paused: boolean
  /** Persons who may see the place all the time through a circle (ADR 0121 §5). */
  approved: string[]
}

export const EMPTY: SharingState = { default: null, circles: {}, persons: {}, until: {}, paused: false, approved: [] }

function levelMap(text: string | null): Record<string, Level> {
  if (!text) return {}
  try {
    const out: Record<string, Level> = {}
    for (const [k, v] of Object.entries(JSON.parse(text) as Record<string, string>)) {
      const l = levelOf(v)
      if (l) out[k] = l
    }
    return out
  } catch {
    return {}
  }
}

function untilMap(text: string | null): Record<string, number> {
  if (!text) return {}
  try {
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(JSON.parse(text) as Record<string, string>)) {
      const n = Number(v)
      if (Number.isFinite(n)) out[k] = n
    }
    return out
  } catch {
    return {}
  }
}

/** Takes the settings in [values] (name → stored value as the app writes it) into [state]; others stay. */
export function takeSettings(state: SharingState, values: ReadonlyMap<string, string | null>): SharingState {
  let next = state
  const get = (key: string) => {
    if (!values.has(key)) return undefined
    return decodeSetting(values.get(key))
  }
  const d = get(KEYS.default)
  if (d !== undefined) next = { ...next, default: levelOf(d) }
  const c = get(KEYS.circles)
  if (c !== undefined) next = { ...next, circles: levelMap(c) }
  const p = get(KEYS.persons)
  if (p !== undefined) next = { ...next, persons: levelMap(p) }
  const u = get(KEYS.until)
  if (u !== undefined) next = { ...next, until: untilMap(u) }
  const z = get(KEYS.paused)
  if (z !== undefined) next = { ...next, paused: z === '1' }
  const a = get(KEYS.approved)
  if (a !== undefined) next = { ...next, approved: (a ?? '').split(',').filter((x) => x) }
  return next
}

/** An own setting counts until its time is over. */
function held(s: SharingState, key: string, level: Level | undefined, now: number): Level | null {
  if (!level) return null
  const t = s.until[key]
  return t == null || t > now ? level : null
}

/** What the members of [circleId] see: its own setting, otherwise the one for everyone. */
export function circleLevel(s: SharingState, circleId: string, now: number): Level {
  return held(s, `c:${circleId}`, s.circles[circleId], now) ?? s.default ?? 'off'
}

/** The circle's own setting, if it has one that still holds. */
export function ownCircleLevel(s: SharingState, circleId: string, now: number): Level | null {
  return held(s, `c:${circleId}`, s.circles[circleId], now)
}

/** The person's own setting, if it has one that still holds. */
export function ownPersonLevel(s: SharingState, personId: string, now: number): Level | null {
  return held(s, `p:${personId}`, s.persons[personId], now)
}

/**
 * What [personId] sees, who is in [circleIds] with us, as `levelFor` in the app: nothing while paused (unless
 * [evenPaused]); the person's own setting; otherwise the most any of its circles gives. Seeing the place all the time
 * through a circle needs the ok for this person; without it the person stays at „Nur bei SOS“.
 */
export function levelFor(s: SharingState, personId: string, circleIds: string[], now: number, evenPaused = false): Level {
  if (s.paused && !evenPaused) return 'off'
  const own = ownPersonLevel(s, personId, now)
  if (own) return own
  const most = circleIds.length ? circleIds.map((c) => circleLevel(s, c, now)).reduce((a, b) => (wireOf(b) > wireOf(a) ? b : a)) : (s.default ?? 'off')
  return always(most) && !s.approved.includes(personId) ? 'when' : most
}

/**
 * Where the person and someone else stand with each other, for „Standort freigeben“ (ADR 0121 §28), as `Between` in
 * the app: [mine] what the person shows, [theirs] what the other shows back, [agreed] what both agreed on, [open]
 * while the own question has no answer yet.
 */
export interface Between {
  mine: Level
  theirs: Level
  agreed: Level | null
  open: boolean
  /** Something is shared all the time in either direction, agreed on or asked for: there is a sharing to show. */
  exists: boolean
  /** The level both show each other all the time, the lower of the two; `null` if one of them does not. */
  both: Level | null
  /** The levels it still makes sense to ask for: those above what both show already. Empty: nothing more to ask. */
  askable: Level[]
  /** The level to start the choice at: never below what the person shows already, so asking does not lower it. */
  suggested: Level | null
}

export function betweenOf(mine: Level, theirs: Level, agreed: Level | null, open: boolean): Between {
  const both = always(mine) && always(theirs) ? (wireOf(mine) <= wireOf(theirs) ? mine : theirs) : null
  const askable = (['area', 'exact'] as Level[]).filter((l) => wireOf(l) > wireOf(both ?? 'off'))
  const suggested = askable.find((l) => wireOf(l) >= wireOf(mine)) ?? askable[askable.length - 1] ?? null
  return { mine, theirs, agreed, open, exists: always(mine) || always(theirs) || agreed != null || open, both, askable, suggested }
}

/** Where the settings go: the profile space through the core. */
export interface SharingStore {
  write(name: string, value: string): void
}

/** Small values kept in this browser (as the device settings of the app). */
export interface LocalStore {
  get(key: string): string | null
  set(key: string, value: string | null): void
}

const MUTUAL = 'location.mutual.before.'
const OPEN = 'location.mutual.open.'
const AGREED = 'location.mutual.agreed.'
const KEPT = 'location.mutual.kept.'
const NONE = '-'

/**
 * The changes, on top of a [SharingState]. Every change writes the setting and hands back the new state, so that the
 * page shows it at once; the phone takes it from the profile space.
 */
export class Sharing {
  state: SharingState = EMPTY

  constructor(
    private readonly store: SharingStore,
    private readonly local: LocalStore,
    /** The person lowered what it shows [personId] below what both agreed on; [wire] is what it shows now, 0 for nothing. */
    public onLowered: (personId: string, wire: number) => void = () => {},
    private readonly changed: (s: SharingState) => void = () => {},
  ) {}

  private set(next: SharingState) {
    this.state = next
    this.changed(next)
  }

  private writeMap(key: string, map: Record<string, Level>) {
    this.store.write(key, encodeSetting(Object.keys(map).length ? JSON.stringify(map) : null))
  }

  private setUntil(key: string, untilMillis: number) {
    const next = { ...this.state.until }
    if (untilMillis > 0) next[key] = untilMillis
    else delete next[key]
    if (JSON.stringify(next) === JSON.stringify(this.state.until)) return
    const asText: Record<string, string> = {}
    for (const [k, v] of Object.entries(next)) asText[k] = String(v)
    this.store.write(KEYS.until, encodeSetting(Object.keys(next).length ? JSON.stringify(asText) : null))
    this.set({ ...this.state, until: next })
  }

  /** The level for everyone. */
  setDefault(level: Level) {
    this.store.write(KEYS.default, encodeSetting(level))
    this.set({ ...this.state, default: level })
  }

  /** Sets [circleId] apart from everyone; `null` or the level for everyone itself: follow it again. */
  setCircle(circleId: string, level: Level | null, members: string[] = []) {
    const next = { ...this.state.circles }
    if (level == null || level === this.state.default) delete next[circleId]
    else next[circleId] = level
    this.writeMap(KEYS.circles, next)
    this.set({ ...this.state, circles: next })
    this.setUntil(`c:${circleId}`, 0)
    if (always(level)) this.approve(members)
  }

  /**
   * Sets what [personId] sees, apart from its circles; `null`: follow the circles again. Lowering it below what both
   * agreed on ends or lowers the agreement for both ([onLowered], ADR 0121 §28). [quiet]: a step of the page itself,
   * which tells nobody; a `null` then goes back to what both agreed on, if anything.
   */
  setPerson(personId: string, level: Level | null, quiet = false) {
    const set = level ?? (quiet ? this.agreed(personId) : null)
    const next = { ...this.state.persons }
    if (set == null) delete next[personId]
    else next[personId] = set
    this.writeMap(KEYS.persons, next)
    this.set({ ...this.state, persons: next })
    this.setUntil(`p:${personId}`, 0)
    if (quiet) return
    this.local.set(KEPT + personId, null)
    const agreed = this.agreed(personId)
    if (!agreed) return
    const shown = always(set) ? set : null
    if (wireOf(shown ?? 'off') >= wireOf(agreed)) return
    // The person lowers what it shows: the agreement holds at most that from now on, and the other side is told.
    this.setAgreed(personId, shown)
    if (shown == null) this.local.set(MUTUAL + personId, null)
    this.onLowered(personId, shown ? wireOf(shown) : 0)
  }

  /** „Alles pausieren“ (ADR 0121 §29): nothing goes out and nothing new is shown; the settings stay. */
  setPaused(paused: boolean) {
    this.store.write(KEYS.paused, encodeSetting(paused ? '1' : null))
    this.set({ ...this.state, paused })
  }

  /** These persons may see the place all the time through a circle (ADR 0121 §5). */
  approve(personIds: string[]) {
    const next = [...new Set([...this.state.approved, ...personIds])].sort()
    if (next.join(',') === [...this.state.approved].sort().join(',')) return
    this.store.write(KEYS.approved, encodeSetting(next.length ? next.join(',') : null))
    this.set({ ...this.state, approved: next })
  }

  /** What the person and [personId] agreed to show each other, as far as this browser knows it. */
  agreed(personId: string): Level | null {
    const l = levelOf(this.local.get(AGREED + personId))
    return always(l) ? l : null
  }

  private setAgreed(personId: string, level: Level | null) {
    this.local.set(AGREED + personId, level)
  }

  private before(personId: string): Level | null {
    return levelOf(this.local.get(MUTUAL + personId)?.replace(NONE, '') || null)
  }

  private rememberBefore(personId: string) {
    if (this.local.get(MUTUAL + personId) == null) this.local.set(MUTUAL + personId, this.state.persons[personId] ?? NONE)
  }

  /**
   * Where the person and [personId] stand with each other (see [Between]): what it shows through [circleIds] or its
   * own setting, what [theirs] shows back, and what this browser knows of an agreement or an open question.
   */
  between(personId: string, circleIds: string[], theirs: Level | null, now: number): Between {
    return betweenOf(levelFor(this.state, personId, circleIds, now), theirs ?? 'off', this.agreed(personId), this.mutualOpen(personId))
  }

  /** „Standort freigeben“: the person shows [personId] its place at [level] from now on and asks for the same. */
  askMutual(personId: string, level: Level) {
    this.rememberBefore(personId)
    this.local.set(OPEN + personId, '1')
    this.approve([personId])
    this.setPerson(personId, level, true)
  }

  /** `true` while the own question to [personId] has no answer yet. */
  mutualOpen(personId: string): boolean {
    return this.local.get(OPEN + personId) != null
  }

  /** [personId] answered the own question with [wire] (0 for no): after a no, back to what held before asking. */
  mutualAnswered(personId: string, wire: number) {
    if (!this.mutualOpen(personId)) return
    this.local.set(OPEN + personId, null)
    const to = levelOfWire(wire)
    if (!always(to)) {
      const back = this.before(personId)
      this.local.set(MUTUAL + personId, null)
      this.setAgreed(personId, null)
      this.setPerson(personId, back, true)
      return
    }
    this.setAgreed(personId, to)
    if (wireOf(this.state.persons[personId] ?? 'off') > wireOf(to)) this.setPerson(personId, to, true)
  }

  /** The person says yes to the question of [personId], at [level]: both show each other that from now on. */
  agreeMutual(personId: string, level: Level) {
    this.rememberBefore(personId)
    this.approve([personId])
    this.setAgreed(personId, level)
    this.setPerson(personId, level, true)
  }

  /**
   * [personId] lowered what it shows to [wire] (0 for nothing): the person shows the same from now on. What it showed
   * is kept for „Weiter zeigen“. `false` if there was no agreement above [wire].
   */
  remoteLowered(personId: string, wire: number): boolean {
    const agreed = this.agreed(personId)
    if (!agreed) return false
    const to = always(levelOfWire(wire)) ? levelOfWire(wire) : null
    if (wireOf(to ?? 'off') >= wireOf(agreed)) return false
    const shown = this.state.persons[personId]
    if (shown) this.local.set(KEPT + personId, shown)
    this.setAgreed(personId, to)
    if (to == null) {
      const back = this.before(personId)
      this.local.set(MUTUAL + personId, null)
      this.setPerson(personId, back, true)
    } else if (wireOf(this.state.persons[personId] ?? 'off') > wireOf(to)) {
      this.setPerson(personId, to, true)
    }
    return true
  }

  /** What the person showed [personId] before the other side lowered, while „Weiter zeigen“ is on offer. */
  kept(personId: string): Level | null {
    return levelOf(this.local.get(KEPT + personId))
  }

  /** „Weiter zeigen“: the person shows [personId] again what it showed, on its own. */
  keepShowing(personId: string) {
    const level = this.kept(personId)
    if (!level) return
    this.local.set(KEPT + personId, null)
    this.setPerson(personId, level, true)
  }
}
