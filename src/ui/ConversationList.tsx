// Overview „Nachrichten“ as in the app: circles and direct conversations, newest on top, with number of new ones.
import { computed, useSignal } from '@preact/signals'
import { useRef } from 'preact/hooks'
import type { ImageRef } from 'anmp-core'
import { texts } from '../i18n'
import { parseKey, sortOverview, type ConvKey } from '../core/messages'
import { unread as alertsUnread } from '../core/channels'
import { acceptRequest, circles, contactRequests, declineRequest, listedConvs, loadingCircles, loadingMailbox, open, openConv, people, personName, requestOrigin, stillLoading, summaries } from '../core/session'
import { Avatar } from './Avatar'
import { formatListTime } from './format'
import * as Icons from './icons'
import { AlertsNav } from './Alerts'
import { FilesNav } from './Files'
import { CirclesNav, NewMessageNav, PickSections, pickHits } from './People'
import { MainHeader } from './MainMenu'
import { chatSearch, forwarding, newMessage, pane, section } from './nav'
import { CrashCard } from './CrashReport'
import { Button, Dialog, Row } from './components'
import { DeleteHistoryConfirm, LeaveCircleConfirm, toCircle, toPerson } from './Details'

interface Entry {
  key: ConvKey
  name: string
  kind: 'circle' | 'person'
  image: ImageRef | null
  preview: string
  ts: number
  /** When the contact was added or the circle joined or created (ms), 0 = unknown. */
  since: number
  removed: boolean
  unread: number
}

const entries = computed<Entry[]>(() => {
  const sums = summaries.value
  const list = listedConvs.value.map((key) => {
    const { kind, id } = parseKey(key)
    if (kind === 'circle') {
      const c = circles.value.find((x) => x.id === id)
      return entry(key, c?.name ?? '', 'circle', c?.image ?? null, c?.joinedAt ?? 0, c?.removed ?? false)
    }
    const p = people.value.get(id)
    return entry(key, personName(id), 'person', p?.image ?? null, p?.contact ? p.addedAt : 0, false)
  })
  return sortOverview(list)

  function entry(key: ConvKey, name: string, kind: 'circle' | 'person', image: Entry['image'], since: number, removed: boolean): Entry {
    const s = sums.get(key)
    const last = s?.last
    let preview = ''
    if (last?.deleted) preview = texts.chat.deletedMessage
    else if (last) {
      const body = last.text || attachmentPreview(last.attachments)
      preview = last.system ? body : last.outgoing ? `${texts.list.you}: ${body}` : kind === 'circle' ? `${personName(last.fromPerson, last.fromName)}: ${body}` : body
    }
    // Messages still coming after the emergency card: „Wird geladen …“ instead of „Noch keine Nachrichten“ (ADR 0107 §8).
    if (!last) preview = stillLoading(key) ? texts.list.loading : texts.chat.noMessagesYet
    return { key, name, kind, image, preview, ts: last?.ts ?? 0, since, removed, unread: s?.unread ?? 0 }
  }
})

export function ConversationList() {
  const query = useSignal('')
  // Right click or long press on a row (FUT 14.11.2026): the actions one looks for here, with the same confirmations
  // as on the circle and contact page.
  const actionsFor = useSignal<Entry | null>(null)
  const ask = useSignal<{ entry: Entry; what: 'leave' | 'history' } | null>(null)
  const longPress = useLongPress((e: Entry) => (actionsFor.value = e))
  const q = query.value.trim().toLowerCase()
  // As in the app: search in names and last message.
  const shown = q ? entries.value.filter((e) => e.name.toLowerCase().includes(q) || e.preview.toLowerCase().includes(q)) : entries.value
  // While searching, also circles and contacts without a conversation yet (ADR 0100 §2), like the app.
  const more = q ? pickHits(q, new Set(entries.value.map((e) => e.key))) : { circles: [], people: [] }
  const moreCount = more.circles.length + more.people.length
  const goFiles = () => {
    section.value = 'files'
    if (pane.value === 'settings' || pane.value === 'support') pane.value = 'chat'
  }
  const goAlerts = () => {
    section.value = 'alerts'
    if (pane.value === 'settings' || pane.value === 'support') pane.value = 'chat'
  }
  const goCircles = () => {
    section.value = 'circles'
    if (pane.value === 'settings' || pane.value === 'support') pane.value = 'chat'
  }
  const title =
    section.value === 'files' ? texts.nav.files : section.value === 'alerts' ? texts.nav.alerts : section.value === 'circles' ? texts.nav.circles : newMessage.value ? texts.list.newMessage : texts.nav.messages
  return (
    <>
    <nav class="rail" aria-label={texts.appName}>
      <img class="rail-logo" src="/brand/anynear-emblem-on-dark.svg" alt="anynear" width="44" height="38" />
      <div class="rail-items" role="tablist">
        <button type="button" role="tab" aria-selected={section.value === 'messages'} class={`rail-item ${section.value === 'messages' ? 'active' : ''}`} onClick={() => { section.value = 'messages'; if (pane.value === 'settings' || pane.value === 'support') pane.value = 'chat' }}>
          <Icons.Chat /> <span>{texts.nav.messages}</span>
        </button>
        <button type="button" role="tab" aria-selected={section.value === 'circles'} class={`rail-item ${section.value === 'circles' ? 'active' : ''}`} onClick={goCircles}>
          <Icons.Circle /> <span>{texts.nav.circles}</span>
        </button>
        <button type="button" role="tab" aria-selected={section.value === 'files'} class={`rail-item ${section.value === 'files' ? 'active' : ''}`} onClick={goFiles}>
          <Icons.Folder /> <span>{texts.nav.files}</span>
        </button>
        <button type="button" role="tab" aria-selected={section.value === 'alerts'} class={`rail-item ${section.value === 'alerts' ? 'active' : ''}`} onClick={goAlerts}>
          <span class="rail-icon">
            <Icons.Bell />
            {alertsUnread.value > 0 && <span class="rail-badge">{alertsUnread.value > 99 ? '99+' : alertsUnread.value}</span>}
          </span>
          <span>{texts.nav.alerts}</span>
        </button>
      </div>
    </nav>
    <nav class="list" aria-label={title}>
      <MainHeader title={title} />
      {section.value === 'files' ? (
        <FilesNav />
      ) : section.value === 'circles' ? (
        <CirclesNav />
      ) : section.value === 'alerts' ? (
        <AlertsNav />
      ) : newMessage.value || forwarding.value ? (
        <NewMessageNav />
      ) : (
        <>
          {!q && <CrashCard />}
          {!q && <RequestCards />}
          {/* New device or back from the emergency card: the messages are still coming (ADR 0107 §8). */}
          {(loadingMailbox.value || loadingCircles.value.length > 0) && <p class="hint">{texts.list.messagesLoading}</p>}
          <div class="list-tools">
            <input class="input search" type="search" placeholder={texts.list.search} value={query.value} onInput={(e) => (query.value = e.currentTarget.value)} />
            <div class="list-actions">
              <button type="button" class="list-action" onClick={() => (newMessage.value = true)}>
                <Icons.Edit size={18} /> {texts.list.newMessage}
              </button>
            </div>
          </div>
          {shown.length === 0 && moreCount === 0 && q ? (
            <div class="empty">
              <p>{texts.people.noResults}</p>
            </div>
          ) : shown.length === 0 && !q ? (
            <div class="empty">
              <h2>{texts.list.empty}</h2>
              <p>{texts.list.emptyText}</p>
            </div>
          ) : (
            <ul class="conversations">
              {shown.map((e) => (
                <li key={e.key}>
                  <button
                    type="button"
                    class={`conv ${openConv.value === e.key ? 'active' : ''}`}
                    aria-current={openConv.value === e.key ? 'true' : undefined}
                    onClick={() => {
                      if (longPress.fired()) return
                      pane.value = 'chat'
                      chatSearch.value = false
                      open(e.key)
                    }}
                    onContextMenu={(ev) => {
                      ev.preventDefault()
                      actionsFor.value = e
                    }}
                    {...longPress.handlers(e)}
                  >
                    <Avatar id={parseKey(e.key).id} kind={e.kind} image={e.image} />
                    <span class="conv-body">
                      <span class="conv-top">
                        <span class="conv-name">{e.name}</span>
                        {e.ts > 0 && <span class={`conv-time ${e.unread ? 'fresh' : ''}`}>{formatListTime(e.ts)}</span>}
                      </span>
                      <span class="conv-bottom">
                        <span class="conv-preview">{e.preview}</span>
                        {e.unread > 0 && <span class="badge">{e.unread > 99 ? '99+' : e.unread}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {moreCount > 0 && (
                <li class="search-more">
                  <PickSections hits={more} />
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </nav>
    {actionsFor.value && <ConvActions entry={actionsFor.value} onClose={() => (actionsFor.value = null)} onAsk={(what) => (ask.value = { entry: actionsFor.value!, what })} />}
    {ask.value?.what === 'leave' && (() => {
      const c = circles.value.find((x) => x.id === parseKey(ask.value!.entry.key).id)
      return c ? <LeaveCircleConfirm circle={c} onClose={() => (ask.value = null)} /> : null
    })()}
    {ask.value?.what === 'history' && (
      <DeleteHistoryConfirm id={parseKey(ask.value.entry.key).id} name={ask.value.entry.name} onClose={() => (ask.value = null)} />
    )}
    </>
  )
}

function ConvActions({ entry, onClose, onAsk }: { entry: Entry; onClose: () => void; onAsk: (what: 'leave' | 'history') => void }) {
  const { id } = parseKey(entry.key)
  const circle = entry.kind === 'circle' ? circles.value.find((c) => c.id === id) : undefined
  const choose = (action: () => void) => {
    action()
    onClose()
  }
  return (
    <Dialog title={entry.name} onClose={onClose}>
      <div class="dialog-body">
        <div class="card">
          {entry.kind === 'circle' ? (
            <>
              <Row icon={<Icons.Circle />} title={texts.circle.details} onClick={() => choose(() => toCircle(id))} />
              {circle && (
                <Row icon={<Icons.Trash />} title={<span class="danger-text">{circle.removed ? texts.circle.removeFromList : texts.circle.leave}</span>} onClick={() => choose(() => onAsk('leave'))} />
              )}
            </>
          ) : (
            <>
              <Row icon={<Icons.Person />} title={texts.contact.details} onClick={() => choose(() => toPerson(id))} />
              <Row icon={<Icons.Trash />} title={<span class="danger-text">{texts.contact.deleteHistory}</span>} onClick={() => choose(() => onAsk('history'))} />
            </>
          )}
        </div>
      </div>
    </Dialog>
  )
}

/** Long press with a finger (touch or pen): after 500 ms, without moving; the click that follows is swallowed. */
function useLongPress(onLong: (e: Entry) => void) {
  const state = useRef<{ timer?: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean }>({ x: 0, y: 0, fired: false })
  const cancel = () => clearTimeout(state.current.timer)
  return {
    fired() {
      const f = state.current.fired
      state.current.fired = false
      return f
    },
    handlers: (e: Entry) => ({
      onPointerDown: (ev: PointerEvent) => {
        if (ev.pointerType === 'mouse') return
        cancel()
        state.current = { x: ev.clientX, y: ev.clientY, fired: false }
        state.current.timer = setTimeout(() => {
          state.current.fired = true
          onLong(e)
        }, 500)
      },
      onPointerMove: (ev: PointerEvent) => {
        if (Math.abs(ev.clientX - state.current.x) > 10 || Math.abs(ev.clientY - state.current.y) > 10) cancel()
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
    }),
  }
}

/** Short form of the attachments for the overview, like `previewText` of the app („📷 Foto“, „🎤 Sprachnachricht“). */
function attachmentPreview(list: { type: string; name: string }[]): string {
  const a = list[0]
  if (!a) return ''
  if (a.type === 'jpg') return `📷 ${texts.attachment.photo}`
  if (a.type === 'm4a') return `🎤 ${texts.attachment.voice}`
  return `📎 ${a.name || (a.type === 'pdf' ? texts.attachment.pdf : texts.attachment.file)}`
}

/**
 * Persons asking to become a contact (ADR 0116), as in the app: agree or decline; what they wrote waits until then.
 * Several requests are one card that unfolds, so that they do not push the chats out of sight.
 */
function RequestCards() {
  const unfolded = useSignal(false)
  const list = contactRequests.value
  return (
    <>
      {list.length > 1 && (
        <div class="nav-note crash-card">
          <div class="card-pad">
            <strong>{texts.people.requestsTitle(list.length)}</strong>
            <div class="crash-actions">
              <Button kind={unfolded.value ? 'quiet' : 'secondary'} onClick={() => (unfolded.value = !unfolded.value)}>
                {unfolded.value ? texts.people.requestsHide : texts.people.requestsShow}
              </Button>
            </div>
          </div>
        </div>
      )}
      {(list.length === 1 || unfolded.value) &&
        list.map((r) => (
          <div key={r.person} class="nav-note crash-card">
            <div class="card-pad">
              <strong>{texts.people.requestTitle(r.name)}</strong>
              <p class="muted small">{requestOrigin(r)}</p>
              <div class="crash-actions">
                <Button
                  kind="secondary"
                  onClick={() =>
                    void acceptRequest(r.person).then((conv) => {
                      if (!conv) return
                      pane.value = 'chat'
                      chatSearch.value = false
                      open(conv)
                    })
                  }
                >
                  {texts.people.requestAgree}
                </Button>
                <Button kind="quiet" onClick={() => void declineRequest(r.person)}>
                  {texts.people.requestDecline}
                </Button>
              </div>
            </div>
          </div>
        ))}
    </>
  )
}
