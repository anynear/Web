// Messages as the web app keeps them. The core only reports facts (CoreEvent); history, states and
// unread items are kept by the UI itself, like the app (ANMP Events.kt). Pure functions, without core and DOM.

/** Conversation: `c:<circle ID>` or `d:<person ID>`. */
export type ConvKey = string

export const circleKey = (circleId: string): ConvKey => `c:${circleId}`
export const directKey = (personId: string): ConvKey => `d:${personId}`

export function parseKey(key: ConvKey): { kind: 'circle' | 'direct'; id: string } {
  return { kind: key.startsWith('c:') ? 'circle' : 'direct', id: key.slice(2) }
}

/** Attachment of a message; [id] and [key] b64u, as in the ANMP field (AnmpAttachment). */
export interface Att {
  id: string
  key: string
  type: string
  name: string
  size: number
  width: number
  height: number
  duration: number
  /** Plaintext hash (first 16 bytes of SHA-256, b64u) for `want`/`have` (ADR 0014); missing in old messages. */
  hash?: string
}

export type Status = 'sending' | 'sent' | 'failed'

export interface Msg {
  /** Locally unique: own messages carry their message ID, others' `<device>|<mid>`. */
  id: string
  conv: ConvKey
  mid?: string
  outgoing: boolean
  fromDevice?: string
  fromPerson?: string
  fromName?: string
  text: string
  ts: number
  /** Outgoing only: on the way, at the first relay, finally failed. */
  status?: Status
  /** Outgoing: persons who belonged to it when sending (without the own one). */
  recipients?: string[]
  /** Outgoing: persons who have confirmed delivery or reading (ADR 0003, 0019). */
  arrivedBy?: string[]
  readBy?: string[]
  /** Incoming: not looked at yet. */
  unread?: boolean
  attachments: Att[]
  /** ANDP space of the message and its attachments. */
  space?: string
  /** Reactions per person (own ones under `self`), the newest applies; empty emoji = withdrawn (ADR 0018). */
  reactions?: Record<string, { emoji: string; ts: number }>
  history?: boolean
  /** Line about a change in the circle instead of a message (ADR 0012). */
  system?: boolean
  /** Deleted for everyone by the author (ADR 0068): only sender, time and ID remain. Missing in older entries. */
  deleted?: boolean
  /** Preview of the first link, sent along by the sender (ADR 0069). */
  link?: LinkCard
  /**
   * Answer (ADR 0092): message ID and author tag (both b64u) of the message this one answers; both or neither.
   * Missing in older entries and in messages that answer nothing.
   */
  replyTo?: string
  replyFrom?: string
  /** The sender passed on a message it got („Weitergeleitet“, ADR 0118); no origin. */
  passedOn?: boolean
  /** Contact introduced in this message (ADR 0116); [text] is only the stand-in for older apps. */
  intro?: IntroCard
}

/** Introduced contact as in the core (`Intro`): person ID, its own name, introducer, until (ms), signed card. */
export interface IntroCard {
  id: string
  person: string
  name: string
  byPerson: string
  until: number
  card: string
}

/** Preview of a link as in ANMP field 34 (AnmpLink); the picture is an attachment in the space of the message. */
export interface LinkCard {
  url: string
  title?: string
  description?: string
  site?: string
  image?: Att
}

export const SELF = 'self'

/** State as it is shown under an own message. */
export type Shown =
  | { kind: 'sending' | 'sent' | 'failed' | 'arrived' | 'read' | 'readAll' }
  | { kind: 'readSome'; n: number; total: number }

export function shownStatus(m: Msg, inCircle: boolean): Shown {
  if (m.status === 'failed') return { kind: 'failed' }
  if (m.status === 'sending') return { kind: 'sending' }
  const recipients = m.recipients ?? []
  const read = (m.readBy ?? []).filter((p) => recipients.length === 0 || recipients.includes(p))
  if (inCircle && recipients.length > 0) {
    if (read.length >= recipients.length) return { kind: 'readAll' }
    if (read.length > 0) return { kind: 'readSome', n: read.length, total: recipients.length }
    return (m.arrivedBy ?? []).length > 0 ? { kind: 'arrived' } : { kind: 'sent' }
  }
  if (read.length > 0) return { kind: 'read' }
  return (m.arrivedBy ?? []).length > 0 ? { kind: 'arrived' } : { kind: 'sent' }
}

/** Takes the receipt from [person] for own messages [mids]; returns the changed messages. */
export function applyReceipt(list: Msg[], person: string, mids: string[], read: boolean): Msg[] {
  const changed: Msg[] = []
  for (const m of list) {
    if (!m.outgoing || !m.mid || !mids.includes(m.mid)) continue
    const arrivedBy = add(m.arrivedBy, person)
    const readBy = read ? add(m.readBy, person) : m.readBy
    if (arrivedBy === m.arrivedBy && readBy === m.readBy && m.status !== 'sending') continue
    changed.push({ ...m, arrivedBy, readBy, status: m.status === 'sending' ? 'sent' : m.status })
  }
  return changed
}

/** Receipt for an own message that is still missing here (copy from another own device, ADR 0042). */
export interface EarlyReceipt {
  mid: string
  person: string
  read: boolean
}

/** At most this many early receipts; the oldest are dropped. Only in memory. */
export const MAX_EARLY_RECEIPTS = 500

/**
 * Add receipts for [mids] for which there is no own message in [list] yet to [parked]: the copy
 * from another own device can arrive after the recipient's receipt.
 */
export function parkReceipts(parked: EarlyReceipt[], list: Msg[], person: string, mids: string[], read: boolean): EarlyReceipt[] {
  const known = new Set(list.filter((m) => m.outgoing && m.mid).map((m) => m.mid))
  const fresh = mids.filter((mid) => !known.has(mid)).map((mid) => ({ mid, person, read }))
  if (!fresh.length) return parked
  const all = [...parked, ...fresh]
  return all.length > MAX_EARLY_RECEIPTS ? all.slice(all.length - MAX_EARLY_RECEIPTS) : all
}

/** Apply remembered receipts to newly arrived own messages; [rest] are the remaining ones. */
export function withEarlyReceipts(list: Msg[], parked: EarlyReceipt[]): { list: Msg[]; rest: EarlyReceipt[] } {
  if (!parked.length) return { list, rest: parked }
  const mids = new Set(list.filter((m) => m.outgoing && m.mid).map((m) => m.mid))
  const used = parked.filter((r) => mids.has(r.mid))
  if (!used.length) return { list, rest: parked }
  const out = list.map((m) =>
    used.filter((r) => r.mid === m.mid).reduce((cur, r) => applyReceipt([cur], r.person, [r.mid], r.read)[0] ?? cur, m),
  )
  return { list: out, rest: parked.filter((r) => !mids.has(r.mid)) }
}

/** Take over the reaction from [who] if it is newer than the known one; `null` if nothing changes. */
export function applyReaction(m: Msg, who: string, emoji: string, ts: number): Msg | null {
  const cur = m.reactions?.[who]
  if (cur && cur.ts >= ts) return null
  return { ...m, reactions: { ...m.reactions, [who]: { emoji, ts } } }
}

/** Visible reactions, counted per emoji, in a fixed order. */
export function reactionSummary(m: Msg): { emoji: string; count: number; mine: boolean }[] {
  const byEmoji = new Map<string, { emoji: string; count: number; mine: boolean }>()
  for (const [who, r] of Object.entries(m.reactions ?? {})) {
    if (!r.emoji) continue
    const e = byEmoji.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false }
    e.count++
    if (who === SELF) e.mine = true
    byEmoji.set(r.emoji, e)
  }
  return [...byEmoji.values()]
}

function add(list: string[] | undefined, v: string): string[] | undefined {
  if (list?.includes(v)) return list
  return [...(list ?? []), v]
}

/** New message ID as in the core (8 bytes, b64u), so that it is the same on all paths. */
export function newMid(): string {
  return b64u(crypto.getRandomValues(new Uint8Array(8)))
}

export function b64u(bytes: Uint8Array | Int8Array): string {
  let s = ''
  for (const b of new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64u(text: string): Int8Array {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4))
  const out = new Int8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** One direct message of the own history as the core takes it (ADR 0107 §6, `WebHistoryItem`). */
export interface OwnHistoryData {
  peer: string
  mid: string
  ts: number
  text: string
  /** Sender's device of a received message; `null` for an own one. */
  author: string | null
  replyTo: string | null
  replyFrom: string | null
  attachments: Att[]
}

/**
 * The page's own direct messages for the core to keep once as own copies (ADR 0107 §6): what a person sent from one
 * device lay only in the recipients' mailboxes. System lines, deleted messages and those without message ID stay out.
 */
export function ownHistoryOf(list: Msg[]): OwnHistoryData[] {
  const out: OwnHistoryData[] = []
  for (const m of list) {
    const { kind, id } = parseKey(m.conv)
    if (kind !== 'direct' || m.system || m.deleted || !m.mid) continue
    if (!m.outgoing && !m.fromDevice) continue
    out.push({
      peer: id,
      mid: m.mid,
      ts: m.ts,
      text: m.text,
      author: m.outgoing ? null : m.fromDevice ?? null,
      replyTo: m.replyTo ?? null,
      replyFrom: m.replyFrom ?? null,
      attachments: m.attachments,
    })
  }
  return out
}

/** Last message and number of unread ones per conversation, for the overview. */
export function summarize(list: Msg[]): Map<ConvKey, { last: Msg; unread: number }> {
  const out = new Map<ConvKey, { last: Msg; unread: number }>()
  for (const m of list) {
    const s = out.get(m.conv)
    if (!s) out.set(m.conv, { last: m, unread: m.unread ? 1 : 0 })
    else {
      if (m.ts >= s.last.ts) s.last = m
      if (m.unread) s.unread++
    }
  }
  return out
}

/**
 * Conversations the overview „Nachrichten“ shows: own circles (left ones only while they still have messages), direct
 * conversations with contacts and everyone who has written, without the own person and the support identity (ADR 0065).
 * Unread messages elsewhere (e.g. from the support identity or a circle the browser no longer knows) cannot be opened,
 * so they must not count anywhere either.
 */
export function listedConversations(
  circles: { id: string; removed?: boolean }[],
  contacts: Iterable<string>,
  withMessages: Iterable<ConvKey>,
  own: string | undefined,
  support: string | null,
): ConvKey[] {
  const keys = new Set(withMessages)
  const out: ConvKey[] = []
  for (const c of circles) if (!c.removed || keys.has(circleKey(c.id))) out.push(circleKey(c.id))
  const direct = new Set<string>(contacts)
  for (const k of keys) {
    const { kind, id } = parseKey(k)
    if (kind === 'direct') direct.add(id)
  }
  if (own) direct.delete(own)
  if (support) direct.delete(support)
  for (const id of direct) out.push(directKey(id))
  return out
}

/** Text including file names, as the search sees it (searchableText in the app). */
export function searchable(m: Msg): string {
  if (m.deleted) return ''
  return [m.text, ...m.attachments.map((a) => a.name)].filter(Boolean).join(' · ')
}

/** Messages (no lines about changes in the circle) whose text or file names contain [query], newest first. */
export function chatMatches(list: Msg[], query: string): Msg[] {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return []
  return list.filter((m) => !m.system && !m.deleted && searchable(m).toLocaleLowerCase().includes(q)).sort((a, b) => b.ts - a.ts)
}

// --- Deleting (ADR 0068) ----------------------------------------------------------------------------------

/** „Für alle löschen“ works this long after sending, afterwards only „Nur für mich löschen“. */
export const DELETE_FOR_ALL_MS = 48 * 60 * 60 * 1000
/** This long the browser remembers a deletion whose message is not there yet. */
export const PENDING_DELETE_MS = 30 * 24 * 60 * 60 * 1000

/** Whether „Für alle löschen“ is offered: own, sent message, at most 48 hours old. */
export function canDeleteForAll(m: Msg, now: number): boolean {
  return m.outgoing && !!m.mid && !m.system && !m.deleted && m.status !== 'failed' && m.status !== 'sending' && now - m.ts <= DELETE_FOR_ALL_MS
}

/** The deleted message: text, attachments, reactions and preview gone; sender, time and ID stay. */
export function markDeleted(m: Msg): Msg {
  const { reactions: _r, link: _l, ...rest } = m
  return { ...rest, text: '', attachments: [], unread: false, deleted: true }
}

/** A deletion whose message is still missing; [id] is `<conversation>|<tag>|<message ID>`. */
export interface PendingDelete {
  id: string
  conv: ConvKey
  tag: string
  mid: string
  /** Until when it applies (milliseconds). */
  until: number
}

export function pendingDelete(conv: ConvKey, tag: string, mid: string, now: number): PendingDelete {
  return { id: `${conv}|${tag}|${mid}`, conv, tag, mid, until: now + PENDING_DELETE_MS }
}

/**
 * Does the deletion [conv]/[tag]/[mid] hit the message [m]? [tagOf] returns the author's tag; if it is not
 * known (own message from the history without device), the message ID (8 random bytes) is enough.
 */
export function hits(m: Msg, conv: ConvKey, tag: string, mid: string, tagOf: (m: Msg) => string | null): boolean {
  if (m.system || m.conv !== conv || m.mid !== mid) return false
  const t = tagOf(m)
  return t === null || t === tag
}

/** Apply a deletion: the hit message as deleted, or `null` if it is not there (yet). */
export function applyDelete(list: Msg[], conv: ConvKey, tag: string, mid: string, tagOf: (m: Msg) => string | null): Msg | null {
  const target = list.find((m) => hits(m, conv, tag, mid, tagOf))
  if (!target) return null
  return target.deleted ? target : markDeleted(target)
}

/**
 * Check newly arrived messages against remembered deletions: hit ones arrive as deleted right away, the
 * used-up deletions are in [used].
 */
export function applyPending(list: Msg[], pending: PendingDelete[], tagOf: (m: Msg) => string | null, now: number): { list: Msg[]; used: string[] } {
  const live = pending.filter((p) => p.until > now)
  const used: string[] = []
  const out = list.map((m) => {
    const p = live.find((p) => hits(m, p.conv, p.tag, p.mid, tagOf))
    if (!p) return m
    used.push(p.id)
    return markDeleted(m)
  })
  return { list: out, used }
}

/** Expired deletions (older than 30 days). */
export function expiredPending(pending: PendingDelete[], now: number): string[] {
  return pending.filter((p) => p.until <= now).map((p) => p.id)
}

// --- Preview for links (ADR 0069) --------------------------------------------------------------------------

/** Our invitation links keep their own card (InviteCard), never a web preview. */
const OWN_LINK = /^https:\/\/anynear\.(?:app|net)\/([ackp])\/?#/i

/**
 * The preview that appears under the text, or `null`: only with `https`, only if the address is in the text
 * (otherwise the card would show a link that was never sent), never for deleted messages and anynear links.
 */
export function shownLink(m: Msg): (LinkCard & { host: string }) | null {
  const l = m.link
  if (!l || m.deleted || !l.url || !m.text.includes(l.url) || OWN_LINK.test(l.url)) return null
  let host: string
  try {
    const u = new URL(l.url)
    if (u.protocol !== 'https:') return null
    host = u.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
  if (!l.title && !l.description && !l.image) return null
  return { ...l, host }
}

// --- Answers (ADR 0092) ------------------------------------------------------------------------------------

/** `{ replyTo, replyFrom }` if both are given as text, otherwise nothing (answers come only as a pair). */
export function replyOf(to: unknown, from: unknown): { replyTo: string; replyFrom: string } | Record<string, never> {
  return typeof to === 'string' && to && typeof from === 'string' && from ? { replyTo: to, replyFrom: from } : {}
}

/**
 * The message [m] answers, among the stored messages [list]: same conversation, same message ID and, if the author's
 * tag is known, the same tag (as with deleting, [hits]). `null` if [m] answers nothing or the original is not here.
 */
export function repliedTo(list: Msg[], m: Msg, tagOf: (m: Msg) => string | null): Msg | null {
  if (!m.replyTo || !m.replyFrom) return null
  return list.find((x) => x.id !== m.id && hits(x, m.conv, m.replyFrom!, m.replyTo!, tagOf)) ?? null
}

/** What the quote box shows of the original, see [repliedTo]. */
export type Quote =
  | { kind: 'missing' }
  | { kind: 'deleted'; outgoing: boolean; fromPerson?: string; fromName?: string }
  | { kind: 'text'; text: string; outgoing: boolean; fromPerson?: string; fromName?: string }
  | { kind: 'attachment'; type: 'photo' | 'voice' | 'document' | 'file'; outgoing: boolean; fromPerson?: string; fromName?: string }

/** At most this many characters of the original go into the quote; the line is cut further by the layout. */
export const QUOTE_CHARS = 200

/** The quote of [original] (`null`: not on this device): one line of text, otherwise the kind of the first attachment. */
export function quoteOf(original: Msg | null): Quote {
  if (!original || original.system) return { kind: 'missing' }
  const who = { outgoing: original.outgoing, fromPerson: original.fromPerson, fromName: original.fromName }
  if (original.deleted) return { kind: 'deleted', ...who }
  const line = original.text.replace(/\s+/g, ' ').trim()
  if (line) return { kind: 'text', text: line.length > QUOTE_CHARS ? `${line.slice(0, QUOTE_CHARS - 1)}…` : line, ...who }
  const a = original.attachments[0]
  if (!a) return { kind: 'text', text: '', ...who }
  return { kind: 'attachment', type: attachmentKind(a.type), ...who }
}

function attachmentKind(type: string): 'photo' | 'voice' | 'document' | 'file' {
  return type === 'jpg' ? 'photo' : type === 'm4a' ? 'voice' : type === 'pdf' ? 'document' : 'file'
}
