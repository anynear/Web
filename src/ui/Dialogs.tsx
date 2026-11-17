// Create a circle, join a circle (invitation link), add a contact (contact link).
import { useSignal } from '@preact/signals'
import { texts } from '../i18n'
import { circleKey } from '../core/messages'
import { circleToJoin } from '../core/invites'
import { useEffect, useState } from 'preact/hooks'
import { addContact, createCircle, joinCircle, open, ownContactLink, previewLink } from '../core/session'
import { Button, CopyLink, Dialog, Qr, Spinner } from './components'
import { dialog, dialogLink, pane } from './nav'

export function Dialogs() {
  const close = () => {
    dialog.value = null
    dialogLink.value = ''
  }
  switch (dialog.value) {
    case 'startCircle':
      return <StartCircle close={close} />
    case 'joinCircle':
      return <LinkDialog kind="join" close={close} />
    case 'addContact':
      return <LinkDialog kind="contact" close={close} />
    case 'ownContact':
      return <OwnContact close={close} />
    default:
      return null
  }
}

function StartCircle({ close }: { close: () => void }) {
  const name = useSignal('')
  const busy = useSignal(false)
  const error = useSignal('')
  return (
    <Dialog title={texts.list.startCircle} onClose={close}>
      <form
        class="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault()
          busy.value = true
          try {
            const id = await createCircle(name.value)
            close()
            pane.value = 'details'
            open(circleKey(id))
          } catch {
            error.value = texts.common.error
          } finally {
            busy.value = false
          }
        }}
      >
        <label class="field">
          <span>{texts.circle.nameLabel}</span>
          <input class="input" autoFocus maxLength={40} placeholder={texts.circle.namePlaceholder} value={name.value} onInput={(e) => (name.value = e.currentTarget.value)} />
        </label>
        {error.value && <p class="error">{error.value}</p>}
        <div class="dialog-actions">
          <Button kind="quiet" onClick={close}>
            {texts.common.cancel}
          </Button>
          <Button kind="main" type="submit" disabled={!name.value.trim() || busy.value}>
            {texts.circle.create}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

const JOIN_TEXT: Record<string, string> = {
  joined: texts.circle.joined,
  already: texts.circle.already,
  foreign: texts.circle.foreign,
  invalid: texts.circle.invalid,
}
const CONTACT_TEXT: Record<string, string> = {
  added: texts.contact.added,
  known: texts.contact.known,
  mismatch: texts.contact.mismatch,
  own: texts.contact.own,
  foreign: texts.contact.foreign,
  invalid: texts.contact.invalid,
}

/** Circle of the invitation in [link], as long as one is not in it yet; `null` otherwise (broken, other kind, member). */
function useCircleInvite(link: string, active: boolean): { name: string; inviter: string } | null {
  const [invite, setInvite] = useState<{ name: string; inviter: string } | null>(null)
  useEffect(() => {
    setInvite(null)
    if (!active || !link.trim()) return
    let live = true
    previewLink(link.trim()).then(
      (p) => live && setInvite(circleToJoin(p)),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [link, active])
  return invite
}

function LinkDialog({ kind, close }: { kind: 'join' | 'contact'; close: () => void }) {
  const link = useSignal(dialogLink.value)
  const busy = useSignal(false)
  const result = useSignal<{ ok: boolean; text: string } | null>(null)
  const join = kind === 'join'
  // Like the app: a readable invitation first asks „Dem Kreis … beitreten?“ with who invites; joined only on „Beitreten“.
  const invite = useCircleInvite(link.value, join)
  return (
    <Dialog title={invite ? texts.circle.joinTitle(invite.name) : join ? texts.list.joinCircle : texts.list.addContact} onClose={close}>
      <form
        class="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault()
          busy.value = true
          try {
            const r = join ? await joinCircle(link.value) : await addContact(link.value)
            const ok = r === 'joined' || r === 'already' || r === 'added' || r === 'known'
            result.value = { ok, text: (join ? JOIN_TEXT : CONTACT_TEXT)[r] ?? texts.common.error }
            if (ok) setTimeout(close, 1200)
          } catch {
            result.value = { ok: false, text: texts.common.error }
          } finally {
            busy.value = false
          }
        }}
      >
        {invite ? (
          <>
            {invite.inviter && (
              <p>
                <strong>{texts.circle.invitedBy(invite.inviter)}</strong>
              </p>
            )}
            <p>{texts.circle.joinText}</p>
          </>
        ) : (
          <label class="field">
            <span>{join ? texts.circle.joinLabel : texts.contact.addLabel}</span>
            <input
              class="input mono"
              autoFocus
              placeholder={join ? texts.circle.joinPlaceholder : texts.contact.addPlaceholder}
              value={link.value}
              onInput={(e) => {
                link.value = e.currentTarget.value
                result.value = null
              }}
            />
          </label>
        )}
        {result.value && <p class={result.value.ok ? 'ok' : 'error'}>{result.value.text}</p>}
        <div class="dialog-actions">
          <Button kind="quiet" onClick={close}>
            {invite ? texts.circle.dontJoin : texts.common.cancel}
          </Button>
          <Button kind="main" type="submit" disabled={!link.value.trim() || busy.value || !!result.value?.ok}>
            {join ? texts.circle.join : texts.contact.add}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** „Mein Kontakt“ like `OwnCodeDialog` of the app: QR code to scan with the phone, below it the link to copy. */
function OwnContact({ close }: { close: () => void }) {
  const [link, setLink] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    ownContactLink().then(setLink, () => setLink(null))
  }, [])
  return (
    <Dialog title={texts.people.myContact} onClose={close}>
      <div class="dialog-body">
        {link === undefined ? (
          <p class="muted">
            <Spinner /> {texts.people.preparingContact}
          </p>
        ) : link === null ? (
          <p class="error">{texts.common.error}</p>
        ) : (
          <>
            <p>{texts.people.ownContactText}</p>
            <div class="qr-center">
              <Qr text={link} size={200} />
            </div>
            <CopyLink link={link} />
          </>
        )}
        <div class="dialog-actions">
          <Button kind="quiet" onClick={close}>
            {texts.common.done}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
