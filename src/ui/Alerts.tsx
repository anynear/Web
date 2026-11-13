// Section „Meldungen“ as in the app (AlertsScreen.kt, ADR 0062 §9): top left what is active right now, below it the
// channels and the official warnings; on the right a channel with history, settings of this browser and, for the owner,
// sending, sharing and addresses for devices. Alarms arrive in the browser only as a normal notification (§6).
import { useSignal } from '@preact/signals'
import { useEffect, useState } from 'preact/hooks'
import { texts } from '../i18n'
import { type Alert, type Channel, ALARM, INFO, WARNING, canEnd, replacedIds, statusAt } from '../core/alerts'
import {
  ackAlert,
  ackedActive,
  active,
  alertAttachmentUrl,
  alerts,
  channelLink,
  channels,
  createChannel,
  createIngress,
  curatedChannel,
  enableOfficial,
  endAlert,
  inspectChannelLink,
  joinChannel,
  leaveChannel,
  locate,
  locating,
  locationPermission,
  notifyOfChannel,
  now,
  officialAvailable,
  openRequest,
  pendingLink,
  priorityLabel,
  region,
  removeSubscriber,
  resetChannelLink,
  revokeIngress,
  rows,
  sendAlert,
  setNotify,
  setOpenChannel,
  unackAlert,
} from '../core/channels'
import { mimeOf } from '../core/media'
import { regionView } from '../core/regions'
import { pushState } from '../core/session'
import { Button, CopyLink, Dialog, Qr, Row, Section, Spinner } from './components'
import { ActionTile } from './Details'
import { LifeSignsSection, StartDialog } from './LifeSigns'
import { formatDateTime, formatListTime, formatShortDate, splitLinks } from './format'
import * as Icons from './icons'
import { alertSel, dialog, section } from './nav'
import { openViewer, type ViewerItem } from './Viewer'

function openChannel(id: string) {
  section.value = 'alerts'
  alertSel.value = id
}

/** Left list in the section „Meldungen“. */
export function AlertsNav() {
  const sel = alertSel.value
  const list = rows.value.filter((r) => !r.channel.curated)
  const curated = curatedChannel.value
  const curatedRow = curated ? rows.value.find((r) => r.channel.id === curated.id) : undefined
  const [busy, setBusy] = useState(false)
  const [ending, setEnding] = useState<Alert | null>(null)
  const [showAcked, setShowAcked] = useState(false)
  const replaced = replacedIds(alerts.value)
  const regionKnown = regionView(region.value, locationPermission.value, locating.value) === 'region'
  return (
    <>
      <div class="files-nav">
        <LifeSignsSection />
        {active.value.length > 0 && (
          <>
            <h2 class="section-title nav-title">{texts.alerts.activeSection}</h2>
            <div class="active-alerts">
              {active.value.map((a) => {
                const channel = channels.value.find((c) => c.id === a.channelId)
                return (
                  <AlertCard
                    key={`${a.channelId}/${a.id}`}
                    alert={a}
                    channel={channel}
                    big
                    onClick={() => openChannel(a.channelId)}
                    onAck={() => ackAlert(a.id)}
                    onEnd={canEnd(a, channel, replaced, now.value) ? () => setEnding(a) : undefined}
                  />
                )
              })}
            </div>
          </>
        )}
        {ackedActive.value.length > 0 && (
          <div class="acked-alerts">
            <p class="muted small acked-line">
              {texts.alerts.ackedHidden(ackedActive.value.length)}{' '}
              <button type="button" class="link-btn" aria-expanded={showAcked} onClick={() => setShowAcked(!showAcked)}>
                {showAcked ? texts.alerts.hideAcked : texts.alerts.showAcked}
              </button>
            </p>
            {showAcked && (
              <div class="active-alerts">
                {ackedActive.value.map((a) => (
                  <AlertCard
                    key={`${a.channelId}/${a.id}`}
                    alert={a}
                    channel={channels.value.find((c) => c.id === a.channelId)}
                    big
                    calm
                    onClick={() => openChannel(a.channelId)}
                    onUnack={() => unackAlert(a.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        <h2 class="section-title nav-title">{texts.alerts.channelsSection}</h2>
        {list.length === 0 ? (
          <div class="nav-note">
            <p class="muted small">
              <strong>{texts.alerts.emptyTitle}.</strong> {texts.alerts.emptyText}
            </p>
          </div>
        ) : (
          list.map((r) => <ChannelButton key={r.channel.id} row={r} active={sel === r.channel.id} />)
        )}
        {officialAvailable.value && (
          <>
            <h2 class="section-title nav-title">{texts.alerts.officialSection}</h2>
            {curated && curatedRow ? (
              <>
                <ChannelButton row={curatedRow} active={sel === curated.id} />
                {!regionKnown && <RegionInfo nav />}
              </>
            ) : (
              <div class="nav-note official-off">
                <p>
                  <strong>{texts.alerts.officialTitle}</strong>
                </p>
                <p class="muted small">{texts.alerts.officialSubtitle}</p>
                <Button
                  kind="secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    await enableOfficial().catch(() => 'invalid')
                    setBusy(false)
                  }}
                >
                  {texts.alerts.officialTurnOn}
                </Button>
              </div>
            )}
            <p class="muted small nav-note">
              {curated && regionKnown && region.value ? `${texts.alerts.regionFooter(region.value.name)} ` : ''}
              {texts.alerts.officialFooter}
            </p>
          </>
        )}
      </div>
      {ending && <EndAlertDialog alert={ending} onClose={() => setEnding(null)} />}
    </>
  )
}

/** A row as in the conversation list: name, last alert, time, number of unread important ones. */
function ChannelButton({ row, active: isActive }: { row: (typeof rows.value)[number]; active: boolean }) {
  const { channel, last, unread } = row
  const preview = last ? `${priorityLabel(last.prio, channel.curated, last.ended)} · ${last.title ?? last.text}` : texts.alerts.noAlertYet
  return (
    <button type="button" class={`conv ${isActive ? 'active' : ''}`} aria-current={isActive ? 'true' : undefined} onClick={() => openChannel(channel.id)}>
      <span class="nav-icon">{channel.curated ? <Icons.Warning /> : <Icons.Bell />}</span>
      <span class="conv-body">
        <span class="conv-top">
          <span class="conv-name">{channel.name}</span>
          {last && <span class={`conv-time ${unread ? 'fresh' : ''}`}>{formatListTime(last.ts, now.value)}</span>}
        </span>
        <span class="conv-bottom">
          <span class="conv-preview">{preview}</span>
          {unread > 0 && <span class="badge">{unread > 99 ? '99+' : unread}</span>}
        </span>
      </span>
    </button>
  )
}

/** Small badge with the priority; text next to it, never colour alone. */
function PriorityChip({ alert, curated }: { alert: Alert; curated: boolean }) {
  const kind = alert.ended ? 'clear' : alert.prio === ALARM ? 'alarm' : alert.prio === WARNING ? 'warning' : 'info'
  return <span class={`prio prio-${kind}`}>{priorityLabel(alert.prio, curated, alert.ended)}</span>
}

function StatusLabel({ alert }: { alert: Alert }) {
  const status = statusAt(alert, now.value)
  const text = status === 'active' ? texts.alerts.statusActive : status === 'ended' ? texts.alerts.statusEnded : texts.alerts.statusExpired
  return (
    <span class="alert-status">
      <span class={`dot ${status === 'active' ? 'ok' : ''}`} /> {text}
    </span>
  )
}

/** An alert as card. [big]: on top under „Gerade aktiv“, coloured. In the history quiet, with state, picture and link. */
function AlertCard({
  alert,
  channel,
  big = false,
  calm = false,
  onClick,
  onEnd,
  onAck,
  onUnack,
}: {
  alert: Alert
  channel?: Channel
  big?: boolean
  /** Quiet at the top too, e.g. acknowledged ones under „Gerade aktiv“. */
  calm?: boolean
  onClick?: () => void
  /** Button „Entwarnen“, only where [canEnd] allows it. */
  onEnd?: () => void
  /** Button „Gesehen“ under „Gerade aktiv“. */
  onAck?: () => void
  /** Button „Wieder einblenden“ for acknowledged ones. */
  onUnack?: () => void
}) {
  const status = statusAt(alert, now.value)
  const tone = big && !calm && status === 'active' ? (alert.prio === ALARM ? 'alarm' : 'warning') : 'calm'
  const details = [
    alert.source ? texts.alerts.fromSource(alert.source) : null,
    // Arrived via an address for devices: its name, known only to the owner.
    channel?.ingress.find((i) => i.id === alert.sender)?.label ?? null,
    status === 'active' && !alert.ended ? texts.alerts.validUntil(formatDateTime(alert.until, now.value)) : null,
  ].filter((x): x is string => !!x)
  const body = (
    <>
      <span class="alert-top">
        <PriorityChip alert={alert} curated={!!channel?.curated} />
        <span class="alert-when">{[big ? channel?.name : null, formatDateTime(alert.ts, now.value)].filter(Boolean).join(' · ')}</span>
        {!big && <StatusLabel alert={alert} />}
      </span>
      {alert.title && <span class={`alert-title ${big ? 'big' : ''}`}>{alert.title}</span>}
      {alert.text && (
        <span class="alert-text">
          {big
            ? alert.text
            : splitLinks(alert.text).map((p, i) =>
                p.href ? (
                  <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">
                    {p.text}
                  </a>
                ) : (
                  p.text
                ),
              )}
        </span>
      )}
      {!big && alert.attachments.length > 0 && <AlertAttachments alert={alert} />}
      {details.length > 0 && <span class="alert-details">{details.join(' · ')}</span>}
    </>
  )
  const buttons = [
    onAck && (
      <Button key="ack" kind="secondary" class="alert-end" onClick={onAck}>
        {texts.alerts.gotIt}
      </Button>
    ),
    onUnack && (
      <Button key="unack" kind="secondary" class="alert-end" onClick={onUnack}>
        {texts.alerts.unack}
      </Button>
    ),
    onEnd && (
      <Button key="end" kind="secondary" class="alert-end" onClick={onEnd}>
        {texts.alerts.endAlert}
      </Button>
    ),
  ].filter(Boolean)
  const end = buttons.length > 0 && <span class="alert-actions">{buttons}</span>
  // With buttons the card itself must not be a button (no button in a button): then the content opens the channel.
  if (onClick && end) {
    return (
      <div class={`alert-card ${tone}`}>
        <button type="button" class="alert-card-open" onClick={onClick}>
          {body}
        </button>
        {end}
      </div>
    )
  }
  if (onClick) {
    return (
      <button type="button" class={`alert-card ${tone}`} onClick={onClick}>
        {body}
      </button>
    )
  }
  return (
    <div class={`alert-card ${tone}`}>
      {body}
      {alert.url && (
        <a class="btn btn-secondary alert-open" href={alert.url} target="_blank" rel="noopener noreferrer">
          <Icons.Link size={18} /> {texts.alerts.openContext}
        </a>
      )}
      {end}
    </div>
  )
}

/** Pictures are loaded and shown; tapping opens picture or file in the app's viewer, never in a new tab. */
function AlertAttachments({ alert }: { alert: Alert }) {
  return (
    <span class="alert-atts">
      {alert.attachments.map((a) => (a.type === 'jpg' ? <AlertImage key={a.index} alert={alert} index={a.index} /> : <AlertFile key={a.index} alert={alert} index={a.index} name={a.name} type={a.type} />))}
    </span>
  )
}

function alertItem(alert: Alert, index: number, name: string, type: string): ViewerItem {
  const label = name || (type === 'pdf' ? texts.attachment.pdf : type === 'jpg' ? texts.attachment.photo : texts.attachment.file)
  return {
    kind: type === 'jpg' ? 'photo' : type === 'pdf' ? 'pdf' : 'file',
    name: type === 'jpg' ? name : label,
    load: () => alertAttachmentUrl(alert, index, type === 'jpg' ? 'image/jpeg' : mimeOf(type, label)),
  }
}

/** Viewer for a picture of the alert; the other pictures can be paged through in it. */
function openAlertImage(alert: Alert, index: number) {
  const photos = alert.attachments.filter((a) => a.type === 'jpg')
  openViewer(
    photos.map((a) => alertItem(alert, a.index, a.name, a.type)),
    photos.findIndex((a) => a.index === index),
  )
}

function AlertImage({ alert, index }: { alert: Alert; index: number }) {
  const [url, setUrl] = useState<string | null | 'loading'>('loading')
  useEffect(() => {
    let live = true
    alertAttachmentUrl(alert, index, 'image/jpeg').then((u) => live && setUrl(u))
    return () => {
      live = false
    }
  }, [alert.id, index])
  if (url === 'loading') return <span class="att-photo placeholder"><Spinner /></span>
  if (!url) return <span class="muted small">{texts.alerts.imageUnavailable}</span>
  return (
    <button type="button" class="att-photo" aria-label={`${texts.attachment.open}: ${texts.attachment.photo}`} onClick={() => openAlertImage(alert, index)}>
      <img src={url} alt="" />
    </button>
  )
}

function AlertFile({ alert, index, name, type }: { alert: Alert; index: number; name: string; type: string }) {
  const label = name || (type === 'pdf' ? texts.attachment.pdf : texts.attachment.file)
  return (
    <button type="button" class="att-file" aria-label={`${texts.attachment.open}: ${label}`} onClick={() => openViewer([alertItem(alert, index, name, type)])}>
      <Icons.File />
      <span class="att-file-body">
        <span class="att-file-name">{label}</span>
      </span>
    </button>
  )
}

/** A channel (right): history, actions of the owner, settings of this browser. */
export function ChannelPage({ id }: { id: string }) {
  const channel = channels.value.find((c) => c.id === id)
  const history = alerts.value.filter((a) => a.channelId === id)
  const [composing, setComposing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [ending, setEnding] = useState<Alert | null>(null)
  // As with circles and chats: the title leads to the details of the channel (app: ChannelDetailScreen).
  const [details, setDetails] = useState(false)
  useEffect(() => setDetails(false), [id])
  const replaced = replacedIds(history)
  // Everything here counts as read, also what arrives while the page is open.
  useEffect(() => {
    setOpenChannel(id)
    return () => setOpenChannel(null)
  }, [id, history.length])
  // Channel left or removed: back to the overview.
  useEffect(() => {
    if (!channel) alertSel.value = null
  }, [!channel])
  if (!channel) return null
  const subtitle = channel.curated ? (region.value ? texts.alerts.kindOfficialIn(region.value.name) : texts.alerts.kindOfficial) : channel.owner ? texts.alerts.kindOwn : texts.alerts.kindSubscribed
  if (details) {
    return (
      <section class="page">
        <header class="page-head">
          <button type="button" class="icon-btn back-btn" aria-label={texts.nav.back} onClick={() => setDetails(false)}>
            <Icons.Back />
          </button>
          <div>
            <h1>{channel.name}</h1>
            <p class="muted small">{subtitle}</p>
          </div>
        </header>
        <div class="page-body">
          <BrowserSettings channel={channel} />
          {channel.curated && (
            <Section>
              <RegionInfo />
            </Section>
          )}
          {channel.owner && !channel.curated && <Subscribers channel={channel} />}
          {channel.owner && <Advanced channel={channel} />}
          <Section>
            <Row
              icon={<Icons.Close />}
              title={<span class="error">{channel.owner ? texts.alerts.remove : texts.alerts.leave}</span>}
              onClick={() => {
                if (confirm(channel.owner ? texts.alerts.removeConfirm(channel.name) : texts.alerts.leaveConfirm(channel.name))) void leaveChannel(channel.id).catch(() => window.alert(texts.alerts.failed))
              }}
            />
          </Section>
        </div>
      </section>
    )
  }
  return (
    <section class="page">
      <header class="page-head">
        <button type="button" class="icon-btn back-btn" aria-label={texts.nav.back} onClick={() => (alertSel.value = null)}>
          <Icons.Back />
        </button>
        <button type="button" class="chat-title" onClick={() => setDetails(true)} title={texts.alerts.viewChannel}>
          <span>
            <span class="chat-name">
              <span>{channel.name}</span>
              <Icons.Forward size={18} />
            </span>
            <span class="chat-sub">{subtitle}</span>
          </span>
        </button>
      </header>
      <div class="page-body">
        {channel.owner && (
          <div class="action-tiles">
            <ActionTile icon={<Icons.Send />} label={texts.alerts.send} main onClick={() => setComposing(true)} />
            <ActionTile icon={<Icons.Share />} label={texts.alerts.share} onClick={() => setSharing(true)} />
          </div>
        )}
        <section class="section">
          <h2 class="section-title">{texts.alerts.history}</h2>
          {history.length === 0 && <p class="muted">{texts.alerts.noHistory}</p>}
          <div class="alert-list">
            {history.map((a) => (
              <AlertCard key={a.id} alert={a} channel={channel} onEnd={canEnd(a, channel, replaced, now.value) ? () => setEnding(a) : undefined} />
            ))}
          </div>
        </section>
      </div>
      {composing && <ComposeDialog channel={channel} onClose={() => setComposing(false)} />}
      {sharing && <ShareDialog channel={channel} onClose={() => setSharing(false)} />}
      {ending && <EndAlertDialog alert={ending} onClose={() => setEnding(null)} />}
    </section>
  )
}

/**
 * District for official warnings as in the app: quietly the name, with „Mehr dazu“. Without a district a short sentence
 * why, and a button; until then the web app shows no official warning and reports none. [nav]: in the left list.
 */
function RegionInfo({ nav = false }: { nav?: boolean }) {
  const view = regionView(region.value, locationPermission.value, locating.value)
  const current = region.value
  const more = (
    <details class={nav ? 'more nav-note' : 'card-pad more'}>
      <summary>{texts.alerts.moreInfo}</summary>
      <div class="region-more">
        <p class="small">{texts.alerts.regionInfo}</p>
        <p class="muted small">{texts.alerts.regionSource}</p>
      </div>
    </details>
  )
  let body
  // On the channel page the district is already in the header: here only problems and „Mehr dazu“.
  if (view === 'region' && !nav) body = null
  else if (view === 'region' || view === 'searching') {
    const title = current && view === 'region' ? current.name : texts.alerts.regionLocating
    const text = view === 'region' ? texts.alerts.regionSubtitle : undefined
    body = nav ? (
      <div class="conv region">
        <span class="nav-icon">
          <Icons.Map />
        </span>
        <span class="conv-body">
          <span class="conv-name">{title}</span>
          {text && <span class="conv-preview">{text}</span>}
        </span>
      </div>
    ) : (
      <Row icon={<Icons.Map />} title={title} text={text} />
    )
  } else {
    const message =
      view === 'abroad' ? texts.alerts.regionAbroad : view === 'failed' ? texts.alerts.regionFailed : texts.alerts.regionNeedsLocation
    body = (
      <div class={nav ? 'nav-note official-off' : 'card-pad official-off'}>
        <p class="small">{message}</p>
        {view === 'blocked' && <p class="muted small">{texts.alerts.regionBlocked}</p>}
        <Button kind="secondary" onClick={() => void locate()}>
          {view === 'failed' || view === 'abroad' ? texts.alerts.retry : texts.alerts.allowLocation}
        </Button>
      </div>
    )
  }
  return (
    <>
      {body}
      {more}
    </>
  )
}

/**
 * Notifications of this channel on or off (as in the app). „Laut, auch bei Stummschaltung“ does not exist in the
 * browser (ADR 0062 §6), only the sentence about it.
 */
function BrowserSettings({ channel }: { channel: Channel }) {
  const on = notifyOfChannel(channel.id)
  const notificationsOn = pushState() === 'on' || pushState() === 'tabOnly'
  return (
    <Section title={texts.alerts.onThisDevice} footer={texts.alerts.browserHint}>
      <label class="row row-button">
        <span class="row-icon">
          <Icons.Bell />
        </span>
        <span class="row-body">
          <span class="row-title">{texts.alerts.notifications}</span>
          <span class="row-text">{on ? texts.alerts.notificationsOn : texts.alerts.notificationsOff}</span>
        </span>
        <input type="checkbox" role="switch" class="switch" checked={on} onChange={(e) => setNotify(channel.id, e.currentTarget.checked)} />
      </label>
      {on && !notificationsOn && <p class="muted small card-pad">{texts.alerts.browserNotificationsOff}</p>}
    </Section>
  )
}

/** Who has subscribed to the own channel (ADR 0062 §11): name and since when, tap to remove. */
function Subscribers({ channel }: { channel: Channel }) {
  const [notice, setNotice] = useState('')
  return (
    <Section title={texts.alerts.subscribersSection} footer={notice || texts.alerts.subscribersFooter}>
      {channel.subscribers.length === 0 && <Row title={texts.alerts.noSubscribers} />}
      {channel.subscribers.map((s) => {
        const name = s.name.trim() || texts.alerts.someone
        return (
          <Row
            key={s.deviceId}
            icon={<Icons.Person />}
            title={name}
            text={texts.alerts.subscriberSince(formatShortDate(s.since))}
            onClick={async () => {
              if (!confirm(`${texts.alerts.removeSubscriberTitle(name)}\n\n${texts.alerts.removeSubscriberText(name)}`)) return
              const ok = await removeSubscriber(channel.id, s.deviceId).catch(() => false)
              setNotice(ok ? texts.alerts.subscriberRemoved(name) : texts.alerts.failed)
            }}
          />
        )
      })}
    </Section>
  )
}

/** „Erweitert“ for the owner: addresses for devices (ADR 0062 §4) and resetting the link. */
function Advanced({ channel }: { channel: Channel }) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState('')
  return (
    <>
      <details class="advanced" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>{texts.alerts.advanced}</summary>
      </details>
      {open && (
        <>
          <Section title={texts.alerts.addressesSection} footer={texts.alerts.addressesFooter}>
            {channel.ingress.length === 0 && <Row title={texts.alerts.noAddress} />}
            {channel.ingress.map((i) => (
              <div key={i.id} class="card-pad address">
                <div>
                  <p class="row-title">{i.label}</p>
                  <p class="muted small">{texts.alerts.addressCreated(formatShortDate(i.created))}</p>
                </div>
                <CopyLink link={i.url} />
                <p class="row-title">{texts.alerts.exampleHomeAssistant}</p>
                <CodeBlock code={texts.alerts.exampleHomeAssistantCode(i.url)} />
                <p class="row-title">{texts.alerts.exampleCommandLine}</p>
                <CodeBlock code={texts.alerts.exampleCommandLineCode(i.url)} />
                <Button
                  kind="danger"
                  onClick={() => {
                    if (confirm(texts.alerts.revokeConfirm(i.label))) void revokeIngress(channel.id, i.id).catch(() => window.alert(texts.alerts.failed))
                  }}
                >
                  {texts.alerts.revoke}
                </Button>
              </div>
            ))}
            <Row icon={<Icons.Plus />} title={texts.alerts.addAddress} onClick={() => setAdding(true)} />
            <details class="card-pad more">
              <summary>{texts.alerts.moreInfo}</summary>
              <p class="small">{texts.alerts.relayNote}</p>
            </details>
          </Section>
          <Section footer={notice || texts.alerts.resetLinkText}>
            <Row
              icon={<Icons.Lock />}
              title={texts.alerts.resetLink}
              onClick={async () => {
                if (!confirm(`${texts.alerts.resetLink}?\n\n${texts.alerts.resetLinkText}`)) return
                const ok = await resetChannelLink(channel.id).catch(() => false)
                setNotice(ok ? texts.alerts.resetLinkDone : texts.alerts.failed)
              }}
            />
          </Section>
        </>
      )}
      {adding && <AddAddressDialog channel={channel} onClose={() => setAdding(false)} />}
    </>
  )
}

/** Text to copy down (examples) with button „Kopieren“. */
function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div class="code-block">
      <pre class="mono">{code}</pre>
      <Button
        kind="quiet"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1800)
          } catch {
            // Without clipboard the text stays there for selecting.
          }
        }}
      >
        <Icons.Copy size={18} /> {copied ? texts.circle.copied : texts.alerts.copy}
      </Button>
    </div>
  )
}

// --- Dialogs ---------------------------------------------------------------------------------------------

/** Dialogs of the alerts and what comes from outside: channel link as deep link, click on a notification. */
export function AlertsDialogs() {
  const close = () => (dialog.value = null)
  useEffect(() => {
    const id = openRequest.value
    if (!id) return
    openRequest.value = null
    openChannel(id)
  }, [openRequest.value])
  const pending = pendingLink.value
  if (pending) {
    return (
      <JoinChannelDialog
        initial={pending}
        close={() => {
          pendingLink.value = null
        }}
      />
    )
  }
  if (dialog.value === 'createChannel') return <CreateChannelDialog close={close} />
  if (dialog.value === 'joinChannel') return <JoinChannelDialog close={close} />
  if (dialog.value === 'startLifeSign') return <StartDialog onClose={close} />
  return null
}

/** Enter a name, done (ADR 0062 §9); afterwards the new channel opens. */
function CreateChannelDialog({ close }: { close: () => void }) {
  const name = useSignal('')
  const busy = useSignal(false)
  const error = useSignal('')
  return (
    <Dialog title={texts.alerts.createChannel} onClose={close}>
      <form
        class="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault()
          busy.value = true
          try {
            const c = await createChannel(name.value)
            close()
            openChannel(c.id)
          } catch {
            error.value = texts.alerts.failed
          } finally {
            busy.value = false
          }
        }}
      >
        <p>{texts.alerts.createText}</p>
        <label class="field">
          <span>{texts.alerts.channelName}</span>
          <input class="input" autoFocus maxLength={40} value={name.value} onInput={(e) => (name.value = e.currentTarget.value)} />
        </label>
        {error.value && <p class="error">{error.value}</p>}
        <div class="dialog-actions">
          <Button kind="quiet" onClick={close}>
            {texts.common.cancel}
          </Button>
          <Button kind="main" type="submit" disabled={!name.value.trim() || busy.value}>
            {texts.alerts.create}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Channel link pasted or opened as deep link: something only happens after „Abonnieren“. */
function JoinChannelDialog({ close, initial = '' }: { close: () => void; initial?: string }) {
  const link = useSignal(initial)
  const busy = useSignal(false)
  const result = useSignal<{ ok: boolean; text: string } | null>(null)
  const invite = link.value.trim() ? inspectChannelLink(link.value) : null
  const known = invite ? channels.value.find((c) => c.id === invite.channelId) : undefined
  return (
    <Dialog title={invite ? texts.alerts.joinTitle(invite.name) : texts.alerts.joinChannel} onClose={close}>
      <form
        class="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault()
          busy.value = true
          try {
            const r = await joinChannel(link.value)
            const name = invite?.name ?? ''
            const ok = r === 'joined' || r === 'already'
            result.value = {
              ok,
              text: r === 'joined' ? texts.alerts.joined(name) : r === 'already' ? texts.alerts.alreadyJoined(name) : r === 'foreign' ? texts.alerts.linkForeignNetwork : texts.alerts.linkBroken,
            }
            if (ok && invite) {
              openChannel(invite.channelId)
              setTimeout(close, 1200)
            }
          } catch {
            result.value = { ok: false, text: texts.alerts.failed }
          } finally {
            busy.value = false
          }
        }}
      >
        {invite ? (
          <p>{invite.curated ? texts.alerts.joinOfficialText : invite.seenByOwner ? texts.alerts.joinSeenText : texts.alerts.joinText}</p>
        ) : (
          <label class="field">
            <span>{texts.alerts.joinLabel}</span>
            <input
              class="input mono"
              autoFocus
              placeholder={texts.alerts.joinPlaceholder}
              value={link.value}
              onInput={(e) => {
                link.value = e.currentTarget.value
                result.value = null
              }}
            />
          </label>
        )}
        {!invite && link.value.trim() && <p class="error">{texts.alerts.linkBroken}</p>}
        {known && !result.value && <p class="ok">{texts.alerts.alreadyJoined(known.name)}</p>}
        {result.value && <p class={result.value.ok ? 'ok' : 'error'}>{result.value.text}</p>}
        <div class="dialog-actions">
          <Button kind="quiet" onClick={close}>
            {invite ? texts.alerts.dontJoin : texts.common.cancel}
          </Button>
          <Button kind="main" type="submit" disabled={!invite || !!known || busy.value || !!result.value?.ok}>
            {texts.alerts.join}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Alert from the browser: priority, title, text, link; without attachments. */
function ComposeDialog({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const [prio, setPrio] = useState<number>(INFO)
  const title = useSignal('')
  const text = useSignal('')
  const url = useSignal('')
  const busy = useSignal(false)
  const error = useSignal('')
  return (
    <Dialog title={texts.alerts.composeTitle} onClose={onClose}>
      <form
        class="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault()
          busy.value = true
          error.value = ''
          const r = await sendAlert(channel.id, prio, title.value, text.value, url.value)
          busy.value = false
          if (r === 'sent') onClose()
          else error.value = r === 'invalid' ? texts.alerts.composeInvalid : texts.alerts.failed
        }}
      >
        <fieldset class="field prio-choice">
          <legend>{texts.alerts.priority}</legend>
          <div class="chips">
            {[INFO, WARNING, ALARM].map((p) => (
              <button key={p} type="button" class={`chip ${prio === p ? 'chosen' : ''}`} aria-pressed={prio === p} onClick={() => setPrio(p)}>
                {priorityLabel(p, channel.curated)}
              </button>
            ))}
          </div>
        </fieldset>
        <label class="field">
          <span>{texts.alerts.composeTitleField}</span>
          <input class="input" maxLength={120} value={title.value} onInput={(e) => (title.value = e.currentTarget.value)} />
        </label>
        <label class="field">
          <span>{texts.alerts.composeText}</span>
          <textarea class="input" rows={3} value={text.value} onInput={(e) => (text.value = e.currentTarget.value)} />
        </label>
        <label class="field">
          <span>{texts.alerts.composeUrl}</span>
          <input class="input" type="url" placeholder="https://" value={url.value} onInput={(e) => (url.value = e.currentTarget.value)} />
        </label>
        {error.value && <p class="error">{error.value}</p>}
        <div class="dialog-actions">
          <Button kind="quiet" onClick={onClose}>
            {texts.common.cancel}
          </Button>
          <Button kind="main" type="submit" disabled={!text.value.trim() || busy.value}>
            {texts.chat.send}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Confirmation before the all-clear; afterwards the alert is in the history as „entwarnt“ and no longer at the top. */
function EndAlertDialog({ alert, onClose }: { alert: Alert; onClose: () => void }) {
  const busy = useSignal(false)
  const error = useSignal('')
  const name = alert.title || alert.text.split('\n')[0].slice(0, 60)
  return (
    <Dialog title={texts.alerts.endAlertTitle(name)} onClose={onClose}>
      <div class="dialog-body">
        <p>{texts.alerts.endAlertText}</p>
        {error.value && <p class="error">{error.value}</p>}
        <div class="dialog-actions">
          <Button kind="quiet" onClick={onClose}>
            {texts.common.cancel}
          </Button>
          <Button
            kind="primary"
            disabled={busy.value}
            onClick={async () => {
              busy.value = true
              error.value = ''
              const r = await endAlert(alert)
              busy.value = false
              if (r === 'sent') onClose()
              else error.value = texts.alerts.failed
            }}
          >
            {texts.alerts.endAlert}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function ShareDialog({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const link = channelLink(channel.id)
  return (
    <Dialog title={texts.alerts.share} onClose={onClose}>
      <div class="dialog-body invite">
        <p>{texts.alerts.shareText}</p>
        {link ? (
          <>
            <Qr text={link} size={220} />
            <CopyLink link={link} />
          </>
        ) : (
          <p class="error">{texts.alerts.failed}</p>
        )}
      </div>
    </Dialog>
  )
}

function AddAddressDialog({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const label = useSignal('')
  const busy = useSignal(false)
  const error = useSignal('')
  return (
    <Dialog title={texts.alerts.addAddress} onClose={onClose}>
      <form
        class="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault()
          busy.value = true
          const ok = await createIngress(channel.id, label.value).catch(() => false)
          busy.value = false
          if (ok) onClose()
          else error.value = texts.alerts.failed
        }}
      >
        <label class="field">
          <span>{texts.alerts.addressLabel}</span>
          <input class="input" autoFocus maxLength={40} value={label.value} onInput={(e) => (label.value = e.currentTarget.value)} />
        </label>
        {error.value && <p class="error">{error.value}</p>}
        <div class="dialog-actions">
          <Button kind="quiet" onClick={onClose}>
            {texts.common.cancel}
          </Button>
          <Button kind="main" type="submit" disabled={busy.value}>
            {texts.alerts.create}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
