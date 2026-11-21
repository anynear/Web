// The session: an ANMP core (AnmpCoreWeb) as a further device of the person (ADR 0042), its state as signals for
// the UI and the message history in IndexedDB.
import { batch, computed, effect, signal } from '@preact/signals'
import {
  CircleState,
  Conversation,
  CoreEvent,
  DeviceInfo,
  DocInfo,
  FileTitle,
  ImageRef,
  MemberState,
  AnmpCoreWeb,
  WebBlobResult,
  WebHistoryAttachment,
  WebHistoryItem,
  type AnmpAttachment,
  type AnmpLink,
  type PreparedAttachment,
  type StoredFile,
  type WebHost,
  type LinkPreview,
  type ContactRequest,
  type SentRequest,
  Intro,
} from 'anmp-core'
import { texts } from '../i18n'
import { decideUpdate, markReload, readMarkers, reloadToNewVersion, updateState, type UpdateBanner, type WebUpdateState } from './appUpdate'
import { OFFICIAL_ALERTS_LINK, WARNING, channelLinkFromUrl } from './alerts'
import {
  alerts as channelAlerts,
  channels,
  markOpenSeen,
  onAlert,
  onSettings,
  openRequest,
  pendingLink,
  refreshRegion,
  sendAlertQuietly,
  startChannels,
  unread as alertsUnread,
} from './channels'
import { openMessageDb, deleteMessageDb, type MessageDb } from './db'
import { attachmentHash, mayAsk, shareable, waiting } from './attachmentWants'
import {
  type Att,
  type ConvKey,
  type LinkCard,
  type Msg,
  type PendingDelete,
  SELF,
  applyDelete,
  applyPending,
  applyReaction,
  applyReceipt,
  type EarlyReceipt,
  parkReceipts,
  withEarlyReceipts,
  b64u,
  circleKey,
  directKey,
  expiredPending,
  fromB64u,
  listedConversations,
  markDeleted,
  newMid,
  ownHistoryOf,
  parseKey,
  peerMoves,
  pendingDelete,
  repliedTo,
  replyOf,
  summarize,
  tabTitle,
  type IntroCard,
} from './messages'
import { draftText, saveDraftText } from './drafts'
import { browserDeviceName } from './device'
import { requestOriginText, withoutAsking } from './requests'
import { READ_UNTIL_SETTING, decodeMarks, hasNewer, mergeMarks, readOnArrival, type ReadMarks } from './readUntil'
import {
  CONTACT_NAMES_SETTING,
  activeContactNames,
  contactNamesDiffer,
  decodeContactNames,
  mergeContactNames,
  withContactName,
  type ContactNameEntries,
} from './contactNames'
import {
  SUPPORT_CIRCLE_PREFIX,
  SUPPORT_CONTACT_LINK,
  SUPPORT_LINK_URL,
  SUPPORT_NAME,
  parseSupportJson,
  SUPPORT_FORWARDED_MAX,
  SUPPORT_FORWARD_WINDOW,
  type SupportKind,
  alreadyAlerted,
  isSupportAlertChannel,
  pendingRequests,
  supportCircleName,
  supportInviteMessage,
  supportMessage,
} from './support'
import { LIMITS, shrinkImage, type Prepared } from './media'
import { browserStorage, clearStorage, local } from './storage'
import { notificationsOpen, offerGuide } from './guide'
import { checkUsageStats, startUsageStats } from './usageStats'
import { onAliveChanged, openLifeSign, startLifeSigns } from './lifesigns'
import { pendingLogin } from './login'
import { EMPTY as NO_SHARING, KEYS as SHARING_KEYS, Sharing, levelOfWire, takeSettings as takeSharing, type Level, type SharingState } from './sharing'
import { SPOT, spotLineOf } from './spots'
import { refreshSos, startSos } from './sos'
import { loginLinkFromUrl } from './loginLink'

export type Phase = 'loading' | 'unsupported' | 'pairing' | 'ready' | 'revoked'

export interface Person {
  id: string
  /** Shown name: the own name for the person if one gave them one ([setContactName]), otherwise [profileName]. */
  name: string
  /** Name from the person's own profile; shown small below an own name. */
  profileName: string
  devices: string[]
  image: ImageRef | null
  circles: string[]
  contact: boolean
  /** When the person became a contact (ms), from its first device; 0 = unknown or no contact. */
  addedAt: number
}

export interface CircleView {
  id: string
  name: string
  removed: boolean
  historyPending: boolean
  image: ImageRef | null
  /** When one joined or created the circle (ms); 0 = unknown. */
  joinedAt: number
  /** Persons in the circle, the own one first. */
  members: Person[]
  /** How many of one's own devices are in the circle, this one included (ADR 0042). */
  ownDevices: number
}

/** How long pairing waits for the phone (like the app: 10 minutes). */
const PAIRING_WAIT_S = 600
/**
 * Maximum length of a text with internet path (ADR 0031): 4096 characters, counted as Unicode code points
 * ([textChars], after `trim()`), the same in the app. At most 16384 bytes in UTF-8; radio keeps its own, smaller limit.
 */
export const MAX_TEXT_CHARS = 4096

export const phase = signal<Phase>('loading')
/** Guided steps after pairing (ADR 0073 §9): notifications and official warnings, once per browser. */
export const guidePending = signal(local.get('guide') === 'pending')

export function finishGuide() {
  local.set('guide', null)
  guidePending.value = false
}

/** Notifications are possible here but not switched on by the web app (step of the guided steps). */
export function notificationsToSwitchOn(): boolean {
  const supported = typeof Notification !== 'undefined'
  return notificationsOpen(supported, supported ? Notification.permission : 'denied', pushState() !== 'off')
}

/**
 * Browsers paired before the guided steps existed, or whose permission the browser had already given (then the step was
 * skipped and notifications stayed off): show the guided steps once more, if notifications are still to switch on.
 */
function offerGuideOnce() {
  if (guidePending.value) return
  const offer = offerGuide(isPaired(), local.get('guideOffered') === '1', notificationsToSwitchOn())
  if (isPaired()) local.set('guideOffered', '1')
  if (!offer) return
  local.set('guide', 'pending')
  guidePending.value = true
}
export const me = signal<{ deviceId: string; personId: string } | null>(null)
export const ownName = signal('')
export const circles = signal<CircleView[]>([])
export const people = signal<Map<string, Person>>(new Map())
export const ownDevices = signal<DeviceInfo[]>([])
export const relays = signal({ reachable: 0, known: 0 })
/** The relays only serve newer versions (ADR 0061 decision 13): reload the page. */
export const updateNeeded = signal(false)
/** Update rule from the radio list for this build (ADR 0096). */
export const webUpdate = signal<WebUpdateState>({ kind: 'none', from: 0 })
/** Bumped by „Später“ and every check, so that the bar reads the markers and the clock again. */
export const updateTick = signal(0)
/** Notice of the update bar: notice with date or „Bitte aktualisiere anynear“ (clients.min, still old after reloading). */
export const updateBanner = computed<UpdateBanner>(() => {
  void updateTick.value
  return decideUpdate({ update: webUpdate.value, clientsMin: updateNeeded.value, now: Date.now(), ...readMarkers() }).banner
})
export const messages = signal<Msg[]>([])
export const openConv = signal<ConvKey | null>(null)
export const visible = signal(typeof document === 'undefined' ? true : document.visibilityState === 'visible')
/** Window has the focus; visible alone is not enough, a window behind another one often stays "visible". */
const focused = signal(typeof document === 'undefined' ? true : document.hasFocus())
/** Foreground: visible and focused. Only then does the open conversation count as read (ADR 0019). */
export const foreground = computed(() => visible.value && focused.value)

export const summaries = computed(() => summarize(messages.value))

let core: AnmpCoreWeb | null = null

/** Receivers for data from own devices (topic, content, device), e.g. the answer to „Am Handy bestätigen“. */
/** The own mailbox was not read through once yet on this device: direct chats still load (ADR 0107 §8). */
export const loadingMailbox = signal(false)

/** Circles whose space was not read through once yet on this device (ADR 0107 §8). */
export const loadingCircles = signal<string[]>([])

function refreshLoading() {
  if (!core) return
  loadingMailbox.value = core.loadingMailbox()
  loadingCircles.value = [...core.loadingCircles()]
}

/** Whether the messages of [conv] are still coming on this device (ADR 0107 §8). */
export function stillLoading(conv: ConvKey): boolean {
  const { kind, id } = parseKey(conv)
  return kind === 'circle' ? loadingCircles.value.includes(id) : loadingMailbox.value
}

// --- Read up to a point per conversation on all own devices (setting `read_until`, ADR 0107 §8) ---------------

let readMarks: ReadMarks = decodeMarks(local.get('read.until'))
let readMarksTimer: ReturnType<typeof setTimeout> | null = null

function setReadMarks(next: ReadMarks) {
  readMarks = next
  local.set('read.until', JSON.stringify(next))
}

/** Collected briefly, so reading in an open chat does not write the profile space for every message. */
function writeReadMarks() {
  if (readMarksTimer) clearTimeout(readMarksTimer)
  readMarksTimer = setTimeout(() => {
    readMarksTimer = null
    void core?.setSetting(READ_UNTIL_SETTING, JSON.stringify(readMarks)).catch(() => {})
  }, 3000)
}

/** [conv] has been read up to its newest message ([sentAt]: one that is only just being stored). */
function markReadUntil(conv: ConvKey, sentAt = 0) {
  let newest = sentAt
  for (const m of messages.value) if (m.conv === conv && !m.system && m.ts > newest) newest = m.ts
  if (newest <= (readMarks[conv] ?? 0)) return
  setReadMarks({ ...readMarks, [conv]: newest })
  writeReadMarks()
}

/** State from the person's settings: per conversation the later time wins; what was read there is read here. */
function takeReadMarks(text: string | null | undefined) {
  const remote = decodeMarks(text)
  const merged = mergeMarks(readMarks, remote)
  setReadMarks(merged)
  if (hasNewer(merged, remote)) writeReadMarks()
  for (const [conv, at] of Object.entries(remote)) {
    const read = messages.value.filter((m) => m.conv === conv && m.unread && m.ts <= at)
    if (!read.length) continue
    void save(read.map((m) => ({ ...m, unread: false })))
    void closeNotifications(conv)
  }
}

/** When this device began to load the messages after the emergency card or being added; noted at its first start. */
function loadingSince(): number {
  const known = Number(local.get('history.loadingSince'))
  if (known > 0) return known
  const now = Date.now()
  local.set('history.loadingSince', String(now))
  return now
}

/**
 * Hands the page's own direct history to the core once (ADR 0107 §6), again later until it got through. A new device
 * reads its mailbox itself; there is no hand-over between devices any more.
 */
async function keepOwnHistory(c: AnmpCoreWeb) {
  let pause = 30_000
  for (;;) {
    const items = ownHistoryOf(messages.value).map(
      (h) =>
        new WebHistoryItem(
          h.peer, h.mid, h.ts, h.text, h.author, h.replyTo, h.replyFrom,
          h.attachments.map((a) => new WebHistoryAttachment(a.id, a.key, a.type, a.name, a.size, a.width, a.height, a.duration, a.hash ?? null)),
        ),
    )
    if (await c.keepOwnHistory(items).catch(() => false)) return
    await new Promise((r) => setTimeout(r, pause))
    pause = Math.min(pause * 2, 30 * 60_000)
  }
}

export const ownDataListeners = new Set<(topic: string, data: Uint8Array, fromDevice: string) => void>()

/** The running core, for sections outside this file (passwords). */
export const coreRef = (): AnmpCoreWeb | null => core

/** Own picture as a blob URL (ADR 0050), from the own storage; `null`: generated picture. */
export const ownImage = signal<string | null>(null)

/** Device of the support identity from `SUPPORT_CONTACT_LINK`; `null` while unknown or if this here is the identity. */
const supportDevice = signal<string | null>(null)

/**
 * The support identity as a person (ADR 0065), like `supportPeer` in the app: no contact to write to, no
 * direct conversation in the list. `null` on the support identity itself.
 */
export const supportPeer = computed(() => (supportDevice.value ? personOfDevice(supportDevice.value) : null))

/** Circle of a request („Support: …“ with the support identity as a member); shows the picture of support. */
export function isSupportCircle(circleId: string): boolean {
  const support = supportPeer.value
  if (!support) return false
  const c = circles.value.find((x) => x.id === circleId)
  return !!c && c.name.startsWith(SUPPORT_CIRCLE_PREFIX) && c.members.some((p) => p.id === support)
}

/** Persons asking to become a contact (ADR 0116), shown as cards in „Nachrichten“ until answered. */
export const contactRequests = signal<ContactRequest[]>([])
/** Our requests not yet answered: „Anfrage gesendet“. */
export const sentRequests = signal<SentRequest[]>([])

/** Conversations in the overview „Nachrichten“, in no particular order (see [listedConversations]). */
export const listedConvs = computed(() => {
  const contacts: string[] = []
  for (const p of people.value.values()) if (p.contact) contacts.push(p.id)
  // What a person still asking wrote waits for the answer (ADR 0116).
  return withoutAsking(listedConversations(circles.value, contacts, summaries.value.keys(), me.value?.personId, supportPeer.value), contactRequests.value.map((r) => r.person))
})

/**
 * Counter on the icon of the installed web app: unread messages and alerts together, as in the app. Only what the
 * overview shows counts; otherwise a number would stay that no one can read away.
 */
export const badgeCount = computed(() => {
  const sums = summaries.value
  let n = alertsUnread.value
  for (const k of listedConvs.value) n += sums.get(k)?.unread ?? 0
  return n
})
if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
  effect(() => {
    const n = badgeCount.value
    const nav = navigator as Navigator & { setAppBadge(n?: number): Promise<void>; clearAppBadge(): Promise<void> }
    void (n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge()).catch(() => {})
  })
}

// The same number in the title of the browser tab (also without an installed web app).
if (typeof document !== 'undefined') {
  effect(() => {
    document.title = tabTitle(texts.appName, badgeCount.value)
  })
}

// A device became a person (ADR 0042): its direct conversation moves to the person, as in the app.
const pendingPeerMoves = computed(() => peerMoves(summaries.value.keys(), personOfDevice, me.value?.personId))
effect(() => {
  if (pendingPeerMoves.value.size) queueMicrotask(movePeers)
})

function movePeers() {
  const moves = pendingPeerMoves.value
  if (!moves.size) return
  void save(messages.value.filter((m) => moves.has(m.conv)).map((m) => ({ ...m, conv: moves.get(m.conv)! })))
  for (const [from, to] of moves) {
    if (!draftText(to) && draftText(from)) saveDraftText(to, draftText(from))
    saveDraftText(from, '')
    if ((readMarks[from] ?? 0) > (readMarks[to] ?? 0)) setReadMarks({ ...readMarks, [to]: readMarks[from] })
  }
  const opened = openConv.value
  if (opened && moves.has(opened)) openConv.value = moves.get(opened)!
}

let db: MessageDb | null = null
/** Deletions whose message is still missing (ADR 0068); also in IndexedDB, 30 days. */
let pendingDeletes: PendingDelete[] = []
/** Receipts that arrived before their own message (copy from another own device, ADR 0042). */
let earlyReceipts: EarlyReceipt[] = []

/** Starts the core; without a paired device it goes to pairing. */
export async function boot() {
  if (!(await cryptoSupported())) {
    phase.value = 'unsupported'
    return
  }
  db = await openMessageDb()
  messages.value = (await db.all()).sort((a, b) => a.ts - b.ts)
  pendingDeletes = await db.pendingDeletes()
  const expired = expiredPending(pendingDeletes, Date.now())
  if (expired.length) {
    pendingDeletes = pendingDeletes.filter((p) => !expired.includes(p.id))
    void db.removePendingDeletes(expired)
  }
  void showOwnImage()
  if (local.get('revoked')) {
    phase.value = 'revoked'
    return
  }
  const c = AnmpCoreWeb.Companion.createDefaultWithBlobs(browserStorage(), db.core, '', OFFICIAL_ALERTS_LINK ? [OFFICIAL_ALERTS_LINK] : [])
  core = c
  c.setHost({ sharedContent: (conversation: Conversation, hash: string) => sharedContent(conversation, hash) } as unknown as WebHost)
  startChannels(c, (title, body, tag, o) => void showNotification(title, body, tag, { channel: o.channel }, o), () => foreground.value)
  // Check-ins (ADR 0083): tapping the notification opens „Meldungen“ with the big button.
  startLifeSigns(c, (title, body, tag, requireInteraction) => void showNotification(title, body, tag, { channel: tag }, { requireInteraction }), {
    nameOf: (person) => (person === me.value?.personId ? ownName.value : people.value.get(person)?.name ?? ''),
    helpersOf: (circleId) => (circles.value.find((x) => x.id === circleId)?.members ?? []).map((p) => p.id).filter((id) => id !== me.value?.personId),
    me: () => me.value?.personId ?? null,
    isSupport: isSupportCircle,
  })
  c.onEvent((e) => {
    try {
      onEvent(e)
    } catch (err) {
      console.warn('Ereignis', e, err)
    }
  })
  c.onState(() => refresh())
  c.onLoading(() => refreshLoading())
  // Note when this device began to load before anything arrives (ADR 0107 §8). Noted only once a message came back
  // while loading, a circle joined later counted everything sent before that moment as read and sent no read receipt.
  loadingSince()
  const deviceId = await c.start()
  refreshLoading()
  void c.setting(READ_UNTIL_SETTING).then(takeReadMarks).catch(() => {})
  void c.setting(CONTACT_NAMES_SETTING).then(takeContactNames).catch(() => {})
  startSos(c)
  void loadSharing(c)
  void keepOwnHistory(c)
  const id = c.identity()
  me.value = { deviceId, personId: id?.personId ?? deviceId }
  ownName.value = local.get('name') ?? ''
  void loadSupportLink()
  refresh()
  void refreshRequests()
  phase.value = isPaired() ? 'ready' : 'pairing'
  if (phase.value === 'ready') afterReady()
  takeChannelLink()
  takeLoginLink()
  // Online again: pending writes go at once instead of waiting out the delivery plan (ADR 0090).
  window.addEventListener('online', () => core?.networkChanged())
  document.addEventListener('visibilitychange', () => {
    visible.value = document.visibilityState === 'visible'
    if (visible.value) {
      core?.wakeUp()
      // Radio list earlier than every 6 hours (ADR 0096 §3); onState brings the new rule.
      core?.refreshRadioList().catch(() => {})
      checkUpdate()
      syncProfile()
      markOpenRead()
      markOpenSeen()
      refreshRegion()
      void checkUsageStats()
    }
  })
  window.addEventListener('focus', () => {
    focused.value = true
    markOpenRead()
    markOpenSeen()
  })
  window.addEventListener('blur', () => (focused.value = false))
}

let reloading = false

/**
 * Update rule for this build (ADR 0096). Also by the clock: „soon“ becomes „required“ at `from` without a new list.
 * „required“ reloads the page once by itself (at most once an hour); still old afterwards, only the bar stays.
 */
function checkUpdate() {
  const c = core
  if (!c) return
  let state: WebUpdateState
  try {
    state = updateState(c.webUpdate(__APP_BUILD__))
  } catch {
    return
  }
  const prev = webUpdate.value
  batch(() => {
    if (prev.kind !== state.kind || prev.from !== state.from) webUpdate.value = state
    updateTick.value++
  })
  if (reloading) return
  const now = Date.now()
  if (decideUpdate({ update: state, clientsMin: updateNeeded.value, now, ...readMarkers() }).reload && markReload(now)) {
    reloading = true
    void reloadToNewVersion()
  }
}
if (typeof window !== 'undefined') setInterval(checkUpdate, 10 * 60 * 1000)

/** Channel link as deep link (`/a#…`): remember it until the UI asks, and take it out of the address bar. */
function takeChannelLink() {
  const link = channelLinkFromUrl(location.pathname, location.hash)
  if (!link) return
  pendingLink.value = link
  history.replaceState(null, '', '/')
}

/** Login link as deep link (`/l#…`, ADR 0122): remember it for the dialog and take it out of the address bar. */
function takeLoginLink() {
  const link = loginLinkFromUrl(location.pathname, location.hash)
  if (!link) return
  pendingLogin.value = link
  history.replaceState(null, '', '/')
}

/** Paired as soon as the device list names more than this device or the handover has arrived once before. */
function isPaired(): boolean {
  return local.get('paired') === '1' || (core?.ownDevices().length ?? 0) > 1
}

function afterReady() {
  renewPush()
  offerGuideOnce()
  watchSupportRequests()
  if (core) startUsageStats(core)
  const own = core?.ownDevices().find((d) => d.deviceId === me.value?.deviceId)
  if (own && !own.name) void core?.setOwnDeviceName(browserDeviceName())
  const name = local.get('name')
  if (name && local.get('nameSent') !== name) {
    core?.setProfile(name).then(() => local.set('nameSent', name))
  }
  // A freshly paired browser also fetches the own picture this way.
  syncProfile()
}

/** Sync name, picture and settings with the relays, like the app at start and in the foreground (ADR 0050). */
function syncProfile() {
  if (phase.value === 'ready') core?.profileSync().catch(() => {})
}

/** The core needs Ed25519 and X25519 from WebCrypto (ADR 0036, risks). */
async function cryptoSupported(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: 'Ed25519' } as Algorithm, false, ['sign', 'verify'])
    await crypto.subtle.generateKey({ name: 'X25519' } as Algorithm, false, ['deriveBits'])
    return typeof indexedDB !== 'undefined'
  } catch {
    return false
  }
}

// --- Pairing --------------------------------------------------------------------------------------

/** Link for the QR code (`https://anynear.app/p#…`). */
export function pairingOffer(name: string): Promise<string> {
  return core!.pairingOffer(name)
}

/** Comparison code to show next to the QR (ADR 0093), as `482 913`; the phone shows the same. */
export async function ownPairingCode(): Promise<string | null> {
  const code = (await core!.ownPairingCode()) ?? null
  return code ? `${code.slice(0, 3)} ${code.slice(3)}` : null
}

/** Waits for the handover from the phone; `true`: paired, the page reloads. */
export async function awaitPairing(): Promise<boolean> {
  const extras = await core!.awaitPairing(PAIRING_WAIT_S)
  if (!extras) return false
  for (const x of extras) {
    if (x.name === 'name') {
      const name = new TextDecoder().decode(new Uint8Array(x.value.buffer, x.value.byteOffset, x.value.byteLength)).trim()
      if (name) local.set('name', name)
    }
  }
  local.set('paired', '1')
  // After the restart show the guided steps once (ADR 0073 §9).
  local.set('guide', 'pending')
  local.set('guideOffered', '1')
  guidePending.value = true
  // The core has to restart with the new keys (AnmpCore.awaitPairing).
  setTimeout(() => location.reload(), 600)
  return true
}

// --- State from the core ----------------------------------------------------------------------------

function refresh() {
  if (!core) return
  const c = core
  const all = new Map<string, Person>()
  const ident = c.identity()
  // The core does not list the own person among the members; the own other devices it does.
  const ownId = ident?.personId ?? me.value?.personId ?? ''
  const own: Person = { id: ownId, name: ownName.value, profileName: ownName.value, devices: c.ownDevices().map((d) => d.deviceId), image: null, circles: [], contact: false, addedAt: 0 }
  const personOf = (m: MemberState): Person => {
    const id = m.person
    if (id === ownId) return own
    let p = all.get(id)
    if (!p) {
      p = { id, name: m.name, profileName: m.name, devices: [], image: m.image ?? null, circles: [], contact: false, addedAt: 0 }
      all.set(id, p)
    }
    if (!p.devices.includes(m.deviceId)) p.devices.push(m.deviceId)
    if (!p.profileName && m.name) p.name = p.profileName = m.name
    if (!p.image && m.image) p.image = m.image
    return p
  }
  const views: CircleView[] = c.circles().map((s: CircleState) => {
    const members: Person[] = s.removed ? [] : [own]
    const ownHere = new Set(ident ? [ident.deviceId] : [])
    for (const m of c.members(s.id)) {
      if (m.person === ownId) ownHere.add(m.deviceId)
      const p = personOf(m)
      if (!p.circles.includes(s.id)) p.circles.push(s.id)
      if (!members.includes(p)) members.push(p)
    }
    return { id: s.id, name: s.name, removed: s.removed, historyPending: s.historyPending, image: s.image ?? null, joinedAt: Number(s.joinedAt), members, ownDevices: Math.max(ownHere.size, 1) }
  })
  for (const m of c.contacts()) {
    const p = personOf(m)
    p.contact = true
    const added = Number(m.addedAt)
    if (added > 0 && (p.addedAt === 0 || added < p.addedAt)) p.addedAt = added
  }
  own.contact = false
  // Own names cover the names from the profiles everywhere (like Person.merge in the app).
  const ownNames = activeContactNames(contactNameEntries.value)
  for (const p of all.values()) p.name = ownNames[p.id] ?? p.profileName
  const status = c.relays()
  batch(() => {
    if (ident) me.value = { deviceId: ident.deviceId, personId: ident.personId }
    circles.value = views.sort((a, b) => a.name.localeCompare(b.name))
    people.value = all
    ownDevices.value = c.ownDevices()
    relays.value = { reachable: status.reachable.asJsReadonlyArrayView().length, known: status.known.asJsReadonlyArrayView().length }
    updateNeeded.value = c.updateNeeded()
  })
  checkUpdate()
  if (phase.value === 'pairing' && isPaired()) {
    phase.value = 'ready'
    // Just paired: the same as at the start of a paired browser, also fetch the own picture.
    afterReady()
  }
}

export function personName(id: string | undefined, fallback?: string): string {
  if (!id) return fallback || texts.system.someone
  if (id === me.value?.personId) return ownName.value || texts.list.you
  return people.value.get(id)?.name || activeContactNames(contactNameEntries.value)[id] || fallback || texts.system.someone
}

// --- Own names for other people on all own devices (setting `contact_names`, like ContactNames in the app) -------

/** Own names with their change time; also resets, so that they go to the other devices. */
export const contactNameEntries = signal<ContactNameEntries>(decodeContactNames(local.get('contact.names')))

function setContactNameEntries(next: ContactNameEntries) {
  contactNameEntries.value = next
  local.set('contact.names', JSON.stringify(next))
  refresh()
}

/**
 * Gives the person [id] an own name that only applies to oneself and covers the name from their profile everywhere;
 * empty: back to the profile name („Zurücksetzen“). Goes to all own devices via the person's settings (ADR 0050).
 */
export function setContactName(id: string, name: string) {
  const next = withContactName(contactNameEntries.value, id, name, Date.now())
  if (next === contactNameEntries.value) return
  setContactNameEntries(next)
  void core?.setSetting(CONTACT_NAMES_SETTING, JSON.stringify(next)).catch(() => {})
}

/** State from the person's settings: per person the later change wins. */
function takeContactNames(text: string | null | undefined) {
  const remote = decodeContactNames(text)
  const merged = mergeContactNames(contactNameEntries.value, remote)
  if (contactNamesDiffer(merged, contactNameEntries.value)) setContactNameEntries(merged)
  if (contactNamesDiffer(merged, remote)) void core?.setSetting(CONTACT_NAMES_SETTING, JSON.stringify(merged)).catch(() => {})
}

/** Person for a device, across all circles and contacts. */
export function personOfDevice(deviceId: string): string {
  for (const p of people.value.values()) if (p.devices.includes(deviceId)) return p.id
  if (ownDevices.value.some((d) => d.deviceId === deviceId)) return me.value?.personId ?? deviceId
  return deviceId
}

export function convName(key: ConvKey): string {
  const { kind, id } = parseKey(key)
  if (kind === 'circle') return circles.value.find((c) => c.id === id)?.name ?? ''
  return personName(id)
}

// --- Events -------------------------------------------------------------------------------------------

function keyOf(c: Conversation): ConvKey {
  return c instanceof Conversation.Circle ? circleKey(c.circleId) : directKey((c as Conversation.Direct).personId)
}

function onEvent(e: CoreEvent) {
  if (e instanceof CoreEvent.Message) return onMessage(e)
  // Older alerts of a new channel are history (core, ADR 0062): visible, but without notification.
  if (e instanceof CoreEvent.Alert) return e.history ? undefined : onAlert(e.item)
  if (e instanceof CoreEvent.AliveChanged) return onAliveChanged()
  if (e instanceof CoreEvent.Reaction) return onReaction(e)
  if (e instanceof CoreEvent.Deleted) return onDeleted(e)
  if (e instanceof CoreEvent.Have) return void onHave(e.hash, e.ref)
  if (e instanceof CoreEvent.Receipt) {
    const person = personOfDevice(e.fromDevice)
    const mids = e.mids.asJsReadonlyArrayView().slice()
    earlyReceipts = parkReceipts(earlyReceipts, messages.value, person, mids, e.read)
    return save(applyReceipt(messages.value, person, mids, e.read))
  }
  if (e instanceof CoreEvent.Stored || e instanceof CoreEvent.SendFailed) settleWrite(e.ref, e instanceof CoreEvent.Stored)
  if (e instanceof CoreEvent.Stored) return update((m) => m.outgoing && m.mid === e.ref && m.status === 'sending', (m) => ({ ...m, status: 'sent' }))
  if (e instanceof CoreEvent.SendFailed) return update((m) => m.outgoing && m.mid === e.ref && m.status === 'sending', (m) => ({ ...m, status: 'failed' }))
  if (e instanceof CoreEvent.ReadElsewhere) {
    const key = keyOf(e.conversation)
    const mids = e.mids.asJsReadonlyArrayView()
    // Read on another own device: here too, and the notification of the conversation disappears.
    void closeNotifications(key)
    return update((m) => m.conv === key && !!m.unread && !!m.mid && mids.includes(m.mid), (m) => ({ ...m, unread: false }))
  }
  if (e instanceof CoreEvent.OwnData) {
    for (const l of ownDataListeners) l(e.topic, bytesOf(e.data), e.fromDevice)
    return
  }
  if (e instanceof CoreEvent.ProfileChanged) {
    if (e.imageChanged) void keepOwnImage(e.image ? bytesOf(e.image) : null)
    const settings = new Map<string, Uint8Array>()
    for (const [k, v] of e.settings.asJsReadonlyMapView()) settings.set(k, bytesOf(v))
    onSettings(settings)
    const marks = settings.get(READ_UNTIL_SETTING)
    if (marks) takeReadMarks(new TextDecoder().decode(marks))
    const names = settings.get(CONTACT_NAMES_SETTING)
    if (names) takeContactNames(new TextDecoder().decode(names))
    takeSharingSettings(settings)
    refreshSos()
    if (e.name) {
      ownName.value = e.name
      local.set('name', e.name)
      local.set('nameSent', e.name)
    }
    return
  }
  if (e instanceof CoreEvent.CircleGone) return forget(circleKey(e.circleId))
  if (e instanceof CoreEvent.CircleRenamed) return systemLine(e.circleId, texts.system.renamed(deviceName(e.byDevice), e.name))
  if (e instanceof CoreEvent.MemberLeft) return systemLine(e.circleId, texts.system.left(e.name || texts.system.someone))
  if (e instanceof CoreEvent.KeyChanged) return onKeyChanged(e)
  if (e instanceof CoreEvent.ContactRequestsChanged) return void refreshRequests()
  if (e instanceof CoreEvent.SosAsked) return onSosAsked(e.person)
  if (e instanceof CoreEvent.SosContactsChanged) return refreshSos()
  if (e instanceof CoreEvent.IntroAccepted) {
    return void save([
      { id: `sys|${newMid()}`, conv: directKey(e.toPerson), outgoing: false, text: texts.people.introAcceptedLine(personName(e.toPerson), e.name), ts: Date.now(), attachments: [], system: true },
    ])
  }
  if ((e as unknown) === CoreEvent.Revoked) {
    local.set('revoked', '1')
    phase.value = 'revoked'
  }
}

function deviceName(deviceId: string): string {
  return personName(personOfDevice(deviceId))
}

function onKeyChanged(e: CoreEvent.KeyChanged) {
  const who = e.byName || texts.system.someone
  switch (e.kind) {
    case CoreEvent.Companion.KIND_REMOVED_YOU:
      return systemLine(e.circleId, texts.system.removedYou(who))
    case CoreEvent.Companion.KIND_YOU_REMOVED:
      return systemLine(e.circleId, texts.system.youRemoved(e.removedName || texts.system.someone))
    case CoreEvent.Companion.KIND_YOU_RESET:
      return
    default:
      if (e.removedDevice) return systemLine(e.circleId, texts.system.removed(who, e.removedName || texts.system.someone))
      if (e.why === 'reset') return systemLine(e.circleId, texts.system.reset(who))
  }
}

function systemLine(circleId: string, text: string) {
  void save([{ id: `sys|${newMid()}`, conv: circleKey(circleId), outgoing: false, text, ts: Date.now(), attachments: [], system: true }])
}

function onMessage(e: CoreEvent.Message) {
  const ownPerson = me.value?.personId
  const own = e.fromPerson === ownPerson
  const conv = keyOf(e.conversation)
  const id = own && e.mid ? e.mid : `${e.fromDevice}|${e.mid ?? e.objectId}`
  if (messages.value.some((m) => m.id === id)) return
  const isOpen = openConv.value === conv && foreground.value
  const link = e.link ? linkOf(e.link) : undefined
  // Back after the emergency card: what was read on the old device comes back read (ADR 0107 §8).
  const ts = Number(e.timestampMillis)
  const restoredRead = !own && !e.history && stillLoading(conv) && readOnArrival(ts, readMarks[conv], loadingSince())
  const fresh: Msg = {
    id,
    conv,
    mid: e.mid ?? undefined,
    outgoing: own,
    fromDevice: e.fromDevice,
    fromPerson: e.fromPerson,
    fromName: e.fromName,
    text: e.text,
    ts,
    status: own ? 'sent' : undefined,
    recipients: own ? recipientsOf(conv) : undefined,
    unread: !own && !e.history && !isOpen && !restoredRead,
    attachments: e.attachments.asJsReadonlyArrayView().map(attOf),
    space: e.space || undefined,
    history: e.history || undefined,
    ...(link ? { link } : {}),
    ...replyOf(e.replyTo, e.replyFrom),
    ...(e.passedOn ? { passedOn: true } : {}),
    ...(e.spot ? { spot: { kind: e.spot.kind, latitude: e.spot.position?.latitude, longitude: e.spot.position?.longitude, at: e.spot.position ? Number(e.spot.position.at) : undefined, label: e.spot.label ?? undefined, until: e.spot.until != null ? Number(e.spot.until) : undefined, ...(e.spot.level != null ? { level: e.spot.level } : {}) } } : {}),
    ...(e.intro ? { intro: { id: e.intro.id, person: e.intro.person, name: e.intro.name, byPerson: e.intro.byPerson, until: Number(e.intro.until), card: e.intro.card } } : {}),
  }
  // Already deleted (the deletion came first): only the line, without notification.
  const [msg] = withParkedReceipts(withPendingDeletes([fresh]))
  void save([msg])
  // The other side answered the question to see each other, or lowered what both agreed on (ADR 0121 §28).
  if (!own && !e.history && msg.spot?.kind === SPOT.SHARED && parseKey(conv).kind === 'direct') onSharedAnswer(parseKey(conv).id, msg.spot.level ?? 0)
  // A person still asking (ADR 0116): one notice for the request, none per message.
  if (!own && !e.history && e.mid && !msg.deleted && !restoredRead && !e.fromRequest) {
    if (isOpen) {
      core?.confirmRead(e.fromDevice, e.mid, e.conversation)
      markReadUntil(conv, ts)
    } else notify(msg)
  }
}

function attOf(a: AnmpAttachment): Att {
  return {
    id: b64u(a.id),
    key: b64u(a.key),
    type: a.type,
    name: a.name ?? '',
    size: Number(a.size),
    width: a.width,
    height: a.height,
    duration: Number(a.duration),
    ...(a.hash ? { hash: b64u(a.hash) } : {}),
  }
}

function linkOf(l: AnmpLink): LinkCard {
  return {
    url: l.url,
    title: l.title ?? undefined,
    description: l.description ?? undefined,
    site: l.site ?? undefined,
    image: l.image ? attOf(l.image) : undefined,
  }
}

/** Tag of the author of a stored message; own ones without device (from the history) have none. */
function authorTag(m: Msg): string | null {
  const device = m.fromDevice ?? (m.outgoing && !m.history ? me.value?.deviceId : undefined)
  try {
    return device ? tagOf(device) : null
  } catch {
    return null
  }
}

/** Apply remembered deletions to newly arrived messages and then forget them. */
function withPendingDeletes(list: Msg[]): Msg[] {
  if (!pendingDeletes.length || !list.length) return list
  const { list: out, used } = applyPending(list, pendingDeletes, authorTag, Date.now())
  if (used.length) {
    pendingDeletes = pendingDeletes.filter((p) => !used.includes(p.id))
    void db?.removePendingDeletes(used)
  }
  return out
}

/** Apply receipts that arrived earlier to newly arrived own messages and then forget them. */
function withParkedReceipts(list: Msg[]): Msg[] {
  const { list: out, rest } = withEarlyReceipts(list, earlyReceipts)
  earlyReceipts = rest
  return out
}

/** The author has deleted a message for everyone (the core has checked that it is the same person). */
function onDeleted(e: CoreEvent.Deleted) {
  const conv = keyOf(e.conversation)
  const next = applyDelete(messages.value, conv, e.targetTag, e.targetMid, authorTag)
  if (next) {
    const before = messages.value.find((m) => m.id === next.id)
    if (!before || before.deleted) return
    void save([next])
    forgetContent(before)
    // The notification (one per conversation) disappears if it belonged to this message.
    if (before.unread) void closeNotifications(conv)
    return
  }
  const p = pendingDelete(conv, e.targetTag, e.targetMid, Date.now())
  pendingDeletes = pendingDeletes.filter((x) => x.id !== p.id).concat(p)
  void db?.putPendingDelete(p)
}

/** Discard cached attachments and preview picture of a deleted message. */
function forgetContent(m: Msg) {
  const atts = [...m.attachments, ...(m.link?.image ? [m.link.image] : [])]
  for (const a of atts) {
    const key = `a:${a.id}`
    const p = blobUrls.get(key)
    blobUrls.delete(key)
    p?.then((url) => url && URL.revokeObjectURL(url))
    void db?.removeBlob(key)
  }
}

function onReaction(e: CoreEvent.Reaction) {
  const conv = keyOf(e.conversation)
  const own = personOfDevice(e.fromDevice) === me.value?.personId || e.fromDevice === me.value?.deviceId
  const who = own ? SELF : personOfDevice(e.fromDevice)
  const target = messages.value.find((m) => m.conv === conv && m.mid === e.targetMid)
  if (!target || target.deleted) return
  const next = applyReaction(target, who, e.emoji, Number(e.timestampMillis))
  if (next) void save([next])
}

function recipientsOf(conv: ConvKey): string[] {
  const { kind, id } = parseKey(conv)
  if (kind === 'direct') return [id]
  const own = me.value?.personId
  return (circles.value.find((c) => c.id === id)?.members ?? []).map((p) => p.id).filter((p) => p !== own)
}

// --- Saving ---------------------------------------------------------------------------------------

async function save(list: Msg[]) {
  if (!list.length) return
  const byId = new Map(list.map((m) => [m.id, m]))
  const next = messages.value.filter((m) => !byId.has(m.id)).concat(list)
  next.sort((a, b) => a.ts - b.ts)
  messages.value = next
  await db?.put(list)
}

function update(match: (m: Msg) => boolean, change: (m: Msg) => Msg) {
  void save(messages.value.filter(match).map(change))
}

async function forget(conv: ConvKey) {
  const gone = messages.value.filter((m) => m.conv === conv).map((m) => m.id)
  messages.value = messages.value.filter((m) => m.conv !== conv)
  if (openConv.value === conv) openConv.value = null
  await db?.remove(gone)
}

// --- Actions of the UI ---------------------------------------------------------------------------------

export function open(conv: ConvKey | null) {
  openConv.value = conv
  markOpenRead()
}

/** "read" means: conversation open and page in the foreground, i.e. visible and focused (ADR 0019). */
export function markOpenRead() {
  const conv = openConv.value
  if (!conv || !foreground.value || !core) return
  // For the own other devices and a device after the emergency card: read up to the newest message.
  markReadUntil(conv)
  const unread = messages.value.filter((m) => m.conv === conv && m.unread)
  if (!unread.length) return
  const { kind, id } = parseKey(conv)
  const c = kind === 'circle' ? new Conversation.Circle(id) : new Conversation.Direct(id)
  for (const m of unread) if (m.fromDevice && m.mid) core.confirmRead(m.fromDevice, m.mid, c)
  void save(unread.map((m) => ({ ...m, unread: false })))
  void closeNotifications(conv)
}

export function canWrite(conv: ConvKey): boolean {
  const { kind, id } = parseKey(conv)
  if (kind === 'circle') return !!circles.value.find((c) => c.id === id && !c.removed)
  return !!core?.canWriteTo(id)
}

/**
 * Send a message, with up to five prepared files (ADR 0011). What the browser sends itself stays in
 * IndexedDB, so that it stays visible without the relays and a resend has the attachments again.
 */
export async function send(conv: ConvKey, text: string, files: Prepared[] = [], retry?: Msg, replyTo?: Msg, passedOn = false): Promise<boolean> {
  const body = text.trim()
  if (!core || (!body && !files.length && !retry?.attachments.length)) return false
  const c = core
  const mid = retry?.mid ?? newMid()
  const base: Msg = retry
    ? { ...retry, status: 'sending', ts: Date.now() }
    : {
        id: mid,
        conv,
        mid,
        outgoing: true,
        fromDevice: me.value?.deviceId,
        fromPerson: me.value?.personId,
        text: body,
        ts: Date.now(),
        status: 'sending',
        recipients: recipientsOf(conv),
        attachments: [],
        ...(replyTo && replyTo.conv === conv ? (replyRef(replyTo) ?? {}) : {}),
        // Passes on a message one got („Weiterleiten“, ADR 0118).
        ...(passedOn ? { passedOn: true } : {}),
      }
  // On resending, the content comes from the own storage.
  const sources: Prepared[] = retry
    ? (await Promise.all(retry.attachments.map(async (a) => ((await db?.getBlob(`a:${a.id}`)) ? { bytes: (await db!.getBlob(`a:${a.id}`))!, type: a.type, name: a.name, width: a.width, height: a.height } : null)))).filter(
        (x): x is Prepared => x !== null,
      )
    : files
  let msg = base
  try {
    const prepared: PreparedAttachment[] = []
    const atts: Att[] = []
    for (const f of sources) {
      const p = await c.prepareAttachment(f.bytes as unknown as Int8Array, f.type, f.name || null, f.width, f.height)
      const att = attOf(p.attachment)
      await db?.putBlob(`a:${att.id}`, f.bytes)
      prepared.push(p)
      atts.push(att)
    }
    if (retry) for (const a of retry.attachments) void db?.removeBlob(`a:${a.id}`)
    msg = { ...base, attachments: atts }
    await save([msg])
    const { kind, id } = parseKey(conv)
    const to = msg.replyTo ?? null
    const from = msg.replyTo ? (msg.replyFrom ?? null) : null
    const sent =
      kind === 'circle' ? await c.sendCircle(id, msg.text, mid, prepared, to, from, !!msg.passedOn) : await c.sendDirect(id, msg.text, mid, prepared, to, from, !!msg.passedOn)
    if (!sent) await save([{ ...msg, status: 'failed' }])
    return !!sent
  } catch {
    await save([{ ...msg, status: 'failed' }])
    return false
  }
}

/**
 * What an answer to [m] carries (ADR 0092): its message ID and the tag of its author's installation, found as for
 * reactions and deleting. `null` if [m] cannot be answered (no ID, deleted, line about the circle, author unknown).
 */
export function replyRef(m: Msg): { replyTo: string; replyFrom: string } | null {
  if (!m.mid || m.deleted || m.system) return null
  const author = m.outgoing ? (m.fromDevice ?? me.value?.deviceId) : m.fromDevice
  if (!author) return null
  try {
    return { replyTo: m.mid, replyFrom: tagOf(author) }
  } catch {
    return null
  }
}

/** The message [m] answers, if it is in this browser (ADR 0092). */
export function original(m: Msg): Msg | null {
  return repliedTo(messages.value, m, authorTag)
}

/** Set a reaction; the same emoji once more withdraws it (ADR 0018). */
export async function react(m: Msg, emoji: string) {
  if (!core || !m.mid) return
  const current = m.reactions?.[SELF]?.emoji
  const next = current === emoji ? '' : emoji
  const author = m.outgoing ? (m.fromDevice ?? me.value?.deviceId) : m.fromDevice
  if (!author) return
  const { kind, id } = parseKey(m.conv)
  const c = kind === 'circle' ? new Conversation.Circle(id) : new Conversation.Direct(id)
  const changed = applyReaction(m, SELF, next, Date.now())
  if (changed) await save([changed])
  await core.react(c, tagOf(author), m.mid, next)
}

/** Delete an own message for everyone (ADR 0068); `false` if it did not go out. */
export async function deleteForEveryone(m: Msg): Promise<boolean> {
  if (!core || !m.mid || !m.outgoing || m.deleted) return false
  const author = m.fromDevice ?? me.value?.deviceId
  if (!author) return false
  const { kind, id } = parseKey(m.conv)
  const c = kind === 'circle' ? new Conversation.Circle(id) : new Conversation.Direct(id)
  // What is still waiting does not go out any more (ADR 0090).
  await core.cancelSend(m.mid)
  const ok = await core.deleteMessage(c, tagOf(author), m.mid)
  if (!ok) return false
  const current = messages.value.find((x) => x.id === m.id) ?? m
  await save([markDeleted(current)])
  forgetContent(current)
  return true
}

/** Delete a message only in this browser, without a line; for the others it stays. */
export async function deleteForMe(m: Msg) {
  const current = messages.value.find((x) => x.id === m.id) ?? m
  // An own message that is still waiting does not go out any more (ADR 0090).
  if (m.outgoing && m.mid) await core?.cancelSend(m.mid)
  messages.value = messages.value.filter((x) => x.id !== m.id)
  forgetContent(current)
  await db?.remove([m.id])
}

/** Tag of the installation: the first 8 bytes of the device ID (ANMP). */
export function tagOf(deviceId: string): string {
  return b64u(fromB64u(deviceId).slice(0, 8))
}

export async function createCircle(name: string): Promise<string> {
  const c = await core!.createCircle(name.trim())
  refresh()
  return c.id
}

export function joinCircle(link: string): Promise<string> {
  return core!.joinCircle(link.trim())
}

export function inviteLink(circleId: string): string | null {
  return core?.inviteLink(circleId) ?? null
}

/** Only own devices left in the circle: leaving then also deletes the circle storage on the relays (ADR 0049 §5). */
export function aloneIn(circleId: string): boolean {
  return core?.aloneIn(circleId) ?? false
}

export async function leaveCircle(circleId: string) {
  await core!.leaveCircle(circleId)
  await forget(circleKey(circleId))
}

export async function removeMember(circleId: string, person: Person) {
  for (const d of person.devices) await core!.removeMember(circleId, d)
}

/** What an invitation link (circle, contact, channel) means, for the card in the chat; `null` if it is no good. */
export async function previewLink(link: string): Promise<LinkPreview | null> {
  return (await core?.previewLink(link)) ?? null
}

/** Delete a conversation only in this browser (like „Verlauf löschen“ of the app on one device). */
export function deleteHistory(conv: ConvKey): Promise<void> {
  return forget(conv)
}

/** Invites a person into an own circle: the invitation link as a direct message, a card on the other side. */
export async function inviteToCircle(personId: string, circleId: string): Promise<boolean> {
  const circle = circles.value.find((c) => c.id === circleId)
  const link = inviteLink(circleId)
  if (!circle || !link) return false
  return send(directKey(personId), texts.share.invite(circle.name, link))
}

export async function addContact(link: string): Promise<string> {
  const r = await core!.addContact(link.trim())
  void refreshRequests()
  return r
}

// --- Contact requests and introductions (ADR 0116) ----------------------------------------------------

export async function refreshRequests() {
  if (!core) return
  const before = new Set(contactRequests.value.map((r) => r.person))
  const now = [...(await core.contactRequests())]
  contactRequests.value = now
  const sentBefore = sentRequests.value
  sentRequests.value = [...(await core.sentContactRequests())]
  // A request of ours that ended before its time was answered: the person agreed. A line in the chat with it, as in
  // the app (an expired one ended without an answer).
  const at = Date.now()
  const sentNow = new Set(sentRequests.value.map((r) => r.person))
  const answered = sentBefore.filter((r) => !sentNow.has(r.person) && (!r.until || Number(r.until) > at))
  // A request over a contact link names the device, not the person: the line goes to the chat with the person.
  if (answered.length) refresh()
  void save(answered.map((r) => ({ id: `sys|${newMid()}`, conv: directKey(personOfDevice(r.deviceId ?? r.person)), outgoing: false, text: texts.people.requestAnsweredLine(r.name), ts: at, attachments: [], system: true })))
  for (const r of now) {
    if (before.has(r.person)) continue
    void showNotification(texts.people.requestTitle(r.name), requestOrigin(r), `request|${r.person}`, {})
  }
}

/** „Vorgestellt von Anna“ or „Über deinen Kontaktlink“. */
export function requestOrigin(r: ContactRequest): string {
  return requestOriginText(r.introducedByName)
}

/**
 * Agree to the request of [person]: it becomes a contact. A line in the chat with it and the chat opens, as in the app.
 * The conversation to open, `null` if there is no such request (any more).
 */
export async function acceptRequest(person: string): Promise<ConvKey | null> {
  const name = contactRequests.value.find((r) => r.person === person)?.name
  const ok = await core!.acceptContactRequest(person)
  await refreshRequests()
  refresh()
  if (!ok || name === undefined) return null
  const conv = directKey(person)
  await save([{ id: `sys|${newMid()}`, conv, outgoing: false, text: texts.people.requestAcceptedLine(name), ts: Date.now(), attachments: [], system: true }])
  return conv
}

/** Silent: the person learns nothing; what it wrote is deleted here. */
export async function declineRequest(person: string) {
  await core!.declineContactRequest(person)
  await forget(directKey(person))
  await refreshRequests()
}

/** Introduce the contact [personId] to the contact [toPerson]: a card in that chat; both are asked (ADR 0116). */
export async function introduce(personId: string, toPerson: string): Promise<boolean> {
  // The name the person gave itself, never an own name for it (ADR 0116 §2): the stand-in text goes to the other side.
  const name = people.value.get(personId)?.profileName || personName(personId)
  const text = texts.people.introStandIn(name)
  // The picture goes along as in the app (ADR 0116 §2); without one the introduction goes anyway.
  const image = await introImage(personId).catch(() => null)
  const mid = await core!.introduce(personId, toPerson, text, image)
  if (!mid) return false
  void save([
    {
      id: mid, conv: directKey(toPerson), mid, outgoing: true, text, ts: Date.now(), status: 'sent', recipients: [toPerson], attachments: [],
      intro: { id: '', person: personId, name, byPerson: me.value?.personId ?? '', until: Date.now() + 30 * 24 * 3600 * 1000, card: '' },
    },
  ])
  return true
}

/** Picture of the contact [personId] as a prepared `jpg` attachment for an introduction; `null` without one. */
async function introImage(personId: string): Promise<PreparedAttachment | null> {
  const ref = people.value.get(personId)?.image
  if (!ref || !core) return null
  const r = await core.fetchImageResult(ref)
  if (r.status !== WebBlobResult.Companion.FOUND || !r.bytes) return null
  const shrunk = await shrinkImage(new Blob([r.bytes as BlobPart]), LIMITS.avatarEdge, LIMITS.avatarQuality)
  if (!shrunk) return null
  return core.prepareAttachment(shrunk.bytes as unknown as Int8Array, 'jpg', null, shrunk.width, shrunk.height)
}

/** We want the contact of [intro]; the introducer passes the request on. Resolves like [addContact], or `requested`. */
export async function acceptIntro(intro: IntroCard): Promise<string> {
  const r = await core!.acceptIntro(new Intro(intro.id, intro.person, intro.name, intro.byPerson, BigInt(intro.until), intro.card, null))
  await refreshRequests()
  return r
}

/** Support link: built in, replaced by the one from the website if that one fits (ADR 0084 §7). */
let supportLink: string | null = SUPPORT_CONTACT_LINK
let supportLinkLoaded = 0

/**
 * Loads the support link from the website (at most once per hour) and remembers the device of the support identity.
 * It is only accepted as a contact link of this network named „anynear Support“; otherwise the built-in one stays.
 */
async function loadSupportLink(): Promise<void> {
  const c = core
  if (!c) return
  if (Date.now() - supportLinkLoaded > 60 * 60 * 1000) {
    supportLinkLoaded = Date.now()
    try {
      const r = await fetch(SUPPORT_LINK_URL, { credentials: 'omit' })
      const fetched = r.ok ? parseSupportJson(await r.text()) : null
      if (fetched && fetched !== supportLink) {
        const device = await c.contactDevice(fetched).catch(() => null)
        const preview = await c.previewLink(fetched).catch(() => null)
        if (device && preview?.kind === 'contact' && preview.name === SUPPORT_NAME) supportLink = fetched
      }
    } catch {
      // Without internet the built-in link stays.
    }
  }
  if (!supportLink) return
  const d = await c.contactDevice(supportLink).catch(() => null)
  if (d && d !== me.value?.deviceId && personOfDevice(d) !== me.value?.personId) supportDevice.value = d
}

/**
 * Request to support as in the app (ADR 0065): support identity as contact, own circle „Support: <subject>“
 * with the first message, then „Neue Anfrage: <subject>“ directly to support with the invitation link. There is no
 * log in the browser. Resolves to the circle, `null` if a step did not work.
 */
export async function sendSupportRequest(kind: SupportKind, subject: string, description: string, files: Prepared[] = []): Promise<ConvKey | null> {
  await loadSupportLink()
  if (!core || !supportLink) return null
  const added = await core.addContactPeer(supportLink).catch(() => null)
  const peer = added && (added.status === 'added' || added.status === 'known') ? added.peer : null
  if (!peer) return null
  const circleId = await createCircle(supportCircleName(subject)).catch(() => null)
  if (!circleId) return null
  const conv = circleKey(circleId)
  const kindLabel = kind === 'bug' ? texts.support.kindBug : texts.support.kindQuestion
  const versionLine = `anynear ${__APP_VERSION__} · Web (${browserDeviceName()})`
  if (!(await send(conv, supportMessage(`${kindLabel}: ${subject.trim()}`, description, versionLine), files))) return null
  const invite = inviteLink(circleId)
  if (!invite) return null
  if (!(await send(directKey(peer), supportInviteMessage(texts.support.newRequest, subject, invite)))) return null
  return conv
}

// --- Support identity (ADR 0065) ---------------------------------------------------------------------------

let supportWatching = false
let supportRunning = false
let supportAgain = false

/**
 * On the support identity, like `forwardSupportRequests` in the app: join every new request right away (invitation
 * link from the direct message, only circles „Support: …“) and send it as an alert into the own channel
 * „anynear-support“. Only does something if this person is the owner of a channel with that name, so in practice only
 * on the support identity. Runs on every new message and when the channels are loaded.
 */
function watchSupportRequests() {
  if (supportWatching) return
  supportWatching = true
  effect(() => {
    void messages.value
    void channels.value
    void forwardSupportRequests()
  })
}

async function forwardSupportRequests() {
  if (supportRunning) {
    supportAgain = true
    return
  }
  supportRunning = true
  try {
    do {
      supportAgain = false
      await forwardSupportRequestsOnce()
    } while (supportAgain)
  } finally {
    supportRunning = false
  }
}

async function forwardSupportRequestsOnce() {
  if (!core || phase.value !== 'ready') return
  const channel = channels.value.find(isSupportAlertChannel)
  if (!channel) return
  const done = readForwarded()
  const fresh = pendingRequests(messages.value, new Set(done), Date.now() - SUPPORT_FORWARD_WINDOW)
  if (!fresh.length) return
  const handled: string[] = []
  for (const r of fresh) {
    if (!(await joinSupportCircle(r.invite))) {
      console.warn('Support-Anfrage: Beitritt nicht möglich')
      continue
    }
    const text = texts.support.requestAlertText(r.subject)
    // If the support identity also runs in the app, that one may have reported already.
    const sent =
      alreadyAlerted(channelAlerts.value, channel.id, text, r.ts) ||
      (await sendAlertQuietly(channel.id, WARNING, texts.support.requestAlertTitle, text))
    if (sent) handled.push(r.id)
    else console.warn('Support-Anfrage: Meldung nicht gesendet')
  }
  if (handled.length) local.set('supportForwarded', JSON.stringify([...done, ...handled].slice(-SUPPORT_FORWARDED_MAX)))
}

/** Joins the request's circle; without a link or if already a member that counts as done. Only circles „Support: …“. */
async function joinSupportCircle(invite: string | null): Promise<boolean> {
  if (!invite) return true
  const preview = await previewLink(invite).catch(() => null)
  if (!preview || preview.kind !== 'circle' || !preview.name.startsWith(SUPPORT_CIRCLE_PREFIX)) return true
  if (preview.joined) return true
  try {
    await joinCircle(invite)
    refresh()
    return true
  } catch {
    return false
  }
}

function readForwarded(): string[] {
  try {
    const list = JSON.parse(local.get('supportForwarded') ?? '[]') as unknown
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function ownContactLink(): Promise<string> {
  return core ? core.ownContactLink() : Promise.reject(new Error('Kern nicht gestartet'))
}

/** Only the support identity (own channel „anynear-support“) gets a link for publishing (ADR 0084 §6). */
export const isSupportIdentity = computed(() => channels.value.some(isSupportAlertChannel))

/** Contact link for publishing, authorisation for 365 days (ADR 0084 §6). */
export function publicContactLink(): Promise<string> {
  return core ? core.publicContactLink() : Promise.reject(new Error('Kern nicht gestartet'))
}

/** Withdraws the link for publishing; the next one is a new one (ADR 0084 §6). */
export async function revokePublicContactLink(): Promise<void> {
  if (core) await core.revokePublicContactLink()
}

export async function setName(name: string) {
  const n = name.trim()
  if (!n || !core) return
  await core.setProfile(n)
  ownName.value = n
  local.set('name', n)
  local.set('nameSent', n)
}

/** Set the own picture (`null` removes it): downscaled as in the app (512 px), goes to all own devices. */
export async function setOwnPicture(file: File | null): Promise<boolean> {
  if (!core) return false
  const shrunk = file ? await shrinkImage(file, LIMITS.avatarEdge, LIMITS.avatarQuality) : null
  if (file && !shrunk) return false
  await core.setOwnImage((shrunk?.bytes ?? null) as unknown as Int8Array | null)
  await keepOwnImage(shrunk?.bytes ?? null)
  return true
}

async function keepOwnImage(bytes: Uint8Array | null) {
  if (bytes) await db?.putBlob('own-image', bytes)
  else await db?.removeBlob('own-image')
  await showOwnImage()
}

async function showOwnImage() {
  const bytes = await db?.getBlob('own-image')
  if (ownImage.value) URL.revokeObjectURL(ownImage.value)
  ownImage.value = bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' })) : null
}

export async function renameCircle(circleId: string, name: string): Promise<boolean> {
  const ok = await core!.renameCircle(circleId, name.trim())
  refresh()
  return ok
}

/** Set the circle picture or remove it with `null`; everyone in the circle sees it (ADR 0012). */
export async function setCirclePicture(circleId: string, file: File | null): Promise<boolean> {
  const shrunk = file ? await shrinkImage(file, LIMITS.avatarEdge, LIMITS.avatarQuality) : null
  if (file && !shrunk) return false
  const ok = await core!.setCircleImage(circleId, (shrunk?.bytes ?? null) as unknown as Int8Array | null)
  refresh()
  return ok
}

/** Invalidate old invitation links (key change, ADR 0012). */
export function resetInvites(circleId: string): Promise<void> {
  return core!.resetInvites(circleId)
}

export async function removeContact(personId: string) {
  await core!.removeContact(personId)
  refresh()
}

// --- Storage (ADR 0041) and circle storage (ADR 0049) ----------------------------------------------------------

/** `mine` or a circle ID. */
export type StoreScope = string

export async function listStore(scope: StoreScope): Promise<StoredFile[] | null> {
  if (!core) return null
  const l = await (scope === 'mine' ? core.storeList() : core.circleStoreList(scope))
  await updateStorage()
  return l ?? null
}

/** How full a storage is online (ADR 0029), the way the relays count; bytes. */
export interface StoreSpace {
  used: number
  quota: number
}

/**
 * Online storage across all storages together (ADR 0079): my storage and, in every circle, what one has stored
 * oneself; `null` while not known. Like `SharedStorage` in the app.
 */
export const storage = signal<StoreSpace | null>(null)

async function updateStorage() {
  const u = await core?.storageUsage().catch(() => null)
  if (u) storage.value = { used: Number(u.used), quota: Number(u.quota) }
}

/** List all storages once so that the sum is right (storages page). */
export async function refreshStorage() {
  if (!core) return
  await core.storeList().catch(() => null)
  for (const c of circles.value.filter((c) => !c.removed)) await core.circleStoreList(c.id).catch(() => null)
  await updateStorage()
}

/** From this share on the storage counts as almost full; full if less than 1 MB is free (as in the app). */
export const NEARLY_FULL = 0.9
const FULL_MARGIN = 1 << 20

export function spaceState(s: StoreSpace): 'ok' | 'nearlyFull' | 'full' {
  if (s.quota > 0 && s.quota - s.used < FULL_MARGIN) return 'full'
  return s.quota > 0 && s.used / s.quota >= NEARLY_FULL ? 'nearlyFull' : 'ok'
}

export async function fetchStored(scope: StoreScope, f: StoredFile): Promise<Uint8Array | null> {
  if (!core) return null
  const bytes = scope === 'mine' ? await core.storeFetch(f) : await core.circleStoreFetch(scope, f)
  return bytes ? bytesOf(bytes) : null
}

/** Waiters for the confirmation of a write (CoreEvent.Stored / SendFailed) per ref. */
const writes = new Map<string, (ok: boolean) => void>()

function settleWrite(ref: string, ok: boolean) {
  writes.get(ref)?.(ok)
  writes.delete(ref)
}

/** Waits until the first relay has accepted [ref]; `false` on rejection, after [ms] it counts as on the way. */
function stored(ref: string, ms = 20_000): Promise<boolean> {
  return new Promise((resolve) => {
    writes.set(ref, resolve)
    setTimeout(() => {
      if (writes.delete(ref)) resolve(true)
    }, ms)
  })
}

/** Store a file and wait until a relay has it; `false` if the circle is no longer there or the relays reject it. */
/**
 * Chooses the kind of a file by hand (ADR 0067) without uploading it again. The browser cannot detect it because it
 * does not read the text; the phones do that.
 */
export async function chooseStoredKind(scope: StoreScope, f: StoredFile, kind: string): Promise<boolean> {
  if (!core) return false
  const doc = f.doc ? f.doc.chosen(kind) : new DocInfo(kind, '', 0n, 0n, '', 0n, true, 0, [], 0)
  try {
    const ref = scope === 'mine' ? await core.storeUpdate(f, f.name, doc) : await core.circleStoreUpdate(scope, f, f.name, doc)
    if (ref == null) return false
    return await stored(ref)
  } catch {
    return false
  }
}

/**
 * Sets the title of a file by hand (ADR 0091) without uploading it again; empty gives it back to anynear (the phones
 * make it again). The browser makes no titles itself because it reads no text.
 */
export async function setStoredTitle(scope: StoreScope, f: StoredFile, text: string): Promise<boolean> {
  if (!core) return false
  const chosen = FileTitle.Companion.chosen(text)
  const title = chosen.text ? chosen : null
  try {
    const ref = scope === 'mine' ? await core.storeSetTitle(f, title) : await core.circleStoreSetTitle(scope, f, title)
    if (ref == null) return false
    return await stored(ref)
  } catch {
    return false
  }
}

/**
 * New content of the same file (e.g. a rotated photo): same ID, same name, same kind and details; the
 * phones fetch the new version on the next sync. `false` if the relays reject it.
 */
export async function replaceStored(scope: StoreScope, f: StoredFile, image: { bytes: Uint8Array; width: number; height: number }): Promise<boolean> {
  if (!core) return false
  const bytes = image.bytes as unknown as Int8Array
  try {
    const ref = scope === 'mine'
      ? await core.storeReplace(f, bytes, image.width, image.height)
      : await core.circleStoreReplace(scope, f, bytes, image.width, image.height)
    if (ref == null) return false
    return await stored(ref)
  } catch {
    return false
  }
}

export async function putStored(scope: StoreScope, p: Prepared, name: string): Promise<string | null> {
  if (!core) return null
  const id = crypto.randomUUID()
  const bytes = p.bytes as unknown as Int8Array
  const added = BigInt(Date.now())
  try {
    const ref = scope === 'mine' ? await core.storePut(id, bytes, name, p.type, added, p.width, p.height) : await core.circleStorePut(scope, id, bytes, name, p.type, added, p.width, p.height)
    if (ref == null) return null
    return (await stored(ref)) ? id : null
  } catch {
    return null
  }
}

/** Days in the bin without a subscription, as in the app and in the core (ADR 0086). */
export const BIN_DAYS = 7

/** In the bin (ADR 0086)? */
export const inBin = (f: StoredFile) => Number(f.trashed) > 0

/** Into the bin (ADR 0086): stays online and keeps counting until the core deletes it after [BIN_DAYS] days. */
export function trashStored(scope: StoreScope, file: string): Promise<boolean> {
  if (!core) return Promise.resolve(false)
  return scope === 'mine' ? core.storeTrash(file) : core.circleStoreTrash(scope, file)
}

export function restoreStored(scope: StoreScope, file: string): Promise<boolean> {
  if (!core) return Promise.resolve(false)
  return scope === 'mine' ? core.storeRestore(file) : core.circleStoreRestore(scope, file)
}

/** Delete permanently (from the bin). */
export function deleteStored(scope: StoreScope, file: string): Promise<boolean> {
  if (!core) return Promise.resolve(false)
  return scope === 'mine' ? core.storeDelete(file) : core.circleStoreDelete(scope, file)
}

function bytesOf(a: Int8Array): Uint8Array {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
}

// --- Pictures and attachments ---------------------------------------------------------------------------

const blobUrls = new Map<string, Promise<string | null>>()

/** Attachment as a blob URL; `null` if it is not available right now (then again later). */
export function attachmentUrl(m: Msg, a: Att, mime: string): Promise<string | null> {
  const key = `a:${a.id}`
  let p = blobUrls.get(key)
  if (!p) {
    p = db?.getBlob(`a:${a.id}`).then((own) => (own ? URL.createObjectURL(new Blob([own as BlobPart], { type: mime })) : fetchAttachment(m, a, mime))) ?? fetchAttachment(m, a, mime)
    blobUrls.set(key, p)
    p.then((url) => url ?? blobUrls.delete(key))
  }
  return p
}

/**
 * Attachment from the relays. Gone there (older than 30 days, ADR 0088): ask in the conversation; whoever still has it
 * puts it again (`have`, ADR 0014), then [onHave] stores it and [attachmentArrived] makes the chat load it anew.
 */
function fetchAttachment(m: Msg, a: Att, mime: string): Promise<string | null> {
  // In the core the same path as fetchAttachment (fetchBlob with object ID and key); AnmpAttachment lives in the
  // format module and is not exported from the core as a value.
  return core!.fetchImageResult(new ImageRef(a.id, a.key, m.space ?? '')).then((r) => {
    if (r.status === WebBlobResult.Companion.FOUND && r.bytes) return URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: mime }))
    if (r.status === WebBlobResult.Companion.GONE && a.hash) askFor(m.conv, a.hash)
    return null
  })
}

/** Attachment ID that just arrived over `have`; the chat loads it again. */
export const attachmentArrived = signal('')

const askedAt = new Map<string, number>()

function askFor(conv: ConvKey, hash: string) {
  if (!core || !mayAsk(askedAt, hash, Date.now())) return
  const { kind, id } = parseKey(conv)
  void core.want(kind === 'circle' ? new Conversation.Circle(id) : new Conversation.Direct(id), hash).catch(() => {})
}

/** Answer to `want`: fetch, check the hash, keep it for every attachment with this hash and show it (ADR 0014). */
async function onHave(hash: string, ref: ImageRef) {
  if (!core || !db) return
  const atts = waiting(messages.value, hash)
  const missing = (await Promise.all(atts.map(async (a) => ((await db!.getBlob(`a:${a.id}`)) ? null : a)))).filter((a): a is Att => a !== null)
  if (!missing.length) return
  const r = await core.fetchImageResult(ref)
  if (r.status !== WebBlobResult.Companion.FOUND || !r.bytes) return
  const bytes = new Uint8Array(r.bytes.buffer, r.bytes.byteOffset, r.bytes.byteLength)
  if ((await attachmentHash(bytes)) !== hash) return
  for (const a of missing) {
    await db.putBlob(`a:${a.id}`, bytes)
    blobUrls.delete(`a:${a.id}`)
    attachmentArrived.value = a.id
  }
}

/**
 * The core asks for an attachment someone wants (ADR 0014): only from this conversation and only what this browser
 * keeps itself (own sent attachments and those that came over `have`).
 */
async function sharedContent(conversation: Conversation, hash: string): Promise<Int8Array | null> {
  if (!db) return null
  for (const a of shareable(messages.value, hash, keyOf(conversation))) {
    const bytes = await db.getBlob(`a:${a.id}`)
    if (bytes && (await attachmentHash(bytes)) === hash) return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  return null
}

/** Picture of a person or a circle as a blob URL. */
export function imageUrl(ref: ImageRef): Promise<string | null> {
  const key = `i:${ref.space}:${ref.id}`
  let p = blobUrls.get(key)
  if (!p) {
    p = core!.fetchImage(ref).then((bytes) => (bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' })) : null))
    blobUrls.set(key, p)
    p.then((url) => url ?? blobUrls.delete(key))
  }
  return p
}

// --- Who sees me, sharing with each other (ADR 0121 §27–§29) -------------------------------------------------

/** The levels as the person set them, on every own device. */
export const sharingState = signal<SharingState>(NO_SHARING)

export const sharing = new Sharing(
  { write: (name, value) => void core?.setSetting(name, value).catch(() => {}) },
  local,
  (personId, wire) => void tellLowered(personId, wire),
  (next) => (sharingState.value = next),
)

async function loadSharing(c: AnmpCoreWeb) {
  const values = new Map<string, string | null>()
  for (const key of Object.values(SHARING_KEYS)) values.set(key, (await c.setting(key).catch(() => null)) ?? null)
  sharing.state = takeSharing(sharing.state, values)
  sharingState.value = sharing.state
}

function takeSharingSettings(settings: ReadonlyMap<string, Uint8Array>) {
  const values = new Map<string, string | null>()
  for (const key of Object.values(SHARING_KEYS)) {
    const v = settings.get(key)
    if (v) values.set(key, new TextDecoder().decode(v))
  }
  if (!values.size) return
  sharing.state = takeSharing(sharing.state, values)
  sharingState.value = sharing.state
}

function onSharedAnswer(personId: string, wire: number) {
  if (sharing.mutualOpen(personId)) sharing.mutualAnswered(personId, wire)
  else sharing.remoteLowered(personId, wire)
}

/**
 * A card about places to the person of [conv] (ADR 0121 §26): kept here at once like any sent message, [text] is what
 * older apps show. `false` if it did not go out.
 */
async function sendSpot(personId: string, text: string, kind: number, level: number): Promise<boolean> {
  const c = core
  if (!c) return false
  const conv = directKey(personId)
  const mid = newMid()
  const msg: Msg = {
    id: mid,
    conv,
    mid,
    outgoing: true,
    fromDevice: me.value?.deviceId,
    fromPerson: me.value?.personId,
    text,
    ts: Date.now(),
    status: 'sending',
    recipients: recipientsOf(conv),
    attachments: [],
    spot: { kind, level },
  }
  await save([msg])
  const sent = await c.sendDirectSpot(personId, text, mid, kind, level).catch(() => null)
  if (!sent) await save([{ ...msg, status: 'failed' }])
  return !!sent
}

/** „Standort gegenseitig teilen“: the own place is shown at [level] from now on, and the person is asked for the same. */
export async function askMutualPlace(personId: string, level: Level): Promise<boolean> {
  const sent = await sendSpot(personId, texts.place.mutualMessage, SPOT.SHARE, level === 'exact' ? 3 : 2)
  if (sent) sharing.askMutual(personId, level)
  return sent
}

/** The answer to the question of [personId]: [level] is what both see from now on, `null` for no. */
export async function answerMutualPlace(personId: string, level: Level | null): Promise<boolean> {
  const t = texts.place
  const sent = await sendSpot(personId, level ? t.mutualYesMessage : t.mutualNoMessage, SPOT.SHARED, level === 'exact' ? 3 : level === 'area' ? 2 : 0)
  if (sent && level) sharing.agreeMutual(personId, level)
  return sent
}

/** The own place was lowered below what both agreed on: the other side reads it in the chat. */
async function tellLowered(personId: string, wire: number) {
  const t = texts.place
  await sendSpot(personId, wire === 0 ? t.mutualEndedMessage : t.mutualLoweredMessage, SPOT.SHARED, wire)
}

/** The level a wire value stands for, for the cards. */
export function levelOfSpot(wire: number | undefined): Level {
  return levelOfWire(wire ?? 0)
}

/** A person asks us to be its SOS contact: the dialog shows it; a quiet notification if the page is not in front. */
function onSosAsked(person: string) {
  refreshSos()
  if (foreground.value) return
  void showNotification(texts.sos.askTitle(personName(person)), texts.sos.askNotice, `sos-ask:${person}`, {}, { silent: true })
}

// --- Notifications -----------------------------------------------------------------------------------------

function notify(m: Msg) {
  if (foreground.value || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  if (local.get('notify') !== '1') return
  const title = (parseKey(m.conv).kind === 'circle' ? convName(m.conv) : personName(m.fromPerson, m.fromName)) || texts.appName
  // A card says what it is about, not the stand-in text for older apps (ADR 0121 §26).
  const body = spotLineOf(m) ?? (m.text || texts.notification.newMessage)
  void showNotification(title, body, m.conv, { conv: m.conv })
}

/** Show via the service worker (also works where `new Notification` is not allowed); the neutral notice of Web Push gives way. */
async function showNotification(
  title: string,
  body: string,
  tag: string,
  data: { conv?: ConvKey; channel?: string },
  extra: { silent?: boolean; requireInteraction?: boolean } = {},
) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || local.get('notify') !== '1') return
  const options = { body, tag, icon: '/icon-192.png', data, silent: extra.silent ?? false, requireInteraction: extra.requireInteraction ?? false }
  const reg = await swRegistration()
  if (reg) {
    for (const n of await reg.getNotifications({ tag: 'push' })) n.close()
    await reg.showNotification(title, options)
    return
  }
  const n = new Notification(title, options)
  n.onclick = () => {
    window.focus()
    openFromNotification(data)
    n.close()
  }
}

function openFromNotification(d: { conv?: string | null; channel?: string | null }) {
  if (d.channel?.startsWith('alive:')) openLifeSign()
  else if (d.channel) openRequest.value = d.channel
  else if (d.conv) open(d.conv)
}

/** Read: the notification of the conversation disappears. */
async function closeNotifications(conv: ConvKey) {
  const reg = await swRegistration()
  for (const n of (await reg?.getNotifications({ tag: conv })) ?? []) n.close()
}

async function swRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null
  } catch {
    return null
  }
}

/** A click on a notification opens the conversation (message from the service worker). */
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data as { type?: string; conv?: string | null; channel?: string | null }
    if (d?.type === 'open') openFromNotification(d)
  })
}

export type PushState = 'unsupported' | 'blocked' | 'off' | 'on' | 'tabOnly'

/** Web Push (ADR 0060) only works with service worker and PushManager; on iPhone and iPad only as an installed app. */
export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined'
}

export function pushState(): PushState {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  if (local.get('notify') !== '1' || Notification.permission !== 'granted') return 'off'
  return local.get('push') === '1' ? 'on' : 'tabOnly'
}

/**
 * Switch on notifications: permission of the browser, notifications while the tab is open and, if the relays offer it,
 * Web Push also while the tab is closed (wake-up without content).
 */
export async function enableNotifications(): Promise<PushState> {
  const p = await Notification.requestPermission()
  local.set('notify', p === 'granted' ? '1' : null)
  if (p !== 'granted') return pushState()
  if (pushSupported()) await subscribePush()
  return pushState()
}

export async function disableNotifications(): Promise<PushState> {
  local.set('notify', null)
  local.set('push', null)
  core?.setWebPushTarget(null)
  const sub = await (await swRegistration())?.pushManager.getSubscription()
  await sub?.unsubscribe().catch(() => false)
  return pushState()
}

/** Get a subscription from the browser's push service (or take the existing one) and register it with the core. */
async function subscribePush(): Promise<boolean> {
  if (!core || !pushSupported()) return false
  const key = await core.webPushKey().catch(() => null)
  if (!key) return false
  const reg = await navigator.serviceWorker.ready
  const want = fromB64u(key)
  let sub = await reg.pushManager.getSubscription()
  // A subscription belongs to exactly one key; if the relays have a new one, a new subscription applies.
  const have = sub?.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null
  if (sub && (!have || have.length !== want.length || have.some((b, i) => b !== (want[i] & 0xff)))) {
    await sub.unsubscribe().catch(() => false)
    sub = null
  }
  try {
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: new Uint8Array(want) })
  } catch {
    return false
  }
  core.setWebPushTarget(sub.endpoint)
  local.set('push', '1')
  return true
}

/** At start: register a switched-on subscription with the core again (it only keeps it in memory). */
function renewPush() {
  if (local.get('notify') === '1' && Notification.permission === 'granted' && pushSupported()) void subscribePush()
}

// --- Resetting -----------------------------------------------------------------------------------------

/** Delete everything of anynear in this browser and reload. */
export async function eraseHere() {
  try {
    await core?.stop()
  } catch {
    // does not matter, everything is deleted anyway
  }
  clearStorage()
  await deleteMessageDb()
  location.reload()
}

// --- Radio setup over USB (ADR 0095) ----------------------------------------------------------------------------------

/** The signed software list for radios (ADR 0056), also without pairing; `null` without core or when it cannot be loaded. */
export async function radioSoftware() {
  try {
    return (await core?.radioSoftware()) ?? null
  } catch {
    return null
  }
}

/**
 * Where a radio on Wi-Fi uploads as a gateway (ADR 0054 §5b), from the signed radio list, also without pairing;
 * `null` without core or when the list names none.
 */
export async function radioGateway() {
  try {
    return (await core?.radioGateway()) ?? null
  } catch {
    return null
  }
}

/** Radio areas of the signed radio list in its order (ADR 0054 §1b); empty without core or list. */
export async function radioAreas(): Promise<string[]> {
  try {
    return Array.from((await core?.radioAreas()) ?? [])
  } catch {
    return []
  }
}

/** The area for a radio at the approximate position, with 2 km at borders; the position stays in the browser. */
export function radioAreaAt(lat: number, lon: number, current: string | null): string | null {
  return core?.radioAreaAt(lat, lon, current) ?? null
}

/** Settings of the area named [name] for the setup over the cable; `null` without such an area. */
export function radioArea(name: string) {
  return core?.radioArea(name) ?? null
}
