// Support form as in the app: „Fehler melden“ and „Frage an uns“, reachable via settings → help.
// As in the app, sending creates a separate circle with support and sends support the invitation link
// (`sendSupportRequest`, ADR 0065). Without a contact link (`SUPPORT_CONTACT_LINK`) sending stays off. There is no log
// in the browser, so no checkbox for it either.
import { useSignal } from '@preact/signals'
import { texts } from '../i18n'
import { MAX_SUBJECT, SUPPORT_CONTACT_LINK, type SupportKind, supportFormComplete } from '../core/support'
import { open, sendSupportRequest } from '../core/session'
import { Button } from './components'
import * as Icons from './icons'
import { pane, section } from './nav'

/** Can the browser send a request? Only with the contact link of support. */
const SUPPORT_SEND_READY = SUPPORT_CONTACT_LINK !== null

export function SupportPage({ kind }: { kind: SupportKind }) {
  return (
    <section class="page">
      <header class="page-head">
        <button type="button" class="icon-btn back-btn" aria-label={texts.nav.back} onClick={() => (pane.value = 'settings')}>
          <Icons.Back />
        </button>
        <h1>{kind === 'bug' ? texts.support.reportTitle : texts.support.askTitle}</h1>
      </header>
      <div class="page-body">
        <SupportForm kind={kind} />
      </div>
    </section>
  )
}

/** Shared building block: subject and description (both mandatory), send; afterwards the circle opens. */
export function SupportForm({ kind }: { kind: SupportKind }) {
  const subject = useSignal('')
  const description = useSignal('')
  const busy = useSignal(false)
  const error = useSignal('')
  return (
    <form
      class="card-pad support-form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!SUPPORT_SEND_READY || busy.value || !supportFormComplete(subject.value, description.value)) return
        busy.value = true
        error.value = ''
        try {
          const conv = await sendSupportRequest(kind, subject.value, description.value)
          if (!conv) {
            error.value = texts.support.sendFailed
            return
          }
          subject.value = ''
          description.value = ''
          section.value = 'messages'
          pane.value = 'chat'
          open(conv)
        } catch {
          error.value = texts.support.sendFailed
        } finally {
          busy.value = false
        }
      }}
    >
      <p class="muted small">{kind === 'bug' ? texts.support.reportIntro : texts.support.askIntro}</p>
      <label class="field">
        <span>{texts.support.subject}</span>
        <input class="input" required maxLength={MAX_SUBJECT} value={subject.value} onInput={(e) => (subject.value = e.currentTarget.value)} />
      </label>
      <label class="field">
        <span>{texts.support.description}</span>
        <textarea class="input" required rows={6} value={description.value} onInput={(e) => (description.value = e.currentTarget.value)} />
      </label>
      {!SUPPORT_SEND_READY && <p class="muted small">{texts.support.notYet}</p>}
      {error.value && <p class="error">{error.value}</p>}
      <Button kind="primary" type="submit" disabled={!SUPPORT_SEND_READY || busy.value || !supportFormComplete(subject.value, description.value)}>
        <Icons.Send size={18} /> {busy.value ? texts.support.sending : texts.support.send}
      </Button>
    </form>
  )
}
