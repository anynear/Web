// Alerts and channels (ADR 0062) from the core: state as signals, actions, browser notifications. What applies only
// in this browser (district for official warnings, read up to, notifications per channel) lives in localStorage.
import { batch, computed, effect, signal } from '@preact/signals'
import { AlertStatus, type AlertItem, type ChannelState, type AnmpCoreWeb } from 'anmp-core'
import { texts } from '../i18n'
import {
  type Alert,
  type Channel,
  INFO,
  OFFICIAL_ALERTS_LINK,
  activeAlerts,
  alertNotice,
  channelRows,
  inRegion,
  notifiedKey,
  notifyOf,
  priorityOf,
  readNotifySettings,
  rememberNotified,
  unreadCount,
  visibleAlerts,
} from './alerts'
import { type Acks, SETTING_KEY, ack, decodeAcks, encodeAcks, isAcked, pruneAcks, takeRemoteAcks, unack } from './alertAcks'
import { type AlertRegion, type Locating, loadRegionTable } from './regions'
import { local } from './storage'

/** A browser notification; [tag] replaces an earlier one with the same tag. */
export type Notifier = (title: string, body: string, tag: string, options: { requireInteraction: boolean; channel: string }) => void

let core: AnmpCoreWeb | null = null
let notifier: Notifier | null = null
let foreground: () => boolean = () => true
/** Raw data of the core per `channel/alert`, for loading the attachments. */
const items = new Map<string, AlertItem>()

export const channels = signal<Channel[]>([])
/** All alerts of the core (30 days), newest first, still without area filter. */
const allAlerts = signal<Alert[]>([])
/**
 * District for official warnings from the approximate location; `null`: not known yet, then the web app shows and
 * reports none. Only the district is stored, never the location.
 */
export const region = signal<AlertRegion | null>(readJson<AlertRegion | null>('alerts.region', null))
/** Search for the district, for the hint under „Amtliche Warnungen“. */
export const locating = signal<Locating>('idle')
/** May the page read the location? `unknown`: the browser does not say beforehand (without Permissions API). */
export const locationPermission = signal<PermissionState | 'unknown'>('unknown')
/** Per channel, up to when it was read (ms). */
export const seen = signal<Record<string, number>>(readJson('alerts.seen', {}))
/** Per channel, whether alerts show a notification; if a channel is missing, they are on. */
export const notifySettings = signal<Record<string, boolean>>(loadNotifySettings())
/** Clock for "active" and "expired", advances every half minute. */
export const now = signal(Date.now())
/** Opened channel link, not subscribed yet (deep link or pasting). */
export const pendingLink = signal<string | null>(null)
/** Channel that the UI should open, e.g. after a click on a notification. */
export const openRequest = signal<string | null>(null)

/** Alerts that count here (official ones only in the own district), newest first. */
export const alerts = computed(() => visibleAlerts(allAlerts.value, channels.value, region.value?.kreis ?? null))
/** Everything that is active right now, including acknowledged ones. */
const allActive = computed(() => activeAlerts(alerts.value, now.value))
/** Acknowledged alerts of the person („Gesehen“), format as in the app (`alerts_acked`, ADR 0050). */
export const acks = signal<Acks>(pruneAcks(decodeAcks(local.get('alerts.acked')), Date.now()))
/** At the top under „Gerade aktiv“: active and not acknowledged. */
export const active = computed(() => allActive.value.filter((a) => !isAcked(acks.value, a.id)))
/** Active but acknowledged: hidden, on request shown quietly below. */
export const ackedActive = computed(() => allActive.value.filter((a) => isAcked(acks.value, a.id)))
export const rows = computed(() => channelRows(channels.value, alerts.value, seen.value))
/** Number at „Meldungen“ and on the icon: only channels in the list count, an alert of a left channel cannot be read away. */
export const unread = computed(() => unreadCount(alerts.value, seen.value, channels.value))
export const curatedChannel = computed(() => channels.value.find((c) => c.curated) ?? null)
/** Official warnings only if the web app knows the channel (implementation plan §5). */
export const officialAvailable = computed(() => !!OFFICIAL_ALERTS_LINK || !!curatedChannel.value)

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = local.get(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  local.set(key, JSON.stringify(value))
}

/** Reads the notifications per channel; the earlier „Hinweis mit Ton ab“ is taken over once (notifications on). */
function loadNotifySettings(): Record<string, boolean> {
  const legacy = local.get('alerts.loud')
  const settings = readNotifySettings(local.get('alerts.notify'), legacy)
  if (legacy !== null) {
    writeJson('alerts.notify', settings)
    local.set('alerts.loud', null)
  }
  return settings
}

/** Binds the running core; [notify] shows notifications, [isForeground]: page visible and focused. */
export function startChannels(c: AnmpCoreWeb, notify: Notifier, isForeground: () => boolean) {
  core = c
  notifier = notify
  foreground = isForeground
  // Federal states chosen by hand earlier no longer apply, the district now comes from the location.
  local.set('alerts.area', null)
  c.onAlerts(() => refreshChannels())
  refreshChannels()
  void readAcks(c)
  setInterval(() => (now.value = Date.now()), 30_000)
  void watchLocationPermission()
  // Official warnings on and location already allowed (also just now): determine the district without asking.
  let wasOn = false
  effect(() => {
    const on = !!curatedChannel.value && locationPermission.value === 'granted'
    if (on && !wasOn) void locate()
    wasOn = on
  })
}

function channelOf(s: ChannelState): Channel {
  return {
    id: s.id,
    name: s.name,
    owner: s.owner,
    curated: s.curated,
    joinedAt: Number(s.joinedAt),
    ingress: s.ingress.asJsReadonlyArrayView().map((i) => ({ id: i.id, label: i.label, url: i.url, created: Number(i.created) })),
    subscribers: s.subscribers.asJsReadonlyArrayView().map((x) => ({ deviceId: x.deviceId, name: x.name, since: Number(x.since) })),
    seenByOwner: s.seenByOwner,
  }
}

function alertOf(a: AlertItem): Alert {
  return {
    channelId: a.channelId,
    id: a.id,
    ts: Number(a.ts) * 1000,
    prio: priorityOf(a.prio),
    title: a.title?.trim() || null,
    text: a.text,
    url: a.url || null,
    until: Number(a.until) * 1000,
    replaces: a.replaces || null,
    ended: a.ended,
    source: a.source || null,
    area: a.area.asJsReadonlyArrayView().slice(),
    attachments: a.attachments.asJsReadonlyArrayView().map((x, index) => ({ index, type: x.type, name: x.name ?? '' })),
    sender: a.sender,
    endedByOther: a.status === AlertStatus.ENDED && !a.ended,
  }
}

function refreshChannels() {
  if (!core) return
  const list = core.channels().map(channelOf)
  items.clear()
  const all = core.alerts().map((a) => {
    items.set(`${a.channelId}/${a.id}`, a)
    return alertOf(a)
  })
  batch(() => {
    channels.value = list
    allAlerts.value = all
    now.value = Date.now()
  })
  // New channels count as read up to now: when subscribing, the 30 days before are not "new".
  const fresh = list.filter((c) => !(c.id in seen.value))
  if (fresh.length) updateSeen({ ...seen.value, ...Object.fromEntries(fresh.map((c) => [c.id, Date.now()])) })
}

// --- Notifications ----------------------------------------------------------------------------------------

/** New alert from the core (CoreEvent.Alert): notification according to the channel's rule. */
export function onAlert(item: AlertItem) {
  notifyAlert(alertOf(item))
}

/**
 * Every alert shows a notification once, unless the channel has notifications off (ADR 0062 §5, as in the app).
 * Also in the open channel and for own alerts; the core does not report those, so they come from [sendAlert].
 */
function notifyAlert(a: Alert) {
  const channel = channels.value.find((c) => c.id === a.channelId) ?? (core ? core.channels().map(channelOf).find((c) => c.id === a.channelId) : undefined)
  if (!channel || !notifier) return
  if (channel.curated && !inRegion(a, region.value?.kreis ?? null)) return
  // When subscribing, the alerts of the last 30 days arrive; those are not new.
  if (a.ts < channel.joinedAt - 60_000) return
  const notice = alertNotice(a, notifyOf(notifySettings.value, channel.id))
  if (!notice || !firstNotification(notifiedKey(a))) return
  const label = priorityLabel(a.prio, channel.curated, a.ended)
  const title = a.title ? `${label}: ${a.title}` : `${label} · ${channel.name}`
  // An all-clear replaces the notification of the alert it cancels.
  const tag = `alert:${a.channelId}/${a.ended && a.replaces ? a.replaces : a.id}`
  notifier(title, a.text || a.source || channel.name, tag, { requireInteraction: notice.requireInteraction, channel: channel.id })
}

/** Remembers the last notifications, so that an alert that arrives on two paths notifies only once. */
function firstNotification(key: string): boolean {
  const next = rememberNotified(readJson<string[]>('alerts.notified', []), key)
  if (next) writeJson('alerts.notified', next)
  return next !== null
}

/** Word for the priority: „Warnung“ only for official sources, otherwise „Wichtig“ (ADR 0062 §7). */
export function priorityLabel(prio: number, curated: boolean, ended = false): string {
  if (ended) return texts.alerts.allClear
  if (prio >= 3) return texts.alerts.prioAlarm
  if (prio === 2) return curated ? texts.alerts.prioWarning : texts.alerts.prioImportant
  return texts.alerts.prioInfo
}

// --- What applies only in this browser ------------------------------------------------------------------

/** Channel that is open right now; there everything counts as read as long as the page is in the foreground. */
let openChannel: string | null = null

export function setOpenChannel(id: string | null) {
  openChannel = id
  markOpenSeen()
}

export function markOpenSeen() {
  if (!openChannel || !foreground()) return
  const at = Date.now()
  updateSeen({ ...seen.value, [openChannel]: at })
  writeSyncedSeen({ ...syncedSeen, [openChannel]: Math.max(syncedSeen[openChannel] ?? 0, at) })
  void closeChannelNotifications(openChannel)
}

// --- Seen per channel on all own devices (setting `alerts_seen`, like AlertsSeen in the app) --------------------

const SEEN_SETTING = 'alerts_seen'
let syncedSeen: Record<string, number> = {}

function writeSyncedSeen(next: Record<string, number>) {
  syncedSeen = next
  void core?.setSetting(SEEN_SETTING, JSON.stringify(next)).catch(() => {})
}

/** State from another device: per channel the later point in time wins; what was seen there is read here. */
function takeSyncedSeen(text: string | null | undefined) {
  let remote: Record<string, number> = {}
  try {
    const v = text ? JSON.parse(text) : {}
    if (v && typeof v === 'object') for (const [k, at] of Object.entries(v)) if (typeof at === 'number') remote[k] = at
  } catch {
    remote = {}
  }
  const merged: Record<string, number> = { ...syncedSeen }
  for (const [k, at] of Object.entries(remote)) merged[k] = Math.max(merged[k] ?? 0, at)
  syncedSeen = merged
  const later = Object.entries(remote).filter(([id, at]) => id in seen.value && at > (seen.value[id] ?? 0))
  if (later.length) {
    updateSeen({ ...seen.value, ...Object.fromEntries(later) })
    for (const [id] of later) void closeChannelNotifications(id)
  }
}

async function closeChannelNotifications(channelId: string) {
  if (!('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    for (const n of (await reg?.getNotifications()) ?? []) if (n.tag.startsWith(`alert:${channelId}/`)) n.close()
  } catch {
    // Without a service worker there are no notifications either.
  }
}

function updateSeen(next: Record<string, number>) {
  seen.value = next
  writeJson('alerts.seen', next)
}

export function notifyOfChannel(channelId: string): boolean {
  return notifyOf(notifySettings.value, channelId)
}

export function setNotify(channelId: string, on: boolean) {
  notifySettings.value = { ...notifySettings.value, [channelId]: on }
  writeJson('alerts.notify', notifySettings.value)
}

// --- Acknowledged alerts („Gesehen“) -------------------------------------------------------------------------
// Apply to the person on all devices: sync via the person's settings (ADR 0050), as in the app.

function setAcks(next: Acks) {
  acks.value = next
  local.set('alerts.acked', encodeAcks(next))
}

function writeAcks(next: Acks) {
  void core?.setSetting(SETTING_KEY, encodeAcks(next)).catch(() => {})
}

function changeAcks(next: Acks) {
  const pruned = pruneAcks(next, Date.now())
  setAcks(pruned)
  writeAcks(pruned)
}

/** „Gesehen“: the alert disappears from „Gerade aktiv“, only for this person. It stays in the history, the number of unread ones does not change. */
export function ackAlert(alertId: string) {
  changeAcks(ack(acks.value, alertId, Date.now()))
}

/** „Wieder einblenden“. */
export function unackAlert(alertId: string) {
  changeAcks(unack(acks.value, alertId, Date.now()))
}

/** Merge the state from another device (or at start from the core) per ID; if it differs, write it again. */
function takeAcks(text: string | null | undefined) {
  if (text == null) {
    if (Object.keys(acks.value).length) writeAcks(acks.value)
    return
  }
  const { acks: merged, writeBack } = takeRemoteAcks(acks.value, decodeAcks(text), Date.now())
  setAcks(merged)
  if (writeBack) writeAcks(merged)
}

async function readAcks(c: AnmpCoreWeb) {
  takeAcks(await c.setting(SETTING_KEY).catch(() => null))
  takeSyncedSeen(await c.setting(SEEN_SETTING).catch(() => null))
}

/** Settings of the person from another device (`CoreEvent.ProfileChanged`, only changed names). */
export function onSettings(settings: ReadonlyMap<string, Uint8Array>) {
  const raw = settings.get(SETTING_KEY)
  if (raw) takeAcks(new TextDecoder().decode(raw))
  const seenRaw = settings.get(SEEN_SETTING)
  if (seenRaw) takeSyncedSeen(new TextDecoder().decode(seenRaw))
}

// --- District for official warnings -------------------------------------------------------------------------

async function watchLocationPermission() {
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' })
    locationPermission.value = status.state
    status.addEventListener('change', () => (locationPermission.value = status.state))
  } catch {
    // Without Permissions API: only the button „Standort erlauben“ shows whether it works.
  }
}

/** Page visible again: determine the district anew if official warnings are on and the location is allowed. */
export function refreshRegion() {
  if (curatedChannel.peek() && locationPermission.peek() === 'granted') void locate()
}

function setRegion(value: AlertRegion | null) {
  region.value = value
  if (value) writeJson('alerts.region', value)
  else local.set('alerts.region', null)
}

function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('geolocation'))
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 20_000 })
  })
}

let locatingNow = false

/**
 * Approximate location → district, everything in the browser; the location itself is not stored. Asks for the location
 * if the browser does not know yet: only after a click (switching on, „Standort erlauben“), never on load.
 */
export async function locate() {
  if (locatingNow) return
  locatingNow = true
  locating.value = 'busy'
  try {
    const pos = await currentPosition()
    const found = (await loadRegionTable()).nearest(pos.coords.latitude, pos.coords.longitude)
    // Outside Germany: no official warnings instead of those of a distant district.
    locating.value = found ? 'idle' : 'abroad'
    const known = region.peek()
    if (found?.kreis !== known?.kreis || found?.name !== known?.name) setRegion(found)
  } catch (e) {
    // Denied (code 1): the known district stays, the hint says where to allow it.
    if ((e as { code?: number })?.code === 1) {
      locationPermission.value = 'denied'
      locating.value = 'idle'
    } else {
      locating.value = 'failed'
    }
  } finally {
    locatingNow = false
  }
}

// --- Actions ----------------------------------------------------------------------------------------------

export async function createChannel(name: string): Promise<Channel> {
  const c = channelOf(await core!.createChannel(name.trim()))
  refreshChannels()
  return c
}

/** Name of the channel behind a link before subscribing to it; `null` if it is none. */
export function inspectChannelLink(link: string): { name: string; curated: boolean; channelId: string; seenByOwner: boolean } | null {
  const i = core?.parseChannelLink(link.trim())
  return i ? { name: i.name, curated: i.curated, channelId: i.channelId, seenByOwner: i.seenByOwner } : null
}

/**
 * `joined`, `already`, `foreign` or `invalid`. If this adds official warnings (button or link), the
 * browser asks for the approximate location now, not already on load.
 */
export async function joinChannel(link: string): Promise<string> {
  const curated = !!core!.parseChannelLink(link.trim())?.curated
  const r = await core!.joinChannel(link.trim())
  refreshChannels()
  if (r === 'joined' && curated) void locate()
  return r
}

/** Switch on official warnings: subscribe to the curated channel from the configuration and determine the district. */
export function enableOfficial(): Promise<string> {
  return joinChannel(OFFICIAL_ALERTS_LINK)
}

export function channelLink(channelId: string): string | null {
  return core?.channelLink(channelId) ?? null
}

export async function leaveChannel(channelId: string) {
  const curated = !!channels.value.find((c) => c.id === channelId)?.curated
  await core!.leaveChannel(channelId)
  // Without official warnings no district is needed any more either.
  if (curated) {
    setRegion(null)
    locating.value = 'idle'
  }
  const { [channelId]: _s, ...restSeen } = seen.value
  updateSeen(restSeen)
  const { [channelId]: _n, ...restNotify } = notifySettings.value
  notifySettings.value = restNotify
  writeJson('alerts.notify', restNotify)
  refreshChannels()
}

/** Alert into an own channel, without attachments. `invalid`: too long or link not http(s); `failed`: otherwise. */
export function sendAlert(channelId: string, prio: number, title: string, text: string, url: string): Promise<'sent' | 'invalid' | 'failed'> {
  return deliver((c) => c.sendAlert(channelId, prio, title.trim() || null, text.trim(), url.trim() || null, 0, null, false))
}

/**
 * Alert from the web app itself into an own channel (e.g. „Neue Support-Anfrage“, ADR 0065), without a notification
 * in the browser, like `sendQuietly` in the app. Only in channels whose owner is this person.
 */
export async function sendAlertQuietly(channelId: string, prio: number, title: string, text: string): Promise<boolean> {
  const channel = channels.value.find((c) => c.id === channelId)
  if (!core || !channel?.owner || channel.curated) return false
  try {
    const sent = await core.sendAlert(channelId, prio, title.trim(), text.trim(), null, 0, null, false)
    refreshChannels()
    return !!sent
  } catch {
    return false
  }
}

/**
 * All-clear for an active alert of an own channel ([canEnd]): info with the title of the alert (display and
 * notification put „Entwarnung:“ in front), short text, replaces [a] and ends it. The notification of the alert is
 * replaced in the process (tag in [notifyAlert]) and does not stay ([alertNotice]).
 */
export function endAlert(a: Alert): Promise<'sent' | 'invalid' | 'failed'> {
  const channel = channels.value.find((c) => c.id === a.channelId)
  if (!channel?.owner || channel.curated) return Promise.resolve('failed')
  return deliver((c) => c.sendAlert(a.channelId, INFO, a.title, texts.alerts.endAlertDefaultText, null, 0, a.id, true))
}

async function deliver(send: (c: AnmpCoreWeb) => Promise<AlertItem | null | undefined>): Promise<'sent' | 'invalid' | 'failed'> {
  if (!core) return 'failed'
  try {
    const sent = await send(core)
    refreshChannels()
    // The core does not report own alerts as new; as in the app the sending browser notifies too, only once.
    if (!sent) return 'failed'
    try {
      notifyAlert(alertOf(sent))
    } catch {
      // Sent is sent, even if the notification does not work.
    }
    return 'sent'
  } catch (e) {
    // The core checks length and link (IllegalArgumentException); the plaintext stays here.
    return String((e as Error)?.message ?? e).includes('invalid') || String(e).includes('Illegal') ? 'invalid' : 'failed'
  }
}

/** Removes a subscriber (ADR 0062 §11): new key for the others, the old link no longer applies. */
export async function removeSubscriber(channelId: string, deviceId: string): Promise<boolean> {
  const ok = await core!.removeSubscriber(channelId, deviceId)
  refreshChannels()
  return ok
}

/** New link; all previous subscribers get nothing afterwards. */
export async function resetChannelLink(channelId: string): Promise<boolean> {
  const ok = !!(await core!.resetChannelLink(channelId))
  refreshChannels()
  return ok
}

export async function createIngress(channelId: string, label: string): Promise<boolean> {
  const i = await core!.createIngress(channelId, label.trim() || texts.alerts.addressLabelDefault)
  refreshChannels()
  return !!i
}

export async function revokeIngress(channelId: string, ingressId: string): Promise<boolean> {
  const ok = await core!.revokeIngress(channelId, ingressId)
  refreshChannels()
  return ok
}

const attachmentUrls = new Map<string, Promise<string | null>>()

/** Attachment of an alert as a blob URL; `null` if it is not available right now (then again later). */
export function alertAttachmentUrl(a: Alert, index: number, mime: string): Promise<string | null> {
  const key = `${a.channelId}/${a.id}/${index}`
  let p = attachmentUrls.get(key)
  if (!p) {
    const item = items.get(`${a.channelId}/${a.id}`)
    const att = item?.attachments.asJsReadonlyArrayView()[index]
    p =
      core && item && att
        ? core.fetchAlertAttachment(item, att).then((bytes) => (bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })) : null), () => null)
        : Promise.resolve(null)
    attachmentUrls.set(key, p)
    p.then((url) => url ?? attachmentUrls.delete(key))
  }
  return p
}
