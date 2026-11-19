// „Kreise“ as in the app (ADR 0100, CirclesScreen): start a circle, accept an invite, the circles; tapping opens the
// circle page. „Neue Nachricht“ (NewMessageScreen): circles and contacts to write to, plus „Kontakt hinzufügen“.
import { computed, useSignal } from '@preact/signals'
import { texts } from '../i18n'
import { circleKey, directKey, type ConvKey } from '../core/messages'
import { circles, me, open, openConv, people, supportPeer, type CircleView, type Person } from '../core/session'
import { Avatar } from './Avatar'
import { Button } from './components'
import * as Icons from './icons'
import { chatSearch, dialog, forwarding, newMessage, pane } from './nav'
import { forwardInto, forwardPreview } from './Chat'

/** All known people except oneself, by name. */
const contacts = computed<Person[]>(() => {
  const own = me.value?.personId
  return [...people.value.values()].filter((p) => p.id !== own && p.id !== supportPeer.value).sort((a, b) => a.name.localeCompare(b.name))
})

/** Where one knows someone from: „direkter Kontakt“, the shared circles or both. */
export function originOf(p: Person): string {
  const names = p.circles.map((id) => circles.value.find((c) => c.id === id && !c.removed)?.name).filter((n): n is string => !!n)
  if (names.length === 0) return texts.people.addedByYou
  return (p.contact ? [texts.people.addedByYou, ...names] : names).join(' · ')
}

/** Briefly who is in the circle, like `circleSummary` of the app. */
export function circleSummary(c: CircleView): string {
  if (c.removed) return texts.people.summaryRemoved
  const others = c.members.filter((m) => m.id !== me.value?.personId).length
  return others === 0 ? texts.people.summaryNobodyInvited : texts.people.summaryYouAndOthers(others)
}

function matches(query: string, ...values: (string | undefined)[]): boolean {
  const q = query.trim().toLowerCase()
  return !q || values.some((v) => v?.toLowerCase().includes(q))
}

/** Circles and contacts whose name fits [q], without those in [exclude] (conversation keys). */
export function pickHits(q: string, exclude: ReadonlySet<string> = new Set()): { circles: CircleView[]; people: Person[] } {
  return {
    circles: circles.value.filter((c) => !c.removed && !exclude.has(circleKey(c.id)) && matches(q, c.name)),
    people: contacts.value.filter(
      (p) => !exclude.has(directKey(p.id)) && matches(q, p.name, p.profileName, ...p.circles.map((id) => circles.value.find((c) => c.id === id)?.name)),
    ),
  }
}

/** Opens the conversation with a circle or contact chosen from [PickSections]. */
function pick(key: ConvKey) {
  newMessage.value = false
  pane.value = 'chat'
  chatSearch.value = false
  open(key)
}

/** „Kreise“ and „Kontakte“ to choose from, as on „Neue Nachricht“; also below the search hits of „Nachrichten“. */
export function PickSections({ hits, onPick = pick }: { hits: ReturnType<typeof pickHits>; onPick?: (key: ConvKey) => void }) {
  return (
    <>
      {hits.circles.length > 0 && (
        <>
          <h2 class="section-title nav-title">{texts.list.circles}</h2>
          {hits.circles.map((c) => (
            <button key={c.id} type="button" class="conv" onClick={() => onPick(circleKey(c.id))}>
              <Avatar id={c.id} kind="circle" size={40} image={c.image} />
              <span class="conv-body">
                <span class="conv-name">{c.name}</span>
                <span class="conv-preview">{circleSummary(c)}</span>
              </span>
            </button>
          ))}
        </>
      )}
      {hits.people.length > 0 && (
        <>
          <h2 class="section-title nav-title">{texts.list.contacts}</h2>
          {hits.people.map((p) => (
            <button key={p.id} type="button" class="conv" onClick={() => onPick(directKey(p.id))}>
              <Avatar id={p.id} kind="person" size={40} image={p.image} />
              <span class="conv-body">
                <span class="conv-name">{p.name || texts.system.someone}</span>
                <span class="conv-preview">{originOf(p)}</span>
              </span>
            </button>
          ))}
        </>
      )}
    </>
  )
}

/** „Neue Nachricht“: whom do you want to write to? Tapping opens the conversation, an existing one is continued. */
export function NewMessageNav() {
  const query = useSignal('')
  const q = query.value
  const hits = pickHits(q)
  // „Weiterleiten“ uses the same choice (as the app): the message goes into the draft of the chosen conversation.
  const forward = forwarding.value
  const problem = useSignal('')
  const pick = (key: ConvKey) => {
    if (forward) {
      void forwardInto(key, forward).then((p) => {
        if (p) {
          problem.value = p
          return
        }
        forwarding.value = null
        pane.value = 'chat'
        chatSearch.value = false
        open(key)
      })
      return
    }
    newMessage.value = false
    pane.value = 'chat'
    chatSearch.value = false
    open(key)
  }
  const back = () => {
    if (forward) forwarding.value = null
    else newMessage.value = false
  }
  return (
    <div class="people-nav">
      <div class="people-own">
        <button type="button" class="list-action" onClick={back}>
          <Icons.Back size={18} /> {texts.nav.back}
        </button>
        <h2 class="section-title nav-title">{forward ? texts.chat.forwardQuestion : texts.list.whoToMessage}</h2>
        {forward && <p class="muted small nav-note forward-preview">{forwardPreview(forward)}</p>}
        {problem.value && <p class="small nav-note" role="alert">{problem.value}</p>}
      </div>
      <div class="list-tools">
        <input class="input search" type="search" placeholder={texts.list.searchName} value={q} onInput={(e) => (query.value = e.currentTarget.value)} />
      </div>
      <div class="files-nav">
        {hits.circles.length === 0 && hits.people.length === 0 && q && <p class="muted small nav-note">{texts.people.noResults}</p>}
        <PickSections hits={hits} onPick={pick} />
        {hits.people.length === 0 && !q && <p class="muted small nav-note">{texts.list.noContactsYet}</p>}
      </div>
      {!forward && <div class="people-foot people-own">
        <Button kind="secondary" class="people-wide" onClick={() => { newMessage.value = false; dialog.value = 'addContact' }}>
          <Icons.Plus size={18} /> {texts.list.addContact}
        </Button>
        <Button kind="secondary" class="people-wide" onClick={() => { newMessage.value = false; dialog.value = 'startCircle' }}>
          <Icons.Plus size={18} /> {texts.list.startCircle}
        </Button>
      </div>}
    </div>
  )
}

/** The „Kreise“ section of the sidebar. */
export function CirclesNav() {
  const query = useSignal('')
  const all = circles.value
  const shown = all.filter((c) => matches(query.value, c.name))
  return (
    <div class="people-nav">
      <div class="people-own">
        <Button kind="main" class="people-wide" onClick={() => (dialog.value = 'startCircle')}>
          <Icons.Plus size={18} /> {texts.list.startCircle}
        </Button>
      </div>
      {all.length > 0 && (
        <div class="list-tools">
          <input class="input search" type="search" placeholder={texts.people.searchCircles} value={query.value} onInput={(e) => (query.value = e.currentTarget.value)} />
        </div>
      )}
      <div class="files-nav">
        {all.length === 0 ? (
          <p class="muted small nav-note">{texts.people.circleExplained}</p>
        ) : shown.length === 0 ? (
          <p class="muted small nav-note">{texts.people.noResults}</p>
        ) : (
          <>
            <h2 class="section-title nav-title">{texts.people.yourCircles}</h2>
            {shown.map((c) => {
              const active = openConv.value === circleKey(c.id) && pane.value === 'details'
              return (
                <button
                  key={c.id}
                  type="button"
                  class={`conv ${active ? 'active' : ''}`}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => {
                    pane.value = 'details'
                    open(circleKey(c.id))
                  }}
                >
                  <Avatar id={c.id} kind="circle" size={40} image={c.image} />
                  <span class="conv-body">
                    <span class="conv-name">{c.name}</span>
                    <span class="conv-preview">{circleSummary(c)}</span>
                  </span>
                </button>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
