// SOS contacts say yes once (ADR 0121 §25): a person asks to be woken by our calls; we accept or decline. The answer
// goes to the person alone, and through the profile space to every own device, so the phone rings loudly only for
// persons we agreed to. The browser itself never rings; it only answers and shows. A question never opens by itself
// (ADR 0123 §6): it waits in the list „Anfragen“ and as a card in the chat.
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

/** Whom the own person asked, with their answer: 1 asked, 2 agreed, 3 refused (`SosContact` of the core). */
export const sosContacts = signal<Map<string, number>>(new Map())

/** The question the person tapped on, shown as a dialog; `null` for none. */
export const sosAsking = signal<string | null>(null)

/** The cards about SOS contacts in the chat (ADR 0123 §5), as `CARD_…` in the app. */
export const SOS_CARD = {
  ASKED_US: 1,
  WE_ASKED: 2,
  THEY_YES: 3,
  THEY_NO: 4,
  WE_YES: 5,
  WE_NO: 6,
  OVER_FOR_US: 7,
  OVER_FOR_THEM: 8,
} as const

const ASKED = 1
const AGREED = 2
const REFUSED = 3

/** Called for every card one change brings (set by the session, which keeps the messages). */
let onCard: (person: string, card: number) => void = () => {}

export function onSosCard(f: (person: string, card: number) => void) {
  onCard = f
}

/** Small values kept in this browser. */
export interface SeenStore {
  get(key: string): string | null
  set(key: string, value: string | null): void
}

/** Whom the own person chose as SOS contacts, as the setting `sos.helpers` of the app (ADR 0121 §13). */
export interface SosHelpers {
  circles: string[]
  persons: string[]
  /** Members of a chosen circle the own person ended (ADR 0123 §3): not asked again; `x:` entries in the setting. */
  except: string[]
}

export const sosHelpers = signal<SosHelpers>({ circles: [], persons: [], except: [] })

/** The setting in the profile space, as SettingsSync of the app writes it. */
export const HELPERS_KEY = 'kv:sos.helpers'

/** The state the cards last saw, kept in this browser: changes while the page was closed get their card, too. */
const SEEN_KEY = 'sos.cardsSeen'

let core: AnmpCoreWeb | null = null
let seenStore: SeenStore | null = null
let membersOf: (circleId: string) => string[] = () => []
let watching = false

export function startSos(c: AnmpCoreWeb, store: SeenStore | null = null, members: (circleId: string) => string[] = () => []) {
  core = c
  seenStore = store
  membersOf = members
  watching = true
  refreshSos()
  void c
    .setting(HELPERS_KEY)
    .then((v) => takeHelpers(v ?? null))
    .catch(() => {})
}

/** The setting as it came from the profile space (also from the phone). */
export function takeHelpers(raw: string | null) {
  const v = raw == null || raw === '0' ? '' : raw.startsWith('1') ? raw.slice(1) : null
  if (v == null) return
  const parts = v.split(',').filter(Boolean)
  const of = (prefix: string) => parts.filter((p) => p.startsWith(prefix)).map((p) => p.slice(2))
  sosHelpers.value = { circles: of('c:'), persons: of('p:'), except: of('x:') }
}

/**
 * Chooses the SOS contacts (ADR 0123 §3), as `setHelpers` in the app: the setting reaches every own device; who is new
 * gets the question, who is no longer chosen learns it.
 */
export async function setSosHelpers(next: SosHelpers) {
  const c = core
  if (!c) return
  const before = sosHelpers.value
  sosHelpers.value = next
  const value = [...next.circles.map((x) => `c:${x}`), ...next.persons.map((x) => `p:${x}`), ...next.except.map((x) => `x:${x}`)].sort().join(',')
  await c.setSetting(HELPERS_KEY, value ? `1${value}` : '0').catch(() => {})
  const still = new Set([...next.circles.flatMap(membersOf), ...next.persons].filter((p) => !next.except.includes(p)))
  const gone = [...new Set([...before.circles.flatMap(membersOf), ...before.persons])].filter((p) => !before.except.includes(p) && !still.has(p))
  for (const p of gone) await c.endSosContact(p).catch(() => false)
  const newCircles = next.circles.filter((x) => !before.circles.includes(x))
  const newPersons = next.persons.filter((x) => !before.persons.includes(x) || before.except.includes(x))
  if (newCircles.length || newPersons.length) await c.askSosContacts(newCircles, newPersons, next.except).catch(() => false)
  refreshSos()
}

/** „Als SOS-Kontakt fragen“ at the page of a person: chosen alone, and asked. */
export function askAsSos(person: string) {
  const h = sosHelpers.value
  if (!h.persons.includes(person) || h.except.includes(person)) void setSosHelpers({ ...h, persons: [...new Set([...h.persons, person])], except: h.except.filter((p) => p !== person) })
}

/**
 * Ends [person] as SOS contact (ADR 0123 §3), as `endContact` in the app: chosen alone, it is taken out; chosen through
 * a circle, it is left out from now on, so that it is not asked again. Both tell it.
 */
export async function endSos(person: string) {
  const h = sosHelpers.value
  const inCircle = h.circles.some((c) => membersOf(c).includes(person))
  if (h.persons.includes(person) || inCircle) {
    await setSosHelpers({ ...h, persons: h.persons.filter((p) => p !== person), except: inCircle ? [...new Set([...h.except, person])] : h.except })
  } else await endSosContact(person)
}

type Seen = { asks: string[]; agreed: string[]; contacts: [string, number][] }

function readSeen(): Seen | null {
  try {
    const raw = seenStore?.get(SEEN_KEY)
    return raw ? (JSON.parse(raw) as Seen) : null
  } catch {
    return null
  }
}

/**
 * The cards one change brings about one person (ADR 0123 §5), as `sosCards` in the app: from whether it asked us,
 * whether we agreed, and what it answered to our question.
 */
export function sosCards(
  askedBefore: boolean,
  asked: boolean,
  agreedBefore: boolean,
  agreed: boolean,
  contactBefore: number | undefined,
  contact: number | undefined,
  chosen: boolean,
): number[] {
  const out: number[] = []
  if (!askedBefore && asked) out.push(SOS_CARD.ASKED_US)
  if (!agreedBefore && agreed) out.push(SOS_CARD.WE_YES)
  else if (askedBefore && !asked && !agreed) out.push(SOS_CARD.WE_NO)
  if (agreedBefore && !agreed) out.push(SOS_CARD.OVER_FOR_US)
  if (contactBefore !== contact) {
    if (contact === ASKED) {
      if (chosen && contactBefore === undefined) out.push(SOS_CARD.WE_ASKED)
    } else if (contact === AGREED) out.push(SOS_CARD.THEY_YES)
    else if (contact === REFUSED) out.push(contactBefore === AGREED ? SOS_CARD.OVER_FOR_THEM : SOS_CARD.THEY_NO)
    else if (contact === undefined && contactBefore === AGREED) out.push(SOS_CARD.OVER_FOR_THEM)
  }
  return out
}

/** Reads the state from the core (after start, `SosAsked`, `SosContactsChanged`, a new profile). */
export function refreshSos() {
  const c = core
  if (!c) return
  const asksBefore = new Set(sosAsks.peek().map((a) => a.person))
  const agreedBefore = new Set(sosAgreed.peek())
  const contactsBefore = sosContacts.peek()
  try {
    sosAsks.value = c.sosAsks().map((a) => ({ person: a.person, at: Number(a.at), circleId: a.circleId ?? null }))
    sosAgreed.value = c.sosAgreed().slice()
    sosContacts.value = new Map(c.sosContacts().map((x) => [x.person, x.state]))
  } catch {
    // An older core without the functions: nothing to show.
    return
  }
  if (!watching) return
  // Compared with what the cards last saw in this browser; the first time there is nothing to compare with.
  const seen = readSeen()
  const now: Seen = { asks: sosAsks.value.map((a) => a.person), agreed: sosAgreed.value.slice(), contacts: [...sosContacts.value.entries()] }
  seenStore?.set(SEEN_KEY, JSON.stringify(now))
  if (!seenStore) {
    cardsBetween(asksBefore, agreedBefore, contactsBefore)
    return
  }
  if (!seen) return
  cardsBetween(new Set(seen.asks), new Set(seen.agreed), new Map(seen.contacts))
}

function cardsBetween(asksBefore: Set<string>, agreedBefore: Set<string>, contactsBefore: Map<string, number>) {
  const asks = new Set(sosAsks.value.map((a) => a.person))
  const agreed = new Set(sosAgreed.value)
  const contacts = sosContacts.value
  for (const p of new Set([...asksBefore, ...asks, ...agreedBefore, ...agreed, ...contactsBefore.keys(), ...contacts.keys()])) {
    for (const card of sosCards(asksBefore.has(p), asks.has(p), agreedBefore.has(p), agreed.has(p), contactsBefore.get(p), contacts.get(p), sosHelpers.peek().persons.includes(p))) onCard(p, card)
  }
}

/** Shows the question of [person], from a list of open questions. */
export function askNow(person: string) {
  sosAsking.value = person
}

export function closeAsk() {
  sosAsking.value = null
}

/** Accept or decline [person], also later to take a yes back. `false` if it did not go out. */
export async function answerSos(person: string, agree: boolean): Promise<boolean> {
  const c = core
  if (!c) return false
  const ok = await c.answerSosAsk(person, agree).catch(() => false)
  if (ok && sosAsking.value === person) closeAsk()
  refreshSos()
  return ok
}

/** The own person no longer counts [person] as its SOS contact (ADR 0123 §3): [person] learns it. */
export async function endSosContact(person: string): Promise<boolean> {
  const c = core
  if (!c) return false
  const ok = await c.endSosContact(person).catch(() => false)
  refreshSos()
  return ok
}

/** Does a call of [person] count as one we agreed to (ADR 0121 §25)? Only then may it be urgent. */
export function agreedTo(person: string): boolean {
  return sosAgreed.peek().includes(person)
}
