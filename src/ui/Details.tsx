// „Kreis ansehen“ and „Kontakt ansehen“ as in the app: actions at the top (message, search in chat, edit),
// invite, members, storage of the circle, invalidate invitation links, leave or remove contact.
import type { ComponentChildren } from 'preact'
import { useSignal } from '@preact/signals'
import { useRef, useState } from 'preact/hooks'
import { texts } from '../i18n'
import { circleKey, directKey, parseKey, type ConvKey } from '../core/messages'
import {
  aloneIn,
  canWrite,
  circles,
  deleteHistory,
  inviteLink,
  inviteToCircle,
  introduce,
  isSupportCircle,
  leaveCircle,
  me,
  open,
  people,
  personName,
  removeContact,
  removeMember,
  renameCircle,
  resetInvites,
  setCirclePicture,
  setContactName,
  supportPeer,
  type CircleView,
  type Person,
} from '../core/session'
import { Avatar } from './Avatar'
import { Button, Confirm, CopyLink, Dialog, Qr, Row, Section } from './components'
import { MAX_CONTACT_NAME } from '../core/contactNames'
import { circleSummary, originOf } from './People'
import { StoreList } from './Files'
import * as Icons from './icons'
import { PersonSharings } from './Requests'
import { canShareWith } from './Place'
import { chatSearch, pane } from './nav'

export function Details({ conv }: { conv: ConvKey }) {
  const { kind, id } = parseKey(conv)
  return (
    <section class="page">
      <header class="page-head">
        <button type="button" class="icon-btn" aria-label={texts.nav.back} onClick={() => (pane.value = 'chat')}>
          <Icons.Back />
        </button>
        <h1>{kind === 'circle' ? texts.circle.details : texts.contact.details}</h1>
      </header>
      <div class="page-body">{kind === 'circle' ? <CircleDetails id={id} /> : <ContactDetails id={id} />}</div>
    </section>
  )
}

export function ActionTile({ icon, label, main, onClick }: { icon: ComponentChildren; label: string; main?: boolean; onClick: () => void }) {
  return (
    <button type="button" class={`action-tile ${main ? 'main' : ''}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

function toChat(conv: ConvKey, search = false) {
  pane.value = 'chat'
  open(conv)
  chatSearch.value = search
}

function CircleDetails({ id }: { id: string }) {
  const circle = circles.value.find((c) => c.id === id)
  const [showInvite, setShowInvite] = useState(false)
  const [editing, setEditing] = useState(false)
  const [ask, setAsk] = useState<'leave' | 'reset' | Person | null>(null)
  if (!circle) return <p class="muted">{texts.chat.noLongerInCircle}</p>
  const link = inviteLink(id)
  const own = me.value?.personId
  const members = [...circle.members].sort((a, b) => (a.id === own ? -1 : b.id === own ? 1 : a.name.localeCompare(b.name)))

  return (
    <>
      <div class="hero">
        <Avatar id={id} kind="circle" size={88} image={circle.image} />
        <h2>{circle.name}</h2>
        <p class="muted">{circleSummary(circle)}</p>
      </div>
      <div class="action-tiles">
        <ActionTile icon={<Icons.Chat />} label={texts.contact.write} onClick={() => toChat(circleKey(id))} />
        <ActionTile icon={<Icons.Search />} label={texts.profile.searchInChat} onClick={() => toChat(circleKey(id), true)} />
        {!circle.removed && <ActionTile icon={<Icons.Link />} label={texts.circle.invite} main onClick={() => setShowInvite(true)} />}
        {!circle.removed && <ActionTile icon={<Icons.Edit />} label={texts.profile.editCircle} onClick={() => setEditing(true)} />}
      </div>
      {!circle.removed && link && showInvite && (
        <Section title={texts.circle.invite} footer={texts.circle.inviteText}>
          <div class="card-pad invite">
            <Qr text={link} size={200} />
            <CopyLink link={link} />
          </div>
        </Section>
      )}
      {members.length > 0 && (
        <Section title={texts.circle.members}>
          {members.map((p) => (
            <MemberRow key={p.id} p={p} own={p.id === own} ownDevices={circle.ownDevices} canRemove={!circle.removed && p.id !== own} onRemove={() => setAsk(p)} />
          ))}
        </Section>
      )}
      {/* Support requests (ADR 0065) need no storage: users do not see it, support does. */}
      {!circle.removed && !isSupportCircle(id) && (
        <Section title={texts.profile.files}>
          <div class="card-pad">
            <StoreList scope={id} compact />
          </div>
        </Section>
      )}
      <Section>
        {!circle.removed && <Row icon={<Icons.Link />} title={texts.profile.invalidateInvites} onClick={() => setAsk('reset')} />}
        <div class="card-pad">
          <Button kind="danger" onClick={() => setAsk('leave')}>
            {circle.removed ? texts.circle.removeFromList : texts.circle.leave}
          </Button>
        </div>
      </Section>
      {editing && <EditCircle circle={circle} onClose={() => setEditing(false)} />}
      {ask === 'reset' && (
        <Confirm
          title={texts.profile.invalidateTitle}
          text={texts.profile.invalidateText}
          confirm={texts.profile.invalidate}
          onConfirm={() => resetInvites(id)}
          onClose={() => setAsk(null)}
        />
      )}
      {ask === 'leave' && <LeaveCircleConfirm circle={circle} onClose={() => setAsk(null)} onLeft={() => (pane.value = 'chat')} />}
      {ask && typeof ask === 'object' && (
        <Confirm
          title={texts.circle.removeTitle(personName(ask.id, ask.name))}
          text={texts.circle.removeConfirm(personName(ask.id, ask.name))}
          confirm={texts.circle.remove}
          onConfirm={() => removeMember(id, ask)}
          onClose={() => setAsk(null)}
        />
      )}
    </>
  )
}

function EditCircle({ circle, onClose }: { circle: CircleView; onClose: () => void }) {
  const name = useSignal(circle.name)
  const busy = useSignal(false)
  const error = useSignal('')
  const picker = useRef<HTMLInputElement>(null)
  async function picture(file: File | null) {
    busy.value = true
    error.value = ''
    if (!(await setCirclePicture(circle.id, file))) error.value = file ? texts.profile.pictureFailed : texts.common.error
    busy.value = false
  }
  return (
    <Dialog title={texts.profile.editCircle} onClose={onClose}>
      <form
        class="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault()
          busy.value = true
          const ok = await renameCircle(circle.id, name.value)
          busy.value = false
          if (ok) onClose()
          else error.value = texts.common.error
        }}
      >
        <div class="picture-edit">
          <Avatar id={circle.id} kind="circle" size={72} image={circle.image} />
          <input
            ref={picker}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.currentTarget.files?.[0]
              if (f) void picture(f)
              e.currentTarget.value = ''
            }}
          />
          <Button kind="secondary" onClick={() => picker.current?.click()} disabled={busy.value}>
            <Icons.Camera size={18} /> {texts.profile.changePicture}
          </Button>
          {circle.image && (
            <button type="button" class="link-btn danger" onClick={() => void picture(null)}>
              {texts.profile.removePicture}
            </button>
          )}
        </div>
        <label class="field">
          <span>{texts.profile.circleName}</span>
          <input class="input" maxLength={40} value={name.value} onInput={(e) => (name.value = e.currentTarget.value)} />
        </label>
        <p class="muted small">{texts.profile.everyoneSeesChange}</p>
        {error.value && <p class="error">{error.value}</p>}
        <div class="dialog-actions">
          <Button kind="quiet" onClick={onClose}>
            {texts.common.cancel}
          </Button>
          <Button kind="main" type="submit" disabled={!name.value.trim() || busy.value}>
            {texts.settings.save}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Member: tapping opens the person page (as in the app), next to it „Entfernen“. */
function MemberRow({ p, own, ownDevices, canRemove, onRemove }: { p: Person; own: boolean; ownDevices: number; canRemove: boolean; onRemove: () => void }) {
  return (
    <div class="member-row">
      <Row
        icon={<Avatar id={p.id} kind="person" size={36} image={p.image} />}
        title={own ? `${personName(p.id)} (${texts.circle.youAre})` : personName(p.id, p.name)}
        // One's own further devices are no extra line, only a note (ADR 0042). With an own name the profile name below.
        text={
          own
            ? ownDevices > 1
              ? texts.circle.ownDevicesInCircle(ownDevices)
              : undefined
            : p.profileName && p.profileName !== p.name
              ? texts.contact.profileName(p.profileName)
              : undefined
        }
        onClick={own ? undefined : () => toPerson(p.id)}
      />
      {canRemove && (
        <button type="button" class="link-btn danger member-remove" onClick={onRemove}>
          {texts.circle.remove}
        </button>
      )}
    </div>
  )
}

/** Leave a circle (or take it off the list once removed): from the circle page and from the overview (long press). */
export function LeaveCircleConfirm({ circle, onClose, onLeft }: { circle: CircleView; onClose: () => void; onLeft?: () => void }) {
  return (
    <Confirm
      title={circle.removed ? texts.circle.removeFromListTitle : texts.circle.leaveTitle(circle.name)}
      text={
        circle.removed
          ? texts.circle.removeFromListText
          : aloneIn(circle.id)
            ? `${texts.circle.leaveConfirm} ${texts.circle.leaveLastNote}`
            : texts.circle.leaveConfirm
      }
      note={circle.removed ? undefined : texts.circle.leaveContactsNote}
      confirm={circle.removed ? texts.circle.removeFromList : texts.circle.leave}
      onConfirm={async () => {
        await leaveCircle(circle.id)
        onLeft?.()
      }}
      onClose={onClose}
    />
  )
}

/** Delete the conversation with a person in this browser: from the contact page and from the overview (long press). */
export function DeleteHistoryConfirm({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  return (
    <Confirm
      title={texts.contact.deleteHistoryTitle(name)}
      text={texts.contact.deleteHistoryText(name)}
      confirm={texts.contact.delete}
      onConfirm={() => deleteHistory(directKey(id))}
      onClose={onClose}
    />
  )
}

export function toPerson(id: string) {
  pane.value = 'details'
  open(directKey(id))
}

export function toCircle(id: string) {
  pane.value = 'details'
  open(circleKey(id))
}

function ContactDetails({ id }: { id: string }) {
  const p = people.value.get(id)
  const name = personName(id, p?.name)
  const shared = circles.value.filter((c) => !c.removed && c.members.some((m) => m.id === id))
  const invitable = circles.value.filter((c) => !c.removed && !c.members.some((m) => m.id === id))
  const writable = canWrite(directKey(id))
  const [ask, setAsk] = useState<'invite' | 'history' | 'remove' | 'name' | 'share' | null>(null)
  const [invited, setInvited] = useState('')
  // Own name only for people with anynear, not for support (ADR 0065).
  const renamable = !!p && p.id !== supportPeer.value
  // „Kontakt teilen“ (ADR 0116): only to own contacts; both are asked before they can write to each other.
  const others = [...people.value.values()].filter((o) => o.contact && o.id !== id)
  return (
    <>
      <div class="hero">
        <Avatar id={id} kind="person" size={88} image={p?.image ?? null} />
        <h2>{name}</h2>
        {p && p.profileName && p.profileName !== p.name && <p class="muted small">{texts.contact.profileName(p.profileName)}</p>}
        {p && <p class="muted">{originOf(p)}</p>}
      </div>
      <div class="action-tiles">
        <ActionTile icon={<Icons.Chat />} label={texts.contact.write} main onClick={() => toChat(directKey(id))} />
        <ActionTile icon={<Icons.Search />} label={texts.profile.searchInChat} onClick={() => toChat(directKey(id), true)} />
        {renamable && <ActionTile icon={<Icons.Edit />} label={texts.contact.changeName} onClick={() => setAsk('name')} />}
        {p?.contact && <ActionTile icon={<Icons.Share />} label={texts.people.shareContact} onClick={() => setAsk('share')} />}
      </div>
      {/* „Freigaben“ (ADR 0123 §7): the place and SOS with this person, each to end here. */}
      {canShareWith(id) && <PersonSharings personId={id} />}
      {shared.length > 0 && (
        <Section title={texts.contact.inCircles}>
          {shared.map((c) => (
            <Row
              key={c.id}
              icon={<Avatar id={c.id} kind="circle" size={36} image={c.image} />}
              title={c.name}
              text={circleSummary(c)}
              onClick={() => toCircle(c.id)}
            />
          ))}
        </Section>
      )}
      <Section title={texts.contact.advanced} footer={invited || undefined}>
        {writable && invitable.length > 0 && <Row icon={<Icons.Circle />} title={texts.contact.inviteToCircle} onClick={() => setAsk('invite')} />}
        <Row icon={<Icons.Trash />} title={texts.contact.deleteHistory} onClick={() => setAsk('history')} />
      </Section>
      {p?.contact && (
        <Section footer={shared.length > 0 ? texts.contact.staysWhileSharedCircle(name) : undefined}>
          <div class="card-pad">
            <Button kind="danger" onClick={() => setAsk('remove')}>
              {texts.profile.removeContact}
            </Button>
          </div>
        </Section>
      )}
      {ask === 'invite' && (
        <Dialog title={texts.contact.inviteWhichCircle(name)} onClose={() => setAsk(null)}>
          <div class="dialog-body">
            <div class="card">
              {invitable.map((c) => (
                <Row
                  key={c.id}
                  icon={<Avatar id={c.id} kind="circle" size={36} image={c.image} />}
                  title={c.name}
                  onClick={async () => {
                    setAsk(null)
                    setInvited((await inviteToCircle(id, c.id)) ? texts.contact.invited(name, c.name) : texts.common.error)
                  }}
                />
              ))}
            </div>
          </div>
        </Dialog>
      )}
      {ask === 'name' && p && <ContactNameDialog p={p} onClose={() => setAsk(null)} />}
      {ask === 'share' && (
        <Dialog title={texts.people.shareContactWho(name)} onClose={() => setAsk(null)}>
          <div class="dialog-body">
            <p class="muted">{texts.people.shareContactHint(name)}</p>
            {others.length === 0 && <p>{texts.people.noOtherContacts}</p>}
            <div class="card">
              {others.map((o) => (
                <Row
                  key={o.id}
                  icon={<Avatar id={o.id} kind="person" size={36} image={o.image ?? null} />}
                  title={personName(o.id, o.name)}
                  onClick={async () => {
                    setAsk(null)
                    setInvited((await introduce(id, o.id)) ? texts.people.introSent(name, personName(o.id, o.name)) : texts.people.introFailed)
                  }}
                />
              ))}
            </div>
          </div>
        </Dialog>
      )}
      {ask === 'history' && <DeleteHistoryConfirm id={id} name={name} onClose={() => setAsk(null)} />}
      {ask === 'remove' && (
        <Confirm
          title={texts.profile.removeContactQuestion(name)}
          text={texts.contact.removeText(name)}
          confirm={texts.profile.removeContact}
          onConfirm={async () => {
            await removeContact(id)
            pane.value = 'chat'
          }}
          onClose={() => setAsk(null)}
        />
      )}
    </>
  )
}

/**
 * „Namen ändern“: an own name for [p] that only applies to oneself (on all own devices) and covers the name from their
 * profile everywhere. „Zurücksetzen“ shows the profile name again. As in the app.
 */
function ContactNameDialog({ p, onClose }: { p: Person; onClose: () => void }) {
  const name = useSignal(p.name)
  const hasOwn = p.name !== p.profileName
  return (
    <Dialog title={texts.contact.changeName} onClose={onClose}>
      <form
        class="dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          // Empty or the profile name again: no own name.
          setContactName(p.id, name.value.trim() === p.profileName.trim() ? '' : name.value)
          onClose()
        }}
      >
        <label class="field">
          <span>{texts.contact.nameLabel}</span>
          <input
            class="input"
            maxLength={MAX_CONTACT_NAME}
            value={name.value}
            placeholder={p.profileName}
            onInput={(e) => (name.value = e.currentTarget.value)}
          />
        </label>
        <p class="muted small">{texts.contact.nameHint}</p>
        {hasOwn && (
          <>
            <p class="muted small">{texts.contact.profileName(p.profileName)}</p>
            <button
              type="button"
              class="link-btn"
              onClick={() => {
                setContactName(p.id, '')
                onClose()
              }}
            >
              {texts.contact.resetName}
            </button>
          </>
        )}
        <div class="dialog-actions">
          <Button kind="quiet" onClick={onClose}>
            {texts.common.cancel}
          </Button>
          <Button kind="main" type="submit">
            {texts.settings.save}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
