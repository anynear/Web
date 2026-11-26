// Requests and sharings after one pattern (ADR 0123), as RequestsUi in the app: the list „Anfragen“ with everything
// open, „Freigaben“ at the contact page, and the card for a step about SOS contacts in the chat.
import { useState } from 'preact/hooks'
import { texts } from '../i18n'
import {
  acceptRequest,
  circles,
  contactRequests,
  isSupportCircle,
  me,
  declineRequest,
  messages,
  open,
  people,
  personName,
  requestOrigin,
  sentRequests,
  sharings,
  withdrawSharing,
} from '../core/session'
import type { Msg } from '../core/messages'
import { directKey, parseKey } from '../core/messages'
import { SOS_CARD, answerSos, askAsSos, endSos, setSosHelpers, sosAgreed, sosAsks, sosContacts, sosHelpers } from '../core/sos'
import type { Level } from '../core/sharing'
import { Avatar } from './Avatar'
import { Button, Row, Section } from './components'
import type { ComponentChildren } from 'preact'
import { GoodTick, SystemCard } from './SystemCard'
import * as Icons from './icons'
import { pane } from './nav'
import { SharingAnswerButtons, SharingDialog, SharingState, betweenWith } from './Place'

/** One open request (ADR 0123 §6): who, what about, and whether the own person asked. */
type OpenRequest =
  | { kind: 'contact'; person: string; name: string; origin: string; byUs: false }
  | { kind: 'sentContact'; person: string; name: string; byUs: true }
  | { kind: 'location'; person: string; level: Level; byUs: boolean }
  | { kind: 'sos'; person: string; byUs: boolean }

/** Everything open, to the person and by it. */
export function openRequests(): OpenRequest[] {
  const out: OpenRequest[] = []
  for (const r of contactRequests.value) out.push({ kind: 'contact', person: r.person, name: r.name, origin: requestOrigin(r), byUs: false })
  for (const s of sharings.value.values()) if (s.asked && !s.askedByUs) out.push({ kind: 'location', person: s.person, level: s.asked, byUs: false })
  for (const a of sosAsks.value) out.push({ kind: 'sos', person: a.person, byUs: false })
  for (const r of sentRequests.value) out.push({ kind: 'sentContact', person: r.person, name: r.name, byUs: true })
  for (const s of sharings.value.values()) if (s.asked && s.askedByUs) out.push({ kind: 'location', person: s.person, level: s.asked, byUs: true })
  return out
}

/** How many requests wait for the own answer. */
export function requestsToMe(): number {
  return openRequests().filter((r) => !r.byUs).length
}

function toChat(person: string) {
  pane.value = 'chat'
  open(directKey(person))
}

/** One request: picture, name, what it is about and its buttons; the same in the list and at the contact page. */
function RequestRow({ r }: { r: OpenRequest }) {
  const pt = texts.people
  const t = texts.place
  const [busy, setBusy] = useState(false)
  const name = r.kind === 'contact' || r.kind === 'sentContact' ? r.name : personName(r.person)
  const what =
    r.kind === 'location' ? pt.requestAboutLocation(r.level === 'exact') : r.kind === 'sos' ? (r.byUs ? pt.requestAboutSosOwn : pt.requestAboutSos) : pt.requestAboutContact
  const known = people.value.get(r.person)
  return (
    <div class="request-row">
      <Row
        icon={<Avatar id={r.person} kind="person" size={40} image={known?.image ?? null} />}
        title={name}
        text={r.byUs ? `${what} · ${t.sharingWaiting}` : what}
      />
      <div class="spot-actions">
        {r.kind === 'contact' && (
          <>
            <Button
              kind="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                const conv = await acceptRequest(r.person)
                setBusy(false)
                if (conv) {
                  pane.value = 'chat'
                  open(conv)
                }
              }}
            >
              {t.sharingAccept}
            </Button>
            <Button kind="quiet" disabled={busy} onClick={() => void declineRequest(r.person)}>
              {t.sharingDecline}
            </Button>
          </>
        )}
        {r.kind === 'location' &&
          (r.byUs ? (
            <Button kind="quiet" onClick={() => void withdrawSharing(r.person)}>
              {t.sharingWithdraw}
            </Button>
          ) : (
            <SharingAnswerButtons personId={r.person} />
          ))}
        {r.kind === 'sos' && !r.byUs && (
          <>
            <Button kind="secondary" onClick={() => void answerSos(r.person, true)}>
              {t.sharingAccept}
            </Button>
            <Button kind="quiet" onClick={() => void answerSos(r.person, false)}>
              {t.sharingDecline}
            </Button>
          </>
        )}
        {known && r.kind !== 'contact' && (
          <Button kind="quiet" onClick={() => toChat(r.person)}>
            {texts.contact.write}
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * „Anfragen“ (ADR 0123 §6): everything open in one list, contacts, location and SOS alike, with the same buttons.
 * „An dich“ above, „Von dir“ below.
 */
export function RequestsPage() {
  const pt = texts.people
  const all = openRequests()
  const toMe = all.filter((r) => !r.byUs)
  const mine = all.filter((r) => r.byUs)
  return (
    <section class="page">
      <header class="page-head">
        <button type="button" class="icon-btn back-btn" aria-label={texts.nav.back} onClick={() => (pane.value = 'chat')}>
          <Icons.Back />
        </button>
        <h1>{pt.requestsPage}</h1>
      </header>
      <div class="page-body">
        {all.length === 0 && <p class="muted">{pt.requestsNone}</p>}
        {toMe.length > 0 && (
          <Section title={pt.requestsToYou}>
            {toMe.map((r) => (
              <RequestRow key={`${r.kind}-${r.person}`} r={r} />
            ))}
          </Section>
        )}
        {mine.length > 0 && (
          <Section title={pt.requestsFromYou}>
            {mine.map((r) => (
              <RequestRow key={`${r.kind}-${r.person}`} r={r} />
            ))}
          </Section>
        )}
      </div>
    </section>
  )
}

/** Requests wait for the own answer: their number; a click opens the list „Anfragen“. */
export function RequestsLine() {
  const n = requestsToMe()
  if (!n) return null
  return (
    <div class="nav-note crash-card">
      <Row icon={<Icons.Person />} title={texts.people.requestsRow(n)} right={<Icons.Forward size={18} />} onClick={() => (pane.value = 'requests')} />
    </div>
  )
}

/**
 * „Freigaben“ at the page of a person (ADR 0123 §7): the sharing of the place with „Beenden“ or „Standort freigeben“,
 * SOS in both directions with „Beenden“, and what is open with this person. The browser does not choose SOS contacts;
 * that stays on the phone.
 */
export function PersonSharings({ personId }: { personId: string }) {
  const pt = texts.people
  const t = texts.place
  const name = personName(personId)
  const [asking, setAsking] = useState(false)
  const b = betweenWith(personId)
  const ours = sosContacts.value.get(personId)
  return (
    <Section title={pt.sharingsTitle} footer={pt.sharingsFooter}>
      <div class="card-pad">
        {b.exists && <SharingState personId={personId} />}
        {b.askable.length > 0 && (
          <Button kind="quiet" onClick={() => setAsking(true)}>
            {t.mutualStart}
          </Button>
        )}
        {ours === 2 && (
          <p>
            <strong>{texts.sos.card(SOS_CARD.THEY_YES, name)}</strong>{' '}
            <Button kind="quiet" onClick={() => void endSos(personId)}>
              {t.sharingEnd}
            </Button>
          </p>
        )}
        {ours === 1 && (
          <p>
            <strong>{texts.sos.card(SOS_CARD.WE_ASKED, name)}</strong>{' '}
            <Button kind="quiet" onClick={() => void endSos(personId)}>
              {t.sharingWithdraw}
            </Button>
          </p>
        )}
        {ours == null && (
          <Button kind="quiet" onClick={() => askAsSos(personId)}>
            {pt.askAsSos}
          </Button>
        )}
        {sosAgreed.value.includes(personId) && (
          <p>
            <strong>{texts.sos.card(SOS_CARD.WE_YES, name)}</strong>{' '}
            <Button kind="quiet" onClick={() => void answerSos(personId, false)}>
              {t.sharingEnd}
            </Button>
          </p>
        )}
        {sosAsks.value.some((a) => a.person === personId) && <RequestRow r={{ kind: 'sos', person: personId, byUs: false }} />}
      </div>
      {asking && <SharingDialog personId={personId} onClose={() => setAsking(false)} />}
    </Section>
  )
}

/**
 * „SOS-Kontakte“ (ADR 0121 §13, ADR 0123 §3), as on the phone: circles and single persons; who is chosen gets the
 * question, who is taken out learns it. The browser itself never rings.
 */
export function SosHelpersSection() {
  const t = texts.sos
  const h = sosHelpers.value
  const circlesList = circles.value.filter((c) => !c.removed && !isSupportCircle(c.id))
  const own = me.value?.personId
  const persons = [...people.value.values()].filter((p) => p.id !== own).sort((a, b) => a.name.localeCompare(b.name))
  const toggle = (kind: 'circles' | 'persons', id: string) => {
    const list = h[kind]
    const next = { ...h, [kind]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] }
    // Chosen alone now: no longer left out.
    void setSosHelpers(kind === 'persons' && !list.includes(id) ? { ...next, except: h.except.filter((x) => x !== id) } : next)
  }
  return (
    <Section id="sos-helpers" title={t.contacts} footer={t.chooseFooter}>
      {circlesList.map((c) => (
        <label key={`c-${c.id}`} class="radio-row">
          <input type="checkbox" checked={h.circles.includes(c.id)} onChange={() => toggle('circles', c.id)} />
          <Avatar id={c.id} kind="circle" size={32} image={c.image} />
          <span>{c.name}</span>
        </label>
      ))}
      {persons.map((p) => (
        <label key={`p-${p.id}`} class="radio-row">
          <input type="checkbox" checked={h.persons.includes(p.id)} onChange={() => toggle('persons', p.id)} />
          <Avatar id={p.id} kind="person" size={32} image={p.image} />
          <span>
            {p.name}
            {sosContacts.value.get(p.id) === 1 && <span class="muted small"> · {texts.place.sharingWaiting}</span>}
          </span>
        </label>
      ))}
    </Section>
  )
}

/** A step about SOS contacts with the person of the chat (ADR 0123 §5); the newest open question has its buttons. */
export function SosEventCard({ m, meta }: { m: Msg; meta?: ComponentChildren }) {
  const t = texts.place
  const { id } = parseKey(m.conv)
  const good = m.sos === SOS_CARD.THEY_YES || m.sos === SOS_CARD.WE_YES
  const newest = !messages.value.some((x) => x.conv === m.conv && x.sos === SOS_CARD.ASKED_US && x.ts > m.ts)
  const open = m.sos === SOS_CARD.ASKED_US && newest && sosAsks.value.some((a) => a.person === id)
  return (
    <SystemCard icon={good ? <GoodTick /> : <Icons.Person size={20} />} title={m.text} good={good} meta={meta}>
      {open && (
        <div class="spot-actions">
          <Button kind="secondary" onClick={() => void answerSos(id, true)}>
            {t.sharingAccept}
          </Button>
          <Button kind="quiet" onClick={() => void answerSos(id, false)}>
            {t.sharingDecline}
          </Button>
        </div>
      )}
    </SystemCard>
  )
}
