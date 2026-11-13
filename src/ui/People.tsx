// „Menschen“ as in the app (PeopleScreen, ContactsScreen, CirclesScreen): contacts and circles as two separate
// lists, switchable at the top. Tapping a contact opens the conversation, tapping a circle the circle page.
import { computed, useSignal } from '@preact/signals'
import { texts } from '../i18n'
import { circleKey, directKey, parseKey } from '../core/messages'
import { circles, me, open, openConv, ownImage, ownName, people, personName, summaries, supportPeer, type CircleView, type Person } from '../core/session'
import { Avatar } from './Avatar'
import { Button } from './components'
import * as Icons from './icons'
import { chatSearch, dialog, pane, peopleTab } from './nav'

/** All known people except oneself, by name. */
const contacts = computed<Person[]>(() => {
  const own = me.value?.personId
  return [...people.value.values()].filter((p) => p.id !== own && p.id !== supportPeer.value).sort((a, b) => a.name.localeCompare(b.name))
})

/** Who has written directly without being known (like „Hat dir geschrieben“ in the app). */
const strangers = computed<string[]>(() => {
  const own = me.value?.personId
  const list: string[] = []
  for (const k of summaries.value.keys()) {
    const { kind, id } = parseKey(k)
    if (kind === 'direct' && id !== own && !people.value.has(id)) list.push(id)
  }
  return list
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

export function PeopleNav() {
  const showCircles = peopleTab.value === 'circles'
  return (
    <div class="people-nav">
      <div class="segmented" role="tablist" aria-label={texts.nav.people}>
        {(['contacts', 'circles'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={peopleTab.value === tab}
            class={`segment ${peopleTab.value === tab ? 'active' : ''}`}
            onClick={() => (peopleTab.value = tab)}
          >
            {tab === 'contacts' ? texts.list.contacts : texts.list.circles}
          </button>
        ))}
      </div>
      {showCircles ? <CirclesList /> : <ContactsList />}
    </div>
  )
}

function openChat(id: string) {
  pane.value = 'chat'
  chatSearch.value = false
  open(directKey(id))
}

function ContactsList() {
  const query = useSignal('')
  const q = query.value
  const shown = contacts.value.filter((p) => matches(q, p.name, ...p.circles.map((id) => circles.value.find((c) => c.id === id)?.name)))
  const shownStrangers = strangers.value.filter((id) => matches(q, personName(id)))
  const empty = contacts.value.length === 0 && strangers.value.length === 0
  const ownId = me.value?.personId ?? ''
  return (
    <>
      <div class="people-own">
        <button
          type="button"
          class={`conv ${pane.value === 'settings' ? 'active' : ''}`}
          onClick={() => {
            open(null)
            pane.value = 'settings'
          }}
        >
          {ownImage.value ? (
            <img class="avatar" src={ownImage.value} width={40} height={40} style={{ borderRadius: '50%' }} alt="" />
          ) : (
            <Avatar id={ownId} kind="person" size={40} />
          )}
          <span class="conv-body">
            <span class="conv-name">{texts.people.ownMember(ownName.value)}</span>
            <span class="conv-preview">{texts.people.myProfile}</span>
          </span>
        </button>
        <Button kind="secondary" class="people-wide" onClick={() => (dialog.value = 'ownContact')}>
          <Icons.Share size={18} /> {texts.people.shareMyContact}
        </Button>
      </div>
      {!empty && (
        <div class="list-tools">
          <input class="input search" type="search" placeholder={texts.people.searchContacts} value={q} onInput={(e) => (query.value = e.currentTarget.value)} />
        </div>
      )}
      <div class="files-nav">
        {shownStrangers.length > 0 && (
          <>
            <h2 class="section-title nav-title">{texts.people.wroteToYou}</h2>
            {shownStrangers.map((id) => (
              <PersonButton key={id} id={id} name={personName(id)} text={texts.people.notInContactsYet} image={null} />
            ))}
          </>
        )}
        {empty ? (
          <p class="muted small nav-note">{texts.people.contactsEmpty}</p>
        ) : shown.length === 0 && shownStrangers.length === 0 ? (
          <p class="muted small nav-note">{texts.people.noResults}</p>
        ) : (
          shown.length > 0 && (
            <>
              <h2 class="section-title nav-title">{texts.people.allContacts}</h2>
              {shown.map((p) => (
                <PersonButton key={p.id} id={p.id} name={p.name || texts.system.someone} text={originOf(p)} image={p.image} />
              ))}
            </>
          )
        )}
      </div>
      <div class="people-foot">
        <Button kind="main" class="people-wide" onClick={() => (dialog.value = 'addContact')}>
          <Icons.Plus size={18} /> {texts.list.addContact}
        </Button>
      </div>
    </>
  )
}

function PersonButton({ id, name, text, image }: { id: string; name: string; text: string; image: Person['image'] }) {
  const active = openConv.value === directKey(id) && pane.value !== 'settings'
  return (
    <button type="button" class={`conv ${active ? 'active' : ''}`} aria-current={active ? 'true' : undefined} onClick={() => openChat(id)}>
      <Avatar id={id} kind="person" size={40} image={image} />
      <span class="conv-body">
        <span class="conv-name">{name}</span>
        <span class="conv-preview">{text}</span>
      </span>
    </button>
  )
}

function CirclesList() {
  const query = useSignal('')
  const all = circles.value
  const shown = all.filter((c) => matches(query.value, c.name))
  return (
    <>
      <div class="people-own">
        <Button kind="main" class="people-wide" onClick={() => (dialog.value = 'startCircle')}>
          <Icons.Plus size={18} /> {texts.list.startCircle}
        </Button>
        <Button kind="secondary" class="people-wide" onClick={() => (dialog.value = 'joinCircle')}>
          <Icons.Link size={18} /> {texts.people.acceptInvite}
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
    </>
  )
}
