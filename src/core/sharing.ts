// Who sees where the person is (ADR 0121 §3, §27–§29), as LocationSharing in the app. The levels are settings of the
// person on all its devices (ADR 0106): the browser reads and changes them, the phone acts on them. The browser itself
// sends no place: a browser does not locate in the background (ADR 0121, Folgen).
//
// „Standort freigeben“ (ADR 0123) is kept by the core from the cards in the chat, on every own device; [shared] gives
// its level here. What this browser kept itself before moves into the core once ([Sharing.migrateMutual]).

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
export function levelFor(s: SharingState, personId: string, circleIds: string[], now: number, evenPaused = false, shared: Level | null = null): Level {
  if (s.paused && !evenPaused) return 'off'
  const base = ownPersonLevel(s, personId, now) ?? circleLevelFor(s, personId, circleIds, now)
  // A sharing both agreed on gives at least its level (ADR 0123 §8).
  return shared && wireOf(shared) > wireOf(base) ? shared : base
}

/** What [personId] sees through [circleIds] alone: a person's own setting may only be lower (ADR 0123 §8). */
export function circleLevelFor(s: SharingState, personId: string, circleIds: string[], now: number): Level {
  const most = circleIds.length ? circleIds.map((c) => circleLevel(s, c, now)).reduce((a, b) => (wireOf(b) > wireOf(a) ? b : a)) : (s.default ?? 'off')
  return always(most) && !s.approved.includes(personId) ? 'when' : most
}

/**
 * Where the person and someone else stand with each other, for „Standort freigeben“ (ADR 0123 §7), as `Between` in
 * the app: [mine] what the person shows, [theirs] what the other shows back, [shared] the sharing both agreed on,
 * [asked] an open question (by the own person if [askedByUs]).
 */
export interface Between {
  mine: Level
  theirs: Level
  shared: Level | null
  asked: Level | null
  askedByUs: boolean
  /** A sharing holds or a question waits. */
  exists: boolean
  /** The levels it makes sense to ask for: not the one shared, not the one asked for. */
  askable: Level[]
  /** The level to start the choice at: never below what the person shows already. */
  suggested: Level | null
}

export function betweenOf(mine: Level, theirs: Level, shared: Level | null, asked: Level | null = null, askedByUs = false): Between {
  const askable = (['area', 'exact'] as Level[]).filter((l) => l !== shared && l !== asked)
  const suggested = askable.find((l) => wireOf(l) >= wireOf(mine)) ?? askable[askable.length - 1] ?? null
  return { mine, theirs, shared, asked, askedByUs, exists: shared != null || asked != null, askable, suggested }
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
   * Sets what [personId] sees, apart from its circles; `null`: follow the circles again. More than the circles give
   * goes only through „Standort freigeben“ (ADR 0123 §8); that one is not touched here.
   */
  setPerson(personId: string, level: Level | null) {
    const next = { ...this.state.persons }
    if (level == null) delete next[personId]
    else next[personId] = level
    this.writeMap(KEYS.persons, next)
    this.set({ ...this.state, persons: next })
    this.setUntil(`p:${personId}`, 0)
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

  /**
   * Where the person and [personId] stand with each other (see [Between]): what it shows through [circleIds], its own
   * setting or the [shared] level, what [theirs] shows back, and an open question.
   */
  between(personId: string, circleIds: string[], theirs: Level | null, now: number, shared: Level | null = null, asked: Level | null = null, askedByUs = false): Between {
    return betweenOf(levelFor(this.state, personId, circleIds, now, false, shared), theirs ?? 'off', shared, asked, askedByUs)
  }

  /**
   * What this browser kept itself before the sharing moved into the core (ADR 0123 §9): per person in [ids] the
   * agreed level and an own open question; [adopt] hands each to the core, then what was shown for it goes back to
   * what held before, and the old keys are gone. A failure keeps them for the next start.
   */
  async migrateMutual(ids: string[], adopt: (personId: string, level: Level | null, asked: Level | null) => Promise<boolean>) {
    for (const id of new Set([...Object.keys(this.state.persons), ...ids])) {
      const agreed = levelOf(this.local.get(AGREED + id))
      const open = this.local.get(OPEN + id) != null
      const before = this.local.get(MUTUAL + id)
      if (!always(agreed) && !open && before == null) continue
      const asked = open && always(this.state.persons[id]) ? this.state.persons[id] : null
      if (always(agreed) || asked) {
        try {
          await adopt(id, always(agreed) ? agreed : null, asked)
        } catch {
          continue
        }
      }
      if (before != null) this.setPerson(id, levelOf(before.replace(NONE, '') || null))
      for (const k of [AGREED, OPEN, MUTUAL, KEPT]) this.local.set(k + id, null)
    }
  }
}
