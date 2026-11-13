// Alerts and channels (ADR 0062), as the app shows them (alerts/AlertLogic.kt): pure rules without core and DOM.
// The core verifies, decrypts and deduplicates the alerts; here are only view, filter and notification.

/**
 * Invitation link of the curated channel with official warnings (NINA), public as in the app
 * (`OFFICIAL_ALERTS_LINK` of the app). Made with the relay (`nina-channel`); empty: then the web app does not show it.
 */
export const OFFICIAL_ALERTS_LINK: string =
  'https://anynear.app/a#pwABAVggro9NwRU2zyAA-5xRZy0U48TOfL5kGHDZABeekQ1utVkCeCtudDdNdV9rQmJfTFE4YU5VeTd1b1ZRbEM4NmRhcThfQXlaT0c0S051WUpzA25XYXJudW5nZW4gTklOQQRYIP1won4MxYXtP4Qd71ghHpSv6Aitf81MsalUYcok2EHqBXifZ2xneXBBRllJSjdlekx2NUFXX3kwUEdqVk11N3FGVUpRdk9uV3F2UHdNbVRodUNqYm1DYkFnTUZHdlNHVndBR0dtcnNLUjFZUUdUc2l2d1lWcVMtRUFCUUViclZlaEx1TU9ZQU5jSjNiME1VZlhnZnJVVzZfWU4wM2tDNWROWTNLMWlkZG1zc2JyV2pldDdIUmlvUkJJZ2RDMmxwaXdFBvU'

/** Host of channel links (`https://<host>/a#…`), as in the core (`AnmpCoreConfig.LINK_HOST`); it still recognises `anynear.net`. */
export const LINK_HOST = 'anynear.app'

/** Priority as in the packet: 1 info, 2 warning or „Wichtig“, 3 alarm. */
export type Priority = 1 | 2 | 3
export const INFO: Priority = 1
export const WARNING: Priority = 2
export const ALARM: Priority = 3

export type AlertStatus = 'active' | 'ended' | 'expired'

export interface Ingress {
  id: string
  label: string
  url: string
  created: number
}

export interface Channel {
  /** space of the channel. */
  id: string
  name: string
  /** This device is the owner: may send, share, create addresses for devices. */
  owner: boolean
  /** Curated channel by anynear (official warnings). */
  curated: boolean
  /** Subscribed or created (ms). */
  joinedAt: number
  ingress: Ingress[]
  /** Who has subscribed and reported in, only for the owner (ADR 0062 §11), oldest first. */
  subscribers: Subscriber[]
  /** Subscribed, and the owner sees that we are in (ADR 0062 §11). */
  seenByOwner: boolean
}

/** Someone who has subscribed to an own channel (ADR 0062 §11). */
export interface Subscriber {
  deviceId: string
  name: string
  /** In since (ms). */
  since: number
}

export interface AlertAttachment {
  /** Position in the core's list, for loading. */
  index: number
  type: string
  name: string
}

/** An alert, times in milliseconds. */
export interface Alert {
  channelId: string
  /** ID as hex. */
  id: string
  ts: number
  prio: Priority
  title: string | null
  text: string
  url: string | null
  until: number
  replaces: string | null
  ended: boolean
  source: string | null
  /** Regional key prefixes, only for curated channels. */
  area: string[]
  attachments: AlertAttachment[]
  /** Sender as hex; for addresses for devices their ID. */
  sender: string
  /** From the core: replaced by an all-clear. */
  endedByOther: boolean
}

/** Priority from the packet; anything unknown above counts as alarm, below as info. */
export function priorityOf(wire: number): Priority {
  return wire >= ALARM ? ALARM : wire >= WARNING ? WARNING : INFO
}

/** All-clear given, expired („gültig bis“ has passed) or active, at the time [now]. */
export function statusAt(a: Alert, now: number): AlertStatus {
  if (a.ended || a.endedByOther) return 'ended'
  if (a.until <= now) return 'expired'
  return 'active'
}

/**
 * Location filter for curated channels, only in the browser. [kreis] is the district key from the approximate location
 * (`regions.ts`); `null`: not known yet, then no official alert counts. An alert matches if one of its areas
 * (regional key prefixes) contains the district or lies within it (a warning for all of Hesse `06` matches Frankfurt
 * `06412`). Alerts without an area apply everywhere.
 */
export function inRegion(a: Alert, kreis: string | null): boolean {
  return kreis !== null && (a.area.length === 0 || a.area.some((x) => x !== '' && (kreis.startsWith(x) || x.startsWith(kreis))))
}

/** Alerts that count here: official ones only in the district [kreis]. */
export function visibleAlerts(alerts: Alert[], channels: Channel[], kreis: string | null): Alert[] {
  const curated = new Set(channels.filter((c) => c.curated).map((c) => c.id))
  return alerts.filter((a) => !curated.has(a.channelId) || inRegion(a, kreis))
}

/** IDs of the alerts that a later one replaces (update or all-clear). */
export function replacedIds(alerts: Alert[]): Set<string> {
  return new Set(alerts.map((a) => a.replaces).filter((r): r is string => !!r))
}

/**
 * May „Entwarnen“ be shown at [a] (like `canEnd` in the app)? Only in own channels (also for alerts via an
 * address for devices), not in subscribed and curated ones, only as long as the alert is active, is not itself an
 * all-clear and no newer one has replaced it ([replaced] from [replacedIds]).
 */
export function canEnd(a: Alert, channel: Channel | undefined, replaced: Set<string>, now: number): boolean {
  return !!channel && channel.owner && !channel.curated && channel.id === a.channelId && !a.ended && !replaced.has(a.id) && statusAt(a, now) === 'active'
}

/** Top of „Meldungen“: active from warning up, without replaced ones and all-clears; alarms first, otherwise newest first. */
export function activeAlerts(alerts: Alert[], now: number): Alert[] {
  const replaced = replacedIds(alerts)
  return alerts
    .filter((a) => a.prio >= WARNING && !replaced.has(a.id) && statusAt(a, now) === 'active')
    .sort((a, b) => b.prio - a.prio || b.ts - a.ts)
}

export interface ChannelRow {
  channel: Channel
  last: Alert | null
  unread: number
}

/** Channel list like the conversation list: newest alert first, channels without alert by name. [seen]: read up to when (ms). */
export function channelRows(channels: Channel[], alerts: Alert[], seen: Record<string, number>): ChannelRow[] {
  return channels
    .map((channel) => {
      const list = alerts.filter((a) => a.channelId === channel.id)
      const last = list.reduce<Alert | null>((m, a) => (!m || a.ts > m.ts ? a : m), null)
      return { channel, last, unread: unreadIn(list, seen[channel.id] ?? 0) }
    })
    .sort((a, b) => (b.last?.ts ?? -Infinity) - (a.last?.ts ?? -Infinity) || a.channel.name.toLowerCase().localeCompare(b.channel.name.toLowerCase()))
}

/** Number on the section: unread alerts from warning upwards, across all [channels] in the list (others cannot be read). */
export function unreadCount(alerts: Alert[], seen: Record<string, number>, channels: Channel[]): number {
  const listed = new Set(channels.map((c) => c.id))
  let n = 0
  for (const a of alerts) if (listed.has(a.channelId) && isUnread(a, seen[a.channelId] ?? 0)) n++
  return n
}

function unreadIn(alerts: Alert[], seenUntil: number): number {
  return alerts.filter((a) => isUnread(a, seenUntil)).length
}

function isUnread(a: Alert, seenUntil: number): boolean {
  return a.prio >= WARNING && !a.ended && a.ts > seenUntil
}

/**
 * From this priority on an alert is loud in the app (default „Laut, auch bei Stummschaltung: Nur Alarm“). The browser
 * cannot be loud (ADR 0062 §6); such notifications just stay here until they are clicked away.
 */
export const LOUD_FROM: Priority = ALARM

/** Browser notification for an alert; never silent, not even info (as in the app). */
export interface AlertNotice {
  requireInteraction: boolean
}

/**
 * How an alert appears in the browser (ADR 0062 §5, like `notificationOf` in the app): every alert notifies, unless
 * the channel has notifications off (`null`). From alarm on the notification stays; an all-clear never does.
 */
export function alertNotice(a: Alert, notify: boolean): AlertNotice | null {
  if (!notify) return null
  return { requireInteraction: !a.ended && a.prio >= LOUD_FROM }
}

/** Notifications per channel; if a channel is missing, they are on (default as in the app). */
export function notifyOf(settings: Record<string, boolean>, channelId: string): boolean {
  return settings[channelId] ?? true
}

/**
 * Notifications per channel from storage ([stored], JSON or `null`). Earlier there was only „Hinweis mit Ton ab“
 * ([legacyLoud]); channels from there count as „Benachrichtigungen an“, also those with „Nie“ (same in the app).
 */
export function readNotifySettings(stored: string | null, legacyLoud: string | null): Record<string, boolean> {
  const parsed = parseObject(stored)
  if (parsed) return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'))
  return Object.fromEntries(Object.keys(parseObject(legacyLoud) ?? {}).map((id) => [id, true]))
}

function parseObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Key for "has already notified": channel and ID, like `notifiedKey` in the app. */
export function notifiedKey(a: Pick<Alert, 'channelId' | 'id'>): string {
  return `${a.channelId}/${a.id}`
}

/**
 * Remembers the last [max] notifications; `true` only the first time. This way an alert that arrives on two paths
 * (own ones: after sending and once more from the core) notifies only once.
 */
export function rememberNotified(list: string[], key: string, max = 200): string[] | null {
  return list.includes(key) ? null : [...list, key].slice(-max)
}

/**
 * Channel link from an address of this web app (`https://web.…/a#…`, deep link) or from pasted text; `null` if
 * there is none in it. The web app opens links on its own address; the core knows them under [LINK_HOST].
 */
export function channelLinkFromUrl(pathname: string, hash: string): string | null {
  if (!/^\/a\/?$/.test(pathname) || !/^#[A-Za-z0-9_-]+$/.test(hash)) return null
  return `https://${LINK_HOST}/a${hash}`
}

/** Looks like a channel link (even if copied incompletely)? Then it belongs to the alerts, not to circles. */
export function looksLikeChannelLink(text: string): boolean {
  return /anynear\.(app|net)\/a\/?#/.test(text)
}
