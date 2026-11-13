// „Kreise“ as in the app (ADR 0100, CirclesScreen): start a circle, accept an invite, the circles; tapping opens the
// circle page. „Neue Nachricht“ (NewMessageScreen): circles and contacts to write to, plus „Kontakt hinzufügen“.
import { computed, useSignal } from '@preact/signals'
import { texts } from '../i18n'
import { circleKey, directKey, type ConvKey } from '../core/messages'
import { circles, me, open, openConv, people, supportPeer, type CircleView, type Person } from '../core/session'
import { Avatar } from './Avatar'
import { Button } from './components'
import * as Icons from './icons'
import { chatSearch, dialog, newMessage, pane } from './nav'

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

/** „Neue Nachricht“: whom do you want to write to? Tapping opens the conversation, an existing one is continued. */
export function NewMessageNav() {
  const query = useSignal('')
  const q = query.value
  const shownCircles = circles.value.filter((c) => !c.removed && matches(q, c.name))
  const shownPeople = contacts.value.filter((p) => matches(q, p.name, ...p.circles.map((id) => circles.value.find((c) => c.id === id)?.name)))
  const pick = (key: ConvKey) => {
    newMessage.value = false
    pane.value = 'chat'
    chatSearch.value = false
    open(key)
  }
  return (
    <div class="people-nav">
      <div class="people-own">
        <button type="button" class="list-action" onClick={() => (newMessage.value = false)}>
          <Icons.Back size={18} /> {texts.nav.back}
        </button>
        <h2 class="section-title nav-title">{texts.list.whoToMessage}</h2>
      </div>
      <div class="list-tools">
        <input class="input search" type="search" placeholder={texts.list.searchName} value={q} onInput={(e) => (query.value = e.currentTarget.value)} />
      </div>
      <div class="files-nav">
        {shownCircles.length === 0 && shownPeople.length === 0 && q && <p class="muted small nav-note">{texts.people.noResults}</p>}
        {shownCircles.length > 0 && (
          <>
            <h2 class="section-title nav-title">{texts.list.circles}</h2>
            {shownCircles.map((c) => (
              <button key={c.id} type="button" class="conv" onClick={() => pick(circleKey(c.id))}>
                <Avatar id={c.id} kind="circle" size={40} image={c.image} />
                <span class="conv-body">
                  <span class="conv-name">{c.name}</span>
                  <span class="conv-preview">{circleSummary(c)}</span>
                </span>
              </button>
            ))}
          </>
        )}
        {shownPeople.length > 0 ? (
          <>
            <h2 class="section-title nav-title">{texts.list.contacts}</h2>
            {shownPeople.map((p) => (
              <button key={p.id} type="button" class="conv" onClick={() => pick(directKey(p.id))}>
                <Avatar id={p.id} kind="person" size={40} image={p.image} />
                <span class="conv-body">
                  <span class="conv-name">{p.name || texts.system.someone}</span>
                  <span class="conv-preview">{originOf(p)}</span>
                </span>
              </button>
            ))}
          </>
        ) : (
          !q && <p class="muted small nav-note">{texts.list.noContactsYet}</p>
        )}
      </div>
      <div class="people-foot people-own">
        <Button kind="secondary" class="people-wide" onClick={() => { newMessage.value = false; dialog.value = 'addContact' }}>
          <Icons.Plus size={18} /> {texts.list.addContact}
        </Button>
        <Button kind="secondary" class="people-wide" onClick={() => { newMessage.value = false; dialog.value = 'startCircle' }}>
          <Icons.Plus size={18} /> {texts.list.startCircle}
        </Button>
      </div>
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
