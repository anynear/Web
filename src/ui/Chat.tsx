// A conversation: messages with day headings, states (ADR 0003, 0019), reactions (ADR 0018), attachments
// (ADR 0011) and the search in the chat as in the app (ChatSearch.kt).
import { useComputed, useSignal } from '@preact/signals'
import { Fragment } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { texts } from '../i18n'
import { LIMITS, mimeOf, prepareFile, type Prepared } from '../core/media'
import type { AboLimit } from '../core/abo'
import { addToDraft, draftFiles, draftPassedOn, draftText, incomingDrafts, saveDraftFiles, saveDraftPassedOn, saveDraftText, takeIncoming } from '../core/drafts'
import { findInviteLinks, withoutInviteLinks, type InviteLink } from '../core/invites'
import { introState, introStatus } from '../core/requests'
import { channels, openRequest, pendingLink } from '../core/channels'
import {
  type Att,
  type IntroCard,
  type ConvKey,
  type Msg,
  SELF,
  canDeleteForAll,
  chatMatches,
  circleKey,
  directKey,
  parseKey,
  type Quote,
  quoteOf,
  reactionSummary,
  searchable,
  shownLink,
  shownStatus,
  charsLeftHint,
  limitInput,
  textLeft,
} from '../core/messages'
import {
  MAX_TEXT_CHARS,
  attachmentUrl,
  attachmentArrived,
  canWrite,
  circles,
  convName,
  deleteForEveryone,
  deleteForMe,
  messages,
  open,
  original,
  people,
  inviteLink,
  isSupportCircle,
  loadingCircles,
  loadingMailbox,
  stillLoading,
  personName,
  previewLink,
  react,
  replyRef,
  send,
  supportPeer,
  acceptIntro,
  sentRequests,
} from '../core/session'
import type { LinkPreview } from 'anmp-core'
import { Avatar } from './Avatar'
import { Button, Confirm, CopyLink, Dialog, Qr } from './components'
import { formatDay, formatListTime, formatSize, formatTime, formatVoiceDuration, isSameDay, splitLinks } from './format'
import * as Icons from './icons'
import { SharingDialog, SpotEvent, canShareWith } from './Place'
import { SosEventCard } from './Requests'
import { openViewer, type ViewerItem } from './Viewer'
import { AboLimitHint } from './AboLimitHint'
import { FileActionDialog, type FileAction, type FileItem } from './FileActions'
import { insertEmoji } from './emoji'
import { chatSearch, dialog, dialogLink, forwarding, pane, section, supportKind } from './nav'

/** For selection as in the app (Reaction.CHOICES). */
const CHOICES = ['👍', '❤️', '😂', '😮', '😢', '🙏']

/** This long a message jumped to from the search lights up (HIGHLIGHT_MILLIS in the app). */
const HIGHLIGHT_MS = 2_500
/** This long the original of an answer lights up after tapping the quote (ADR 0092). */
const FLASH_MS = 1_500
/** This long a short notice stays under the messages. */
const NOTICE_MS = 3_000

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function Chat({ conv }: { conv: ConvKey }) {
  const { kind, id } = parseKey(conv)
  const list = useComputed(() => messages.value.filter((m) => m.conv === conv))
  const circle = kind === 'circle' ? circles.value.find((c) => c.id === id) : undefined
  const person = kind === 'direct' ? people.value.get(id) : undefined
  const replySoonAfter = kind === 'circle' && isSupportCircle(id) ? list.value.find((m) => m.outgoing && !m.system)?.id : undefined
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const searching = chatSearch.value
  const setSearching = (v: boolean) => (chatSearch.value = v)
  const [highlight, setHighlight] = useState<string | null>(null)
  // Only one message has its selection open; opening another one closes the previous one (as in the app).
  const [openMsg, setOpenMsg] = useState<string | null>(null)
  // The message being answered (ADR 0092); only for this conversation, gone when switching.
  const [reply, setReply] = useState<Msg | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const supportDirect = !!supportPeer.value && conv === directKey(supportPeer.value)
  const writable = !circle?.removed && !supportDirect && canWrite(conv)
  // Current state of the answered message: if it is deleted or gone meanwhile, the answer is dropped.
  const replying = reply ? (list.value.find((x) => x.id === reply.id && !x.deleted) ?? null) : null

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [list.value.length, conv, searching])

  useEffect(() => {
    stick.current = true
    setReply(null)
    setFlash(null)
    setNotice('')
  }, [conv])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), NOTICE_MS)
    return () => clearTimeout(t)
  }, [notice])

  function jumpTo(m: Msg) {
    setSearching(false)
    stick.current = false
    setHighlight(m.id)
    requestAnimationFrame(() => document.getElementById(`m-${m.id}`)?.scrollIntoView({ block: 'center' }))
    setTimeout(() => setHighlight((h) => (h === m.id ? null : h)), HIGHLIGHT_MS)
  }

  /** Tapped quote: scroll to the original and let it light up briefly, or say that it is not here (ADR 0092). */
  function showOriginal(m: Msg) {
    const o = original(m)
    const el = o && document.getElementById(`m-${o.id}`)
    if (!o || !el) {
      setNotice(texts.chat.quoteGone)
      return
    }
    stick.current = false
    setFlash(null)
    requestAnimationFrame(() => {
      setFlash(o.id)
      el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
    })
    setTimeout(() => setFlash((f) => (f === o.id ? null : f)), FLASH_MS)
  }

  const subtitle = circle ? texts.chat.members(circle.members.length) : texts.chat.direct

  return (
    <section class="chat" aria-label={convName(conv)}>
      <header class="chat-head">
        <button type="button" class="icon-btn back-btn" aria-label={texts.nav.back} onClick={() => open(null)}>
          <Icons.Back />
        </button>
        <button type="button" class="chat-title" onClick={() => (pane.value = 'details')} title={kind === 'circle' ? texts.circle.details : texts.contact.details}>
          <Avatar id={id} kind={kind === 'circle' ? 'circle' : 'person'} size={40} image={circle?.image ?? person?.image ?? null} />
          <span>
            <span class="chat-name">
              <span>{convName(conv)}</span>
              <Icons.Forward size={18} />
            </span>
            <span class="chat-sub">{subtitle}</span>
          </span>
        </button>
        {!searching && (
          <button type="button" class="icon-btn head-action" aria-label={texts.profile.searchInChat} title={texts.profile.searchInChat} onClick={() => setSearching(true)}>
            <Icons.Search />
          </button>
        )}
      </header>
      {searching ? (
        <ChatSearch list={list.value} onClose={() => setSearching(false)} onOpen={jumpTo} />
      ) : (
        <>
          <p class="e2e">
            <Icons.Lock size={14} /> {texts.chat.encrypted}
          </p>
          <div
            class="messages"
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
            }}
          >
            {/* Messages still coming: new in the circle, new device, back from the emergency card (ADR 0014, 0107 §8). */}
            {(kind === 'circle'
              ? !!circle && !circle.removed && (circle.historyPending || loadingCircles.value.includes(circle.id))
              : loadingMailbox.value) && <p class="hint">{texts.circle.historyLoading}</p>}
            {list.value.length === 0 &&
              !stillLoading(conv) &&
              (circle && !circle.removed && circle.members.length <= 1 ? (
                <InviteFirst circleId={circle.id} />
              ) : (
                <p class="empty-chat">{person ? texts.chat.firstMessageTo(personName(id, person.name)) : texts.chat.noMessagesYet}</p>
              ))}
            {list.value.map((m, i) => {
              // Circle of a request to support: under the first own message it says that we will get back soon.
              const replySoon = m.id === replySoonAfter
              const prev = list.value[i - 1]
              const newDay = !prev || !isSameDay(prev.ts, m.ts)
              const sameAuthor = !newDay && prev && !prev.system && !m.system && prev.outgoing === m.outgoing && prev.fromPerson === m.fromPerson
              return (
                <Fragment key={m.id}>
                  {newDay && <div class="day">{formatDay(m.ts)}</div>}
                  {m.system && m.sos ? (
                    // A step about SOS contacts (ADR 0123 §5): a card like those about places.
                    <div id={`m-${m.id}`} class="spot-row">
                      <SosEventCard m={m} />
                    </div>
                  ) : m.system ? (
                    <div class="system">{m.text}</div>
                  ) : m.deleted ? (
                    <DeletedLine m={m} highlighted={highlight === m.id} flash={flash === m.id} />
                  ) : m.spot ? (
                    // What the app sends for the person is a card in the middle, not a bubble (ADR 0121 §26).
                    <div id={`m-${m.id}`} class={`spot-row ${highlight === m.id ? 'highlight' : ''}`}>
                      <SpotEvent m={m} />
                    </div>
                  ) : (
                    <Bubble m={m} inCircle={kind === 'circle'} showName={kind === 'circle' && !m.outgoing && !sameAuthor} highlighted={highlight === m.id}
                      flash={flash === m.id}
                      open={openMsg === m.id}
                      onOpen={(o) => setOpenMsg((cur) => (o ? m.id : cur === m.id ? null : cur))}
                      onReply={writable && replyRef(m) ? () => setReply(m) : undefined}
                      onQuote={() => showOriginal(m)}
                    />
                  )}
                  {replySoon && <div class="system">{texts.support.replySoon}</div>}
                </Fragment>
              )
            })}
          </div>
          {notice && (
            <p class="hint chat-notice" role="status">
              {notice}
            </p>
          )}
          <Composer conv={conv} removed={!!circle?.removed} reply={replying} onCancelReply={() => setReply(null)} />
        </>
      )}
    </section>
  )
}

// --- Search in the chat ------------------------------------------------------------------------------------------

/** Excerpt around the first match, with highlighting. */
function Snippet({ text, query }: { text: string; query: string }) {
  const i = text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase())
  if (i < 0) return <>{text}</>
  const start = Math.max(0, i - 40)
  const end = i + query.trim().length
  return (
    <>
      {start > 0 ? '… ' : ''}
      {text.slice(start, i)}
      <mark>{text.slice(i, end)}</mark>
      {text.slice(end, end + 120)}
    </>
  )
}

function ChatSearch({ list, onClose, onOpen }: { list: Msg[]; onClose: () => void; onOpen: (m: Msg) => void }) {
  const query = useSignal('')
  const found = chatMatches(list, query.value)
  return (
    <div class="chat-search">
      <div class="chat-search-bar">
        <input
          class="input search"
          type="search"
          autoFocus
          placeholder={texts.search.placeholder}
          aria-label={texts.search.placeholder}
          value={query.value}
          onInput={(e) => (query.value = e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
        />
        <button type="button" class="icon-btn" aria-label={texts.search.close} onClick={onClose}>
          <Icons.Close />
        </button>
      </div>
      {!query.value.trim() ? (
        <p class="muted search-hint">{texts.search.hint}</p>
      ) : found.length === 0 ? (
        <p class="muted search-hint">{texts.search.none}</p>
      ) : (
        <>
          <p class="section-title search-count">{texts.search.matches(found.length)}</p>
          <ul class="search-results">
            {found.map((m) => (
              <li key={m.id}>
                <button type="button" class="search-match" onClick={() => onOpen(m)}>
                  <span class="search-match-top">
                    <span class="search-match-from">{m.outgoing ? texts.list.you : personName(m.fromPerson, m.fromName)}</span>
                    <span class="muted small">{formatListTime(m.ts)}</span>
                  </span>
                  <span class="search-match-text">
                    <Snippet text={searchable(m)} query={query.value} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

// --- Messages ----------------------------------------------------------------------------------------------------

/** Message deleted for everyone: a quiet line at the original time, without menu and reactions (ADR 0068). */
function DeletedLine({ m, highlighted, flash }: { m: Msg; highlighted: boolean; flash: boolean }) {
  return (
    <div id={`m-${m.id}`} class={`bubble-row ${m.outgoing ? 'out' : 'in'} ${highlighted ? 'highlight' : ''} ${flash ? 'flash' : ''}`}>
      <div class="deleted-line">
        <span>{m.outgoing ? texts.chat.deletedByYou : texts.chat.deletedBy(personName(m.fromPerson, m.fromName))}</span>
        <span class="deleted-time">{formatTime(m.ts)}</span>
      </div>
    </div>
  )
}

/** From this distance on (px), letting go answers the message (same value as in the app, 56 dp). */
const REPLY_TRIGGER = 56
/** The message does not follow the finger further than this. */
const REPLY_MAX = 80

/**
 * Pull a message to the right with the finger to answer it (ADR 0092), as in the app: the message follows the finger,
 * the answer arrow appears on the left; beyond [REPLY_TRIGGER] a short vibration (where the browser can), letting go
 * starts the answer, before that the message springs back. Touch only: with the mouse, dragging selects text. Up and
 * down stays scrolling (`touch-action: pan-y`); a movement that starts more vertically is left alone.
 */
function useSwipeToReply(onReply?: () => void) {
  const [pulled, setPulled] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ id: number; x: number; y: number; mode: 'pending' | 'drag' | 'off' } | null>(null)
  const armed = pulled >= REPLY_TRIGGER
  const end = () => {
    const s = start.current
    start.current = null
    if (s?.mode !== 'drag') return
    setDragging(false)
    if (pulled >= REPLY_TRIGGER) onReply?.()
    setPulled(0)
  }
  if (!onReply) return { pulled: 0, armed: false, dragging: false, handlers: {} }
  return {
    pulled,
    armed,
    dragging,
    handlers: {
      onPointerDown: (e: PointerEvent) => {
        if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
        start.current = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: 'pending' }
      },
      onPointerMove: (e: PointerEvent) => {
        const s = start.current
        if (!s || s.id !== e.pointerId || s.mode === 'off') return
        const dx = e.clientX - s.x
        const dy = e.clientY - s.y
        if (s.mode === 'pending') {
          if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) s.mode = 'off'
          else if (dx > 10 && dx > Math.abs(dy)) {
            s.mode = 'drag'
            s.x += 10
            setDragging(true)
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          }
          return
        }
        const raw = Math.max(0, e.clientX - s.x)
        // Beyond the trigger point it gets heavier, so that the end is felt.
        const next = Math.min(REPLY_MAX, raw <= REPLY_TRIGGER ? raw : REPLY_TRIGGER + (raw - REPLY_TRIGGER) * 0.4)
        if (next >= REPLY_TRIGGER && pulled < REPLY_TRIGGER) navigator.vibrate?.(10)
        setPulled(next)
      },
      onPointerUp: end,
      onPointerCancel: end,
    },
  }
}

function Bubble({
  m,
  inCircle,
  showName,
  highlighted,
  flash,
  open,
  onOpen,
  onReply,
  onQuote,
}: {
  m: Msg
  inCircle: boolean
  showName: boolean
  highlighted: boolean
  /** Original of a tapped quote, lights up briefly (ADR 0092). */
  flash: boolean
  /** This message is the one open in the chat. */
  open: boolean
  onOpen: (open: boolean) => void
  /** Answer this message; missing if it cannot be answered here. */
  onReply?: () => void
  /** The quote at the top was tapped. */
  onQuote: () => void
}) {
  const picking = open
  const setPicking = onOpen
  const [deleting, setDeleting] = useState(false)
  const [fileAction, setFileAction] = useState<FileAction | null>(null)
  const [fileNotice, setFileNotice] = useState('')
  const files = m.attachments.map((a) => fileItem(m, a))
  useEffect(() => {
    if (!fileNotice) return
    const t = setTimeout(() => setFileNotice(''), 3000)
    return () => clearTimeout(t)
  }, [fileNotice])
  const reactions = reactionSummary(m)
  const invites = m.text ? findInviteLinks(m.text) : []
  // With an introduction (ADR 0116) the card says it all; the text is only the stand-in for older apps.
  const text = m.intro || m.spot ? '' : invites.length ? withoutInviteLinks(m.text, invites) : m.text
  // Its picture goes along as a photo (ADR 0116 §2); the card shows it small as the profile picture instead.
  const introPhoto = m.intro ? m.attachments.find((a) => a.type === 'jpg') : undefined
  const attachments = introPhoto ? m.attachments.filter((a) => a !== introPhoto) : m.attachments
  const link = shownLink(m)
  // One does not react to own messages (as in the app); every message can be deleted.
  const canReact = !!m.mid && !m.outgoing
  const swipe = useSwipeToReply(onReply)
  return (
    <div
      id={`m-${m.id}`}
      class={`bubble-row ${m.outgoing ? 'out' : 'in'} ${highlighted ? 'highlight' : ''} ${flash ? 'flash' : ''} ${swipe.dragging ? 'swiping' : ''}`}
      style={swipe.pulled ? { transform: `translateX(${swipe.pulled}px)` } : undefined}
      {...swipe.handlers}
    >
      {swipe.pulled > 0 && (
        <span
          class={`swipe-reply ${swipe.armed ? 'armed' : ''}`}
          aria-hidden="true"
          style={{ left: `${4 - swipe.pulled}px`, opacity: Math.min(1, swipe.pulled / REPLY_TRIGGER), transform: `translateY(-50%) scale(${0.6 + 0.4 * Math.min(1, swipe.pulled / REPLY_TRIGGER)})` }}
        >
          <Icons.Reply size={22} />
        </span>
      )}
      <div
        class="bubble"
        onContextMenu={(e) => {
          const target = e.target as HTMLElement
          if (target.closest('a, .att-voice')) return
          // Marked text keeps the browser's menu (copy); with the menu open, a long press on the text marks it.
          const marked = window.getSelection()
          if (marked && !marked.isCollapsed && e.currentTarget.contains(marked.anchorNode)) return
          if (picking && target.closest('.bubble-text')) return
          e.preventDefault()
          // Like a long press in the app: opens the menu, a second time closes it.
          setPicking(!picking)
        }}
      >
        {showName && <div class="bubble-name">{personName(m.fromPerson, m.fromName)}</div>}
        {m.passedOn && <PassedOnLabel />}
        {m.replyTo && <QuoteBox m={m} onOpen={onQuote} />}
        {attachments.map((a) => (
          <Attachment key={a.id} m={m} a={a} />
        ))}
        {text && (
          <div class="bubble-text">
            {splitLinks(text).map((p, i) =>
              p.href ? (
                <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">
                  {p.text}
                </a>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
          </div>
        )}
        {link && <LinkPreviewCard m={m} link={link} />}
        {m.intro && <IntroCardView m={m} intro={m.intro} photo={introPhoto} sender={personName(m.fromPerson, m.fromName)} own={m.outgoing} />}
        {invites.map((l) => (
          <InviteCard key={l.start} link={l} sender={personName(m.fromPerson, m.fromName)} own={m.outgoing} />
        ))}
        <div class="bubble-meta">
          <span>{formatTime(m.ts)}</span>
          {m.outgoing && <StatusLine m={m} inCircle={inCircle} />}
        </div>
        <button
          type="button"
          class="react-btn"
          aria-label={canReact ? texts.chat.react : texts.nav.more}
          aria-haspopup="menu"
          aria-expanded={picking}
          onClick={() => setPicking(!picking)}
        >
          {canReact ? <Icons.Smile size={18} /> : <Icons.More size={18} />}
        </button>
        {picking && (
          <div class="picker" role="menu" onKeyDown={(e) => e.key === 'Escape' && setPicking(false)}>
            {canReact && CHOICES.map((e) => (
              <button
                key={e}
                type="button"
                role="menuitem"
                class={m.reactions?.[SELF]?.emoji === e ? 'chosen' : ''}
                aria-label={m.reactions?.[SELF]?.emoji === e ? texts.chat.removeReaction : texts.chat.reactWith(e)}
                onClick={() => {
                  setPicking(false)
                  void react(m, e)
                }}
              >
                {e}
              </button>
            ))}
            {onReply && (
              <button
                type="button"
                role="menuitem"
                class="picker-action"
                onClick={() => {
                  setPicking(false)
                  onReply()
                }}
                aria-label={texts.chat.reply}
                title={texts.chat.reply}
              >
                <Icons.Reply size={20} />
              </button>
            )}
            {/* The whole text at once; parts can be marked like any text on the page. */}
            {text && (
              <button
                type="button"
                role="menuitem"
                class="picker-action"
                onClick={() =>
                  void navigator.clipboard.writeText(text).then(() => {
                    setPicking(false)
                    setFileNotice(texts.chat.textCopied)
                  })
                }
                aria-label={texts.chat.copy}
                title={texts.chat.copy}
              >
                <Icons.Copy size={20} />
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              class="picker-action"
              onClick={() => {
                setPicking(false)
                forwarding.value = m
              }}
              aria-label={texts.chat.forward}
              title={texts.chat.forward}
            >
              <Icons.ForwardMessage size={20} />
            </button>
            {/* Into the system's share menu only via this explicit button (files are otherwise viewed in the page). */}
            {canShare() && (
              <button
                type="button"
                role="menuitem"
                class="picker-action"
                onClick={() => void shareMessage(m).then((problem) => problem && setFileNotice(problem))}
                aria-label={texts.chat.share}
                title={texts.chat.share}
              >
                <Icons.Share size={20} />
              </button>
            )}
            {files.length > 0 && (
              <>
                <button type="button" role="menuitem" class="picker-action" onClick={() => setFileAction({ kind: 'download', items: files })} aria-label={texts.viewer.download} title={texts.viewer.download}>
                  <Icons.Download size={20} />
                </button>
                <button type="button" role="menuitem" class="picker-action" onClick={() => setFileAction({ kind: 'store', items: files })} aria-label={texts.viewer.toFiles} title={texts.viewer.toFiles}>
                  <Icons.Lock size={20} />
                </button>
              </>
            )}
            <button
              type="button"
              role="menuitem"
              class="picker-action"
              onClick={() => {
                setPicking(false)
                setDeleting(true)
              }}
              aria-label={texts.chat.delete}
              title={texts.chat.delete}
            >
              <Icons.Trash size={20} />
            </button>
          </div>
        )}
      </div>
      {deleting && <DeleteDialog m={m} onClose={() => setDeleting(false)} />}
      {fileAction && (
        <FileActionDialog
          action={fileAction}
          onClose={() => {
            setFileAction(null)
            setPicking(false)
          }}
          onDone={(t) => setFileNotice(t)}
        />
      )}
      {fileNotice && (
        <p class="muted small" role="status">
          {fileNotice}
        </p>
      )}
      {reactions.length > 0 && (
        <div class="reactions">
          {reactions.map((r) => {
            const label = texts.chat.reactedBy(r.emoji, reactors(m, r.emoji).join(', '))
            const body = (
              <>
                {r.emoji}
                {r.count > 1 && <span>{r.count}</span>}
              </>
            )
            // As in the app: one does not react to own messages; tapping someone else's reaction adopts it.
            return m.outgoing || !m.mid ? (
              <span key={r.emoji} class={`reaction ${r.mine ? 'mine' : ''}`} title={label} aria-label={label}>
                {body}
              </span>
            ) : (
              <button key={r.emoji} type="button" class={`reaction ${r.mine ? 'mine' : ''}`} title={label} aria-label={label} onClick={() => void react(m, r.emoji)}>
                {body}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// --- Answers (ADR 0092) -----------------------------------------------------------------------------------------

/** Who wrote the quoted message: „Du“ for own ones; `null` if the original is not here. */
function quoteAuthor(q: Quote): string | null {
  if (q.kind === 'missing') return null
  return q.outgoing ? texts.list.you : personName(q.fromPerson, q.fromName)
}

/** The one line of the quote: text, kind of attachment or why there is nothing to show. */
function quoteLine(q: Quote): string {
  switch (q.kind) {
    case 'missing':
      return texts.chat.quoteMissing
    case 'deleted':
      return texts.chat.deletedMessage
    case 'text':
      return q.text
    case 'attachment':
      return q.type === 'photo' ? texts.attachment.photo : q.type === 'voice' ? texts.attachment.voice : q.type === 'document' ? texts.attachment.document : texts.attachment.file
  }
}

/** Compact quote on top of an answer; tapping it shows the original. */
function QuoteBox({ m, onOpen }: { m: Msg; onOpen: () => void }) {
  const q = quoteOf(original(m))
  const author = quoteAuthor(q)
  return (
    <button type="button" class={`quote ${q.kind === 'missing' || q.kind === 'deleted' ? 'quote-muted' : ''}`} title={texts.chat.showOriginal} onClick={onOpen}>
      {author && <span class="quote-name">{author}</span>}
      <span class="quote-text">{quoteLine(q)}</span>
    </button>
  )
}

/** Above the input while answering: to whom, one line of the original, ✕ to cancel. */
/** „Weitergeleitet“ with an arrow (ADR 0118): above a passed on message and above the input of such a draft. */
function PassedOnLabel() {
  return (
    <div class="passed-on">
      <Icons.ForwardMessage size={14} />
      <span>{texts.chat.passedOn}</span>
    </div>
  )
}

function ReplyBar({ m, onCancel }: { m: Msg; onCancel: () => void }) {
  const q = quoteOf(m)
  return (
    <div class="reply-bar">
      <Icons.Reply size={18} />
      <span class="reply-bar-body">
        <span class="reply-bar-name">{m.outgoing ? texts.chat.replyToSelf : texts.chat.replyTo(personName(m.fromPerson, m.fromName))}</span>
        <span class="reply-bar-text">{quoteLine(q)}</span>
      </span>
      <button type="button" class="icon-btn small" aria-label={texts.chat.cancelReply} title={texts.chat.cancelReply} onClick={onCancel}>
        <Icons.Close size={16} />
      </button>
    </div>
  )
}

/**
 * Question on deleting (ADR 0068): own message up to 48 hours after sending „Für alle“ or „Nur für mich“,
 * with the honest note; older ones and others' only „Nur für mich“.
 */
function DeleteDialog({ m, onClose }: { m: Msg; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const forAll = canDeleteForAll(m, Date.now())
  async function everyone() {
    setBusy(true)
    setFailed(false)
    const ok = await deleteForEveryone(m).catch(() => false)
    setBusy(false)
    if (ok) onClose()
    else setFailed(true)
  }
  return (
    <Dialog title={texts.chat.delete} onClose={onClose}>
      <div class="dialog-body">
        {forAll && <p>{texts.chat.deleteHint}</p>}
        {failed && <p class="field-error">{texts.common.error}</p>}
        <div class="dialog-actions delete-actions">
          <Button kind="quiet" onClick={onClose}>
            {texts.common.cancel}
          </Button>
          <Button
            kind={forAll ? 'secondary' : 'danger'}
            disabled={busy}
            onClick={() => {
              onClose()
              void deleteForMe(m)
            }}
          >
            {texts.chat.deleteForMe}
          </Button>
          {forAll && (
            <Button kind="danger" disabled={busy} onClick={() => void everyone()}>
              {texts.chat.deleteForEveryone}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  )
}

/**
 * Preview of a link under the text (ADR 0069 §4), as the sender sent it along: picture, title, two lines of
 * description and always the site's name from the address. The web app fetches nothing itself, the picture is a blob.
 */
function LinkPreviewCard({ m, link }: { m: Msg; link: NonNullable<ReturnType<typeof shownLink>> }) {
  const [img, setImg] = useState<string | null>(null)
  const image = link.image
  useEffect(() => {
    let live = true
    setImg(null)
    if (image) attachmentUrl(m, image, 'image/jpeg').then((u) => live && setImg(u), () => {})
    return () => {
      live = false
    }
  }, [image?.id, image && attachmentArrived.value === image.id])
  const ratio = image && image.width > 0 && image.height > 0 ? `${image.width} / ${image.height}` : undefined
  return (
    <a class="link-card" href={link.url} target="_blank" rel="noopener noreferrer">
      {image && (img ? <img src={img} alt="" style={ratio ? { aspectRatio: ratio } : undefined} /> : <span class="link-card-img placeholder" style={ratio ? { aspectRatio: ratio } : undefined} />)}
      <span class="link-card-body">
        {link.title && <span class="link-card-title">{link.title}</span>}
        {link.description && <span class="link-card-desc">{link.description}</span>}
        <span class="link-card-site">{link.host}</span>
      </span>
    </a>
  )
}

function StatusLine({ m, inCircle }: { m: Msg; inCircle: boolean }) {
  const s = shownStatus(m, inCircle)
  switch (s.kind) {
    case 'sending':
      return <span class="status">{texts.chat.sending}</span>
    case 'failed':
      return (
        <span class="status failed">
          {texts.chat.failed} ·{' '}
          <button type="button" class="link-btn" onClick={() => void send(m.conv, m.text, [], m)}>
            {texts.chat.retry}
          </button>
        </span>
      )
    case 'sent':
      return <span class="status">✓ {texts.chat.sent}</span>
    case 'arrived':
      return <span class="status">✓✓ {texts.chat.arrived}</span>
    case 'read':
      return <span class="status read">✓✓ {texts.chat.read}</span>
    case 'readAll':
      return <span class="status read">✓✓ {texts.chat.readByAll}</span>
    case 'readSome':
      return <span class="status">✓✓ {texts.chat.readBy(s.n, s.total)}</span>
  }
}

function attachmentLabel(a: Att): string {
  return a.name || (a.type === 'pdf' ? texts.attachment.pdf : a.type === 'jpg' ? texts.attachment.photo : texts.attachment.file)
}

/** The bytes of an attachment, from this browser or the relays; `null` if it cannot be had right now. */
async function attachmentBytes(m: Msg, a: Att): Promise<Uint8Array | null> {
  const url = await attachmentUrl(m, a, mimeOf(a.type, attachmentLabel(a))).catch(() => null)
  if (!url) return null
  return new Uint8Array(await (await fetch(url)).arrayBuffer())
}

/** One line for „An wen weiterleiten?“: the text, otherwise the attachments. */
export function forwardPreview(m: Msg): string {
  return m.text.trim() || m.attachments.map(attachmentLabel).join(', ')
}

/**
 * „Weiterleiten“ (as in the app): text and attachments of [m] go into the draft of [conv]; only the send button sends.
 * Attachments are sealed again with a new key when sent (no references across spaces in ANDP). `null` if it worked,
 * otherwise what is to be said.
 */
export async function forwardInto(conv: ConvKey, m: Msg): Promise<string | null> {
  const list: Draft[] = []
  for (const a of m.attachments) {
    const bytes = await attachmentBytes(m, a)
    if (!bytes) return texts.viewer.cantShow
    const prepared: Prepared = { bytes, type: a.type, name: a.type === 'jpg' ? '' : a.name, width: a.width, height: a.height }
    const preview = a.type === 'jpg' ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' })) : null
    list.push({ key: crypto.randomUUID(), prepared, preview, label: attachmentLabel(a) })
  }
  // The text of a voice message may be its automatic preview, not the sender's words; the recording goes alone.
  addToDraft(conv, m.attachments.some((a) => a.type === 'm4a') ? '' : m.text, list)
  return null
}

/** The page may hand things to the system's share menu (Web Share API). */
function canShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

/** „Teilen…“: text and files of [m] into the system's share menu; `null` if it opened or was canceled. */
async function shareMessage(m: Msg): Promise<string | null> {
  const files: File[] = []
  for (const a of m.attachments) {
    const bytes = await attachmentBytes(m, a)
    if (!bytes) return texts.viewer.cantShow
    const item = fileItem(m, a)
    files.push(new File([bytes as BlobPart], item.name, { type: mimeOf(a.type, item.name) }))
  }
  const text = m.attachments.some((a) => a.type === 'm4a') ? '' : m.text.trim()
  const data: ShareData = { ...(text ? { text } : {}), ...(files.length ? { files } : {}) }
  if (navigator.canShare && !navigator.canShare(data)) return texts.viewer.cantShow
  try {
    await navigator.share(data)
    return null
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? null : texts.viewer.cantShow
  }
}

/** Attachment for downloading or storing; photos without a name get one. */
function fileItem(m: Msg, a: Att): FileItem {
  const name = attachmentLabel(a)
  const fileName = a.type === 'jpg' && !a.name ? `${texts.attachment.photo}-${a.id.slice(0, 8)}.jpg` : name
  return { name: fileName, load: () => attachmentUrl(m, a, mimeOf(a.type, name)) }
}

/** Viewer in the app for an attachment; photos of a message can be paged through in it. */
function openAttachment(m: Msg, a: Att) {
  const item = (x: Att): ViewerItem => {
    const name = attachmentLabel(x)
    return {
      kind: x.type === 'jpg' ? 'photo' : x.type === 'pdf' ? 'pdf' : 'file',
      name: x.type === 'jpg' ? x.name : name,
      size: x.size,
      load: () => attachmentUrl(m, x, mimeOf(x.type, name)),
      // From the chat: also put into a storage (as in the app).
      file: fileItem(m, x),
    }
  }
  if (a.type === 'jpg') {
    const photos = m.attachments.filter((x) => x.type === 'jpg')
    openViewer(photos.map(item), photos.indexOf(a))
  } else openViewer([item(a)])
}

/** The voice message playing right now: starting another one stops it (as in the app, one VoicePlayback per chat). */
let playingVoice: HTMLAudioElement | null = null

/**
 * Voice message in the bubble as in the app (`VoiceRow` in ChatVoice.kt): play/pause, progress and duration, with a
 * fixed width. The browser's own `<audio controls>` shrank to a few pixels in a bubble without its own width.
 * As long as the recording is not here, [status] says why.
 */
function VoicePlayer({ url, durationMs, status }: { url: string | null; durationMs: number; status: string | null }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  // Older messages carry no duration: then the one the browser reads from the file.
  const [fileDuration, setFileDuration] = useState(0)
  const [failed, setFailed] = useState(false)
  const total = durationMs > 0 ? durationMs : fileDuration

  useEffect(
    () => () => {
      const el = audio.current
      if (el && playingVoice === el) playingVoice = null
      el?.pause()
    },
    [],
  )

  async function toggle() {
    const el = audio.current
    if (!el || !url) return
    if (!el.paused) {
      el.pause()
      return
    }
    if (playingVoice && playingVoice !== el) playingVoice.pause()
    playingVoice = el
    try {
      setFailed(false)
      await el.play()
    } catch {
      setFailed(true)
    }
  }

  const active = playing || position > 0
  const progress = total > 0 ? Math.min(1, position / total) : 0
  const label = failed
    ? texts.attachment.voiceCantPlay
    : status ?? (active ? `${formatVoiceDuration(position)} / ${formatVoiceDuration(total)}` : formatVoiceDuration(total))
  return (
    <div class="att-voice">
      <button
        type="button"
        class="icon-btn att-voice-btn"
        aria-label={playing ? texts.attachment.pause : `${texts.attachment.play}: ${texts.attachment.voice}`}
        disabled={!url}
        onClick={() => void toggle()}
      >
        {playing ? <Icons.Pause /> : <Icons.Play />}
      </button>
      <div class="att-voice-body">
        <div class="att-voice-track" role="progressbar" aria-label={texts.attachment.voice} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <span style={{ width: `${progress * 100}%` }} />
        </div>
        <span class={`att-voice-time ${failed ? 'warn' : ''}`}>{label}</span>
      </div>
      {url && (
        <audio
          ref={audio}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false)
            setPosition(0)
          }}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime * 1000)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration
            if (Number.isFinite(d)) setFileDuration(d * 1000)
          }}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}

function Attachment({ m, a }: { m: Msg; a: Att }) {
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'later'>(a.type === 'jpg' || a.type === 'm4a' ? 'loading' : 'idle')
  const name = attachmentLabel(a)
  const mime = mimeOf(a.type, name)

  function load(): Promise<string | null> {
    setState('loading')
    return attachmentUrl(m, a, mime).then(
      (u) => {
        setUrl(u)
        setState(u ? 'idle' : 'later')
        return u
      },
      () => {
        setState('later')
        return null
      },
    )
  }

  useEffect(() => {
    if (a.type === 'jpg' || a.type === 'm4a') void load()
  }, [a.id])

  // Came again from a device that still had it (`have`, ADR 0014, 0088).
  const arrived = attachmentArrived.value === a.id
  useEffect(() => {
    if (arrived) void load()
  }, [arrived])

  if (a.type === 'jpg') {
    const ratio = a.width > 0 && a.height > 0 ? `${a.width} / ${a.height}` : '4 / 3'
    return url ? (
      <button type="button" class="att-photo" aria-label={`${texts.attachment.open}: ${texts.attachment.photo}`} onClick={() => openAttachment(m, a)}>
        <img src={url} alt={texts.attachment.photo} style={{ aspectRatio: ratio }} />
      </button>
    ) : (
      <div class="att-photo placeholder" style={{ aspectRatio: ratio }}>
        <span>{state === 'later' ? texts.attachment.later : texts.attachment.loading}</span>
        {state === 'later' && (
          <button type="button" class="link-btn" onClick={() => void load()}>
            {texts.chat.retry}
          </button>
        )}
      </div>
    )
  }
  if (a.type === 'm4a') {
    return <VoicePlayer url={url} durationMs={a.duration} status={url ? null : state === 'later' ? texts.attachment.later : texts.attachment.loading} />
  }
  return (
    <button type="button" class="att-file" aria-label={`${texts.attachment.open}: ${name}`} onClick={() => openAttachment(m, a)}>
      <Icons.File />
      <span class="att-file-body">
        <span class="att-file-name">{name}</span>
        <span class="att-file-size">{formatSize(a.size)}</span>
      </span>
    </button>
  )
}

// --- Input -----------------------------------------------------------------------------------------------------

interface Draft {
  key: string
  prepared: Prepared
  preview: string | null
  label: string
}

/** From this few free characters on, the input shows how many are left (TEXT_HINT_BELOW in the app). */
const TEXT_HINT_BELOW = 100

function Composer({
  conv,
  removed,
  reply,
  onCancelReply,
}: {
  conv: ConvKey
  removed: boolean
  /** The message being answered (ADR 0092), or `null`. */
  reply: Msg | null
  onCancelReply: () => void
}) {
  const text = useSignal('')
  const drafts = useSignal<Draft[]>([])
  // The draft came from „Weiterleiten“ (ADR 0118); gone once it is sent or emptied.
  const passedOn = useSignal(false)
  const problem = useSignal('')
  const preparing = useSignal(0)
  const dragging = useSignal(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const emojiBtn = useRef<HTMLButtonElement>(null)
  // Emoji picker (web only): the component and the names are loaded only when it is opened the first time.
  const [Picker, setPicker] = useState<EmojiPickerType | null>(null)
  const emojiOpen = useSignal(false)
  const writable = canWrite(conv)
  const mutualOpen = useSignal(false)
  const mutualWith = parseKey(conv).kind === 'direct' && canShareWith(parseKey(conv).id) ? parseKey(conv).id : null
  // As in the app (TextLimit, TEXT_HINT_BELOW): input stops at the limit, a hint shortly before it.
  const left = textLeft(text.value, MAX_TEXT_CHARS)
  const tooLong = left < 0
  const limitHint = charsLeftHint(left, TEXT_HINT_BELOW, texts.chat)
  // Attachment too large or too many: hint at the plan that allows more (ADR 0076 §1a), as in the app.
  const fileLimit = useSignal<AboLimit | null>(null)

  // Fetch the draft of the conversation and keep the previous one when switching (as in the app).
  useEffect(() => {
    text.value = draftText(conv)
    drafts.value = draftFiles<Draft>(conv)
    passedOn.value = draftPassedOn(conv)
    problem.value = ''
    emojiOpen.value = false
    const a = area.current
    if (a) {
      a.style.height = ''
      if (text.value) a.style.height = `${Math.min(a.scrollHeight, 200)}px`
      a.focus()
    }
    return () => saveDraftFiles(conv, drafts.value)
  }, [conv])

  // Forwarded into this conversation (also while it is open): below the text, to the attachments (as in the app).
  useEffect(() => {
    const inc = takeIncoming<Draft>(conv)
    if (!inc) return
    passedOn.value = true
    if (inc.text) {
      text.value = text.value.trim() ? `${text.value.trimEnd()}\n${inc.text}` : inc.text
      saveDraftText(conv, text.value)
    }
    let add = inc.files
    // A voice message goes alone (ADR 0030).
    if (add.some((d) => d.prepared.type === 'm4a') && drafts.value.length + add.length > 1) {
      add = add.filter((d) => d.prepared.type !== 'm4a')
      problem.value = texts.compose.maxAttachments(1)
    }
    const room = LIMITS.perMessage - drafts.value.length
    if (add.length > room) problem.value = texts.compose.maxAttachments(LIMITS.perMessage)
    drafts.value = [...drafts.value, ...add.slice(0, Math.max(room, 0))]
    const a = area.current
    if (a) a.style.height = `${Math.min(a.scrollHeight, 200)}px`
  }, [conv, incomingDrafts.value])

  useEffect(() => {
    if (passedOn.value && !text.value.trim() && !drafts.value.length) passedOn.value = false
    saveDraftPassedOn(conv, passedOn.value)
  }, [conv, passedOn.value, text.value, drafts.value])

  // Answering: straight into the input.
  useEffect(() => {
    if (reply) area.current?.focus()
  }, [reply?.id])

  if (removed) return <div class="composer-note">{texts.chat.noLongerInCircle}</div>
  // With support only via the form, a separate circle per question (ADR 0065).
  if (supportPeer.value && conv === directKey(supportPeer.value)) {
    return (
      <div class="composer-note">
        <p>{texts.support.directBlocked}</p>
        <Button
          kind="secondary"
          onClick={() => {
            supportKind.value = 'question'
            pane.value = 'support'
          }}
        >
          {texts.support.openForm}
        </Button>
      </div>
    )
  }
  if (!writable) return <div class="composer-note">{texts.chat.cantWrite}</div>

  function clearDrafts() {
    for (const d of drafts.value) if (d.preview) URL.revokeObjectURL(d.preview)
    drafts.value = []
  }

  async function addFiles(list: FileList | File[]) {
    problem.value = ''
    fileLimit.value = null
    const files = [...list]
    const room = LIMITS.perMessage - drafts.value.length
    if (files.length > room) {
      problem.value = texts.compose.maxAttachments(LIMITS.perMessage)
      fileLimit.value = 'attachments'
    }
    preparing.value += Math.min(files.length, Math.max(room, 0))
    for (const f of files.slice(0, Math.max(room, 0))) {
      try {
        const p = await prepareFile(f)
        if (!p) problem.value = texts.compose.photoUnreadable
        else if (p.bytes.length > LIMITS.attachmentBytes) {
          problem.value = texts.compose.fileTooLarge
          fileLimit.value = 'attachmentMb'
        }
        else {
          const preview = p.type === 'jpg' ? URL.createObjectURL(new Blob([p.bytes as BlobPart], { type: 'image/jpeg' })) : null
          drafts.value = [...drafts.value, { key: crypto.randomUUID(), prepared: p, preview, label: p.name || texts.attachment.photo }]
        }
      } finally {
        preparing.value--
      }
    }
  }

  function toggleEmoji() {
    if (emojiOpen.value) return closeEmoji(true)
    emojiOpen.value = true
    if (!Picker) void loadEmojiPicker().then((c) => setPicker(() => c), () => (emojiOpen.value = false))
  }

  /** Closes the picker; after Escape or the button the focus goes back to the button, as with any popup. */
  function closeEmoji(toButton: boolean) {
    emojiOpen.value = false
    if (toButton) emojiBtn.current?.focus()
  }

  /** The emoji goes in at the cursor (in place of a selection), whole or not at all, and the cursor stays behind it. */
  function pickEmoji(emoji: string): boolean {
    const el = area.current
    const start = el?.selectionStart ?? text.value.length
    const end = el?.selectionEnd ?? start
    const done = insertEmoji(text.value, start, end, emoji, MAX_TEXT_CHARS)
    emojiOpen.value = false
    if (!el) return false
    el.focus()
    if (!done) return false
    text.value = done.text
    el.value = done.text
    el.setSelectionRange(done.caret, done.caret)
    saveDraftText(conv, done.text)
    el.style.height = ''
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    return true
  }

  function submit() {
    if ((!text.value.trim() && !drafts.value.length) || tooLong || preparing.value) return
    const t = text.value
    const files = drafts.value.map((d) => d.prepared)
    text.value = ''
    saveDraftText(conv, '')
    clearDrafts()
    problem.value = ''
    if (area.current) area.current.style.height = ''
    const answering = reply ?? undefined
    onCancelReply()
    const passing = passedOn.value
    passedOn.value = false
    void send(conv, t, files, undefined, answering, passing)
  }

  return (
    <form
      class={`composer-wrap ${dragging.value ? 'dragging' : ''}`}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onKeyDown={(e) => {
        // Escape cancels the answer, from the input as from the bar.
        if (e.key === 'Escape' && reply) {
          e.preventDefault()
          onCancelReply()
          area.current?.focus()
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files')) {
          e.preventDefault()
          dragging.value = true
        }
      }}
      onDragLeave={() => (dragging.value = false)}
      onDrop={(e) => {
        e.preventDefault()
        dragging.value = false
        if (e.dataTransfer?.files.length) void addFiles(e.dataTransfer.files)
      }}
    >
      {mutualOpen.value && mutualWith && <SharingDialog personId={mutualWith} onClose={() => (mutualOpen.value = false)} />}
      {passedOn.value && <PassedOnLabel />}
      {reply && <ReplyBar m={reply} onCancel={onCancelReply} />}
      {(drafts.value.length > 0 || preparing.value > 0 || problem.value) && (
        <div class="drafts">
          {drafts.value.map((d) => (
            <span key={d.key} class="draft">
              {d.preview ? <img src={d.preview} alt="" /> : <Icons.File size={18} />}
              <span class="draft-name">{d.label}</span>
              <button
                type="button"
                class="icon-btn small"
                aria-label={texts.compose.removeAttachment}
                onClick={() => {
                  if (d.preview) URL.revokeObjectURL(d.preview)
                  drafts.value = drafts.value.filter((x) => x.key !== d.key)
                }}
              >
                <Icons.Close size={16} />
              </button>
            </span>
          ))}
          {preparing.value > 0 && <span class="muted small">{texts.compose.preparing}</span>}
          {problem.value && <span class="field-error">{problem.value}</span>}
          {problem.value && fileLimit.value && <AboLimitHint limit={fileLimit.value} />}
        </div>
      )}
      <div class="composer">
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = e.currentTarget.files
            if (files?.length) void addFiles(files)
            e.currentTarget.value = ''
          }}
        />
        <button type="button" class="icon-btn attach-btn" aria-label={texts.compose.attach} title={texts.compose.attach} onClick={() => picker.current?.click()}>
          <Icons.Paperclip />
        </button>
        {/* „Standort freigeben“ in a chat with one person (ADR 0123 §2); the app has it in the „+“. */}
        {mutualWith && (
          <button type="button" class="icon-btn attach-btn" aria-label={texts.place.mutualStart} title={texts.place.mutualStart} onClick={() => (mutualOpen.value = true)}>
            <Icons.Map />
          </button>
        )}
        {/* Take a photo directly as in the app; only on phones and tablets, on a computer `capture` opens no camera. */}
        {touchDevice && (
          <>
            <input
              ref={camera}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                const files = e.currentTarget.files
                if (files?.length) void addFiles(files)
                e.currentTarget.value = ''
              }}
            />
            <button type="button" class="icon-btn attach-btn" aria-label={texts.compose.takePhoto} title={texts.compose.takePhoto} onClick={() => camera.current?.click()}>
              <Icons.Camera />
            </button>
          </>
        )}
        <div class="composer-field">
          <textarea
            ref={area}
            rows={1}
            class="input"
            placeholder={texts.chat.writeMessage}
            aria-label={texts.chat.writeMessage}
            value={text.value}
            onInput={(e) => {
              const el = e.currentTarget
              const typed = el.value
              const kept = limitInput(text.value, typed, (t) => textLeft(t, MAX_TEXT_CHARS) >= 0)
              if (kept !== typed) {
                // Keep the cursor where it was, minus what did not fit.
                const caret = Math.max(0, (el.selectionStart ?? typed.length) - (typed.length - kept.length))
                el.value = kept
                el.setSelectionRange(caret, caret)
              }
              text.value = kept
              saveDraftText(conv, text.value)
              e.currentTarget.style.height = ''
              e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 200)}px`
            }}
            onPaste={(e) => {
              const files = e.clipboardData?.files
              if (files?.length) {
                e.preventDefault()
                void addFiles(files)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <button
            ref={emojiBtn}
            type="button"
            class={`icon-btn emoji-btn ${emojiOpen.value ? 'active' : ''}`}
            aria-label={texts.emoji.open}
            title={texts.emoji.open}
            aria-haspopup="dialog"
            aria-expanded={emojiOpen.value}
            // On a computer the input keeps its focus; on the phone the keyboard goes away for the picker.
            onMouseDown={(e) => !touchDevice && e.preventDefault()}
            onClick={toggleEmoji}
          >
            <Icons.Smile size={20} />
          </button>
          {limitHint && <span class="field-error field-limit">{limitHint}</span>}
        </div>
        {emojiOpen.value && Picker && <Picker onPick={pickEmoji} onClose={closeEmoji} focusSearch={!touchDevice} />}
        <button type="submit" class="send-btn" aria-label={texts.chat.send} disabled={(!text.value.trim() && !drafts.value.length) || tooLong || preparing.value > 0}>
          <Icons.Send />
        </button>
      </div>
    </form>
  )
}

// --- Introduced contact as a card (like IntroCardBox of the app, ADR 0116) -----------------------------------------

/** Picture of the introduced person, small and round as a profile picture; a person icon while missing. */
function IntroPicture({ m, photo }: { m: Msg; photo?: Att }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setUrl(null)
    if (photo) attachmentUrl(m, photo, mimeOf(photo.type, photo.name)).then((u) => live && setUrl(u), () => {})
    return () => {
      live = false
    }
  }, [photo?.id])
  return url ? (
    <img class="invite-icon intro-photo" src={url} width={40} height={40} alt="" />
  ) : (
    <span class="invite-icon">
      <Icons.Person size={22} />
    </span>
  )
}

function IntroCardView({ m, intro, photo, sender, own }: { m: Msg; intro: IntroCard; photo?: Att; sender: string; own: boolean }) {
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const state = introState(intro, own, people.value.get(intro.person)?.contact === true, sentRequests.value.some((r) => r.person === intro.person), Date.now())
  const t = texts.people
  const status = introStatus(state)
  const action = state === 'open' ? t.introAdd : undefined
  const body = (
    <>
      <span class="invite-top">
        <IntroPicture m={m} photo={photo} />
        <span class="invite-texts">
          <span class="invite-sentence">{own ? t.introCardOwn(intro.name) : t.introCardIncoming(sender, intro.name)}</span>
          {(note || status) && <span class="invite-status">{note || status}</span>}
        </span>
      </span>
      {action && <span class="invite-action">{action}</span>}
    </>
  )
  return (
    <>
      {action ? (
        <button type="button" class="invite-card" onClick={() => setAsking(true)}>
          {body}
        </button>
      ) : (
        <div class="invite-card">{body}</div>
      )}
      {asking && (
        <Confirm
          title={t.introConfirmTitle(intro.name)}
          text={t.introConfirmText(intro.name)}
          confirm={t.introAdd}
          danger={false}
          onConfirm={async () => {
            const r = await acceptIntro(intro)
            setNote(r === 'requested' ? t.requestSent(intro.name) : r === 'known' ? t.alreadyContact : t.introExpired)
            setAsking(false)
          }}
          onClose={() => setAsking(false)}
        />
      )}
    </>
  )
}

// --- Invitations as a card (like InviteCardBox of the app) --------------------------------------------------------

/** Phone or tablet (finger instead of mouse): there `capture` opens the camera. */
type EmojiPickerType = typeof import('./EmojiPicker').default
const loadEmojiPicker = () => import('./EmojiPicker').then((m) => m.default)

const touchDevice = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

/**
 * Invitation in a speech bubble as a card instead of a link: a sentence with the name from the speech bubble, below it
 * the state and the one action. The whole card is a button; broken links only show a notice.
 */
function InviteCard({ link, sender, own }: { link: InviteLink; sender: string; own: boolean }) {
  const [card, setCard] = useState<LinkPreview | null | undefined>(undefined)
  // Check again as soon as one joins, subscribes or adds someone.
  useEffect(() => {
    let live = true
    previewLink(link.url).then(
      (p) => live && setCard(p),
      () => live && setCard(null),
    )
    return () => {
      live = false
    }
  }, [link.url, circles.value, people.value, channels.value])
  if (card === undefined) return null
  const view = cardView(card, sender, own)
  const icon = !card ? <Icons.Help size={22} /> : card.kind === 'channel' ? <Icons.Bell size={22} /> : card.kind === 'contact' ? <Icons.Person size={22} /> : card.kind === 'device' ? <Icons.Device size={22} /> : <Icons.Circle size={22} />
  const body = (
    <>
      <span class="invite-top">
        <span class={`invite-icon ${card ? '' : 'broken'}`}>{icon}</span>
        <span class="invite-texts">
          <span class={card ? 'invite-sentence' : 'invite-sentence muted'}>{view.sentence}</span>
          {view.status && <span class="invite-status">{view.status}</span>}
        </span>
      </span>
      {view.action && <span class={`invite-action ${card?.joined ? 'quiet' : ''}`}>{view.action}</span>}
    </>
  )
  return view.action && card ? (
    <button type="button" class="invite-card" onClick={() => openCard(card, link)}>
      {body}
    </button>
  ) : (
    <div class="invite-card">{body}</div>
  )
}

function cardView(card: LinkPreview | null, sender: string, own: boolean): { sentence: string; status?: string; action?: string } {
  const t = texts.invite
  if (!card) return { sentence: t.broken }
  switch (card.kind) {
    case 'channel':
      return {
        sentence: card.curated ? (own ? t.officialOwn : t.official(sender)) : own ? t.channelOwn(card.name) : t.channel(sender, card.name),
        status: card.joined ? t.subscribed : undefined,
        action: card.joined ? t.open : t.subscribe,
      }
    case 'contact':
      return {
        sentence:
          own && card.self ? t.contactSelfOwn : own ? t.contactOwn(card.name) : card.name === sender ? t.contactSelf(sender) : t.contact(sender, card.name),
        status: card.self ? t.thisIsYou : card.joined ? t.inContacts : undefined,
        action: card.self ? undefined : card.joined ? t.open : t.add,
      }
    case 'device':
      // The browser does not add devices itself (ADR 0059 §1): only the sentence and where it works.
      return {
        sentence: own ? t.deviceOwn(card.name) : t.device(sender, card.name),
        status: card.self ? t.thisDevice : card.joined ? t.deviceAdded : t.deviceInApp,
      }
    default:
      return {
        sentence: own ? t.circleOwn(card.name) : t.circle(sender, card.name),
        status: card.joined ? t.inCircle : undefined,
        action: card.joined ? t.open : t.join,
      }
  }
}

/** Known things open directly, otherwise the same path as when opening the link (join, add, subscribe). */
function openCard(card: LinkPreview, link: InviteLink) {
  if (card.kind === 'channel') {
    if (card.joined && card.target) {
      section.value = 'alerts'
      openRequest.value = card.target
    } else pendingLink.value = link.url
    return
  }
  if (card.joined && card.target) {
    pane.value = 'chat'
    chatSearch.value = false
    open(card.kind === 'circle' ? circleKey(card.target) : directKey(card.target))
    return
  }
  dialogLink.value = link.url
  dialog.value = card.kind === 'circle' ? 'joinCircle' : 'addContact'
}

/** Who reacted with [emoji], with names; oneself as „Du“. */
function reactors(m: Msg, emoji: string): string[] {
  return Object.entries(m.reactions ?? {})
    .filter(([, r]) => r.emoji === emoji)
    .map(([who]) => (who === SELF ? texts.list.you : personName(who)))
}

/** Empty circle in which only oneself is: prompt to invite right away (InviteFirst of the app). */
function InviteFirst({ circleId }: { circleId: string }) {
  const link = inviteLink(circleId)
  return (
    <div class="invite-first">
      <img src="/brand/anynear-emblem.svg" width="65" height="56" alt="" />
      <h2>{texts.chat.inviteSomeoneTitle}</h2>
      <p class="muted">{texts.chat.inviteSomeoneText}</p>
      {link && (
        <>
          <Qr text={link} size={180} />
          <CopyLink link={link} />
        </>
      )}
    </div>
  )
}
