// A conversation: messages with day headings, states (ADR 0003, 0019), reactions (ADR 0018), attachments
// (ADR 0011) and the search in the chat as in the app (ChatSearch.kt).
import { useComputed, useSignal } from '@preact/signals'
import { Fragment } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { texts } from '../i18n'
import { LIMITS, mimeOf, prepareFile, type Prepared } from '../core/media'
import type { AboLimit } from '../core/abo'
import { draftFiles, draftText, saveDraftFiles, saveDraftText } from '../core/drafts'
import { findInviteLinks, withoutInviteLinks, type InviteLink } from '../core/invites'
import { channels, openRequest, pendingLink } from '../core/channels'
import {
  type Att,
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
} from '../core/messages'
import {
  MAX_TEXT_BYTES,
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
  personName,
  previewLink,
  react,
  replyRef,
  send,
  supportPeer,
} from '../core/session'
import type { LinkPreview } from 'anmp-core'
import { Avatar } from './Avatar'
import { Button, CopyLink, Dialog, Qr } from './components'
import { formatDay, formatListTime, formatSize, formatTime, isSameDay, splitLinks } from './format'
import * as Icons from './icons'
import { openViewer, type ViewerItem } from './Viewer'
import { AboLimitHint } from './AboLimitHint'
import { FileActionDialog, type FileAction, type FileItem } from './FileActions'
import { chatSearch, dialog, dialogLink, pane, section, supportKind } from './nav'

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
            {circle?.historyPending && <p class="hint">{texts.circle.historyLoading}</p>}
            {list.value.length === 0 &&
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
                  {m.system ? (
                    <div class="system">{m.text}</div>
                  ) : m.deleted ? (
                    <DeletedLine m={m} highlighted={highlight === m.id} flash={flash === m.id} />
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
  const text = invites.length ? withoutInviteLinks(m.text, invites) : m.text
  const link = shownLink(m)
  // One does not react to own messages (as in the app); every message can be deleted.
  const canReact = !!m.mid && !m.outgoing
  return (
    <div id={`m-${m.id}`} class={`bubble-row ${m.outgoing ? 'out' : 'in'} ${highlighted ? 'highlight' : ''} ${flash ? 'flash' : ''}`}>
      <div
        class="bubble"
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('a, audio')) return
          e.preventDefault()
          // Like a long press in the app: opens the menu, a second time closes it.
          setPicking(!picking)
        }}
      >
        {showName && <div class="bubble-name">{personName(m.fromPerson, m.fromName)}</div>}
        {m.replyTo && <QuoteBox m={m} onOpen={onQuote} />}
        {m.attachments.map((a) => (
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
              >
                <Icons.Reply size={18} />
                <span>{texts.chat.reply}</span>
              </button>
            )}
            {files.length > 0 && (
              <>
                <button type="button" role="menuitem" class="picker-action" onClick={() => setFileAction({ kind: 'download', items: files })}>
                  <Icons.Download size={18} />
                  <span>{texts.viewer.download}</span>
                </button>
                <button type="button" role="menuitem" class="picker-action" onClick={() => setFileAction({ kind: 'store', items: files })}>
                  <Icons.Lock size={18} />
                  <span>{texts.viewer.toFiles}</span>
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
            >
              <Icons.Trash size={18} />
              <span>{texts.chat.delete}</span>
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
    return url ? <audio class="att-audio" controls src={url} preload="metadata" /> : <div class="att-file muted">{texts.attachment.voice}</div>
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
  const problem = useSignal('')
  const preparing = useSignal(0)
  const dragging = useSignal(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const writable = canWrite(conv)
  const bytes = new TextEncoder().encode(text.value).length
  const tooLong = bytes > MAX_TEXT_BYTES
  // Attachment too large or too many: hint at the plan that allows more (ADR 0076 §1a), as in the app.
  const fileLimit = useSignal<AboLimit | null>(null)

  // Fetch the draft of the conversation and keep the previous one when switching (as in the app).
  useEffect(() => {
    text.value = draftText(conv)
    drafts.value = draftFiles<Draft>(conv)
    problem.value = ''
    const a = area.current
    if (a) {
      a.style.height = ''
      if (text.value) a.style.height = `${Math.min(a.scrollHeight, 200)}px`
      a.focus()
    }
    return () => saveDraftFiles(conv, drafts.value)
  }, [conv])

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
    void send(conv, t, files, undefined, answering)
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
              text.value = e.currentTarget.value
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
          {tooLong && <span class="field-error">{texts.chat.tooLong}</span>}
          {tooLong && <AboLimitHint limit="textChars" />}
        </div>
        <button type="submit" class="send-btn" aria-label={texts.chat.send} disabled={(!text.value.trim() && !drafts.value.length) || tooLong || preparing.value > 0}>
          <Icons.Send />
        </button>
      </div>
    </form>
  )
}

// --- Invitations as a card (like InviteCardBox of the app) --------------------------------------------------------

/** Phone or tablet (finger instead of mouse): there `capture` opens the camera. */
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
