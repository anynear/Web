// Crash report (ADR 0082), like `CrashReportUi.kt` of the app: card above the conversations, row under „Hilfe“,
// dialog with an optional note and „Was geschickt wird“. Sending goes via support (ADR 0065) with the file
// of the report; without a contact link „Kopieren“. There is no log in the browser.
import { useSignal } from '@preact/signals'
import { texts } from '../i18n'
import { clearCrashReports, crashReports, reportsText } from '../core/crashes'
import { open, sendSupportRequest } from '../core/session'
import { SUPPORT_CONTACT_LINK } from '../core/support'
import { Button, Dialog, Row } from './components'
import * as Icons from './icons'
import { pane, section } from './nav'

const SUPPORT_SEND_READY = SUPPORT_CONTACT_LINK !== null

function total(): number {
  return crashReports.value.reduce((n, r) => n + r.count, 0)
}

/** Card at the top of „Nachrichten“ as long as there are reports. */
export function CrashCard() {
  const showing = useSignal(false)
  if (crashReports.value.length === 0) return null
  return (
    <div class="nav-note crash-card">
      <div class="card-pad">
        <strong>{texts.support.crashCardTitle}</strong>
        <p class="muted small">{texts.support.crashCardText(total())}</p>
        <div class="crash-actions">
          <Button kind="secondary" onClick={() => (showing.value = true)}>
            {texts.support.crashReview}
          </Button>
          <Button kind="quiet" onClick={clearCrashReports}>
            {texts.support.crashDontSend}
          </Button>
        </div>
      </div>
      {showing.value && <CrashDialog close={() => (showing.value = false)} />}
    </div>
  )
}

/** Row under settings → help, as long as there are reports. */
export function CrashReportsRow() {
  const showing = useSignal(false)
  if (crashReports.value.length === 0) return null
  return (
    <>
      <Row icon={<Icons.Wrench />} title={texts.support.crashRow} text={texts.support.crashRowCount(total())} onClick={() => (showing.value = true)} />
      {showing.value && <CrashDialog close={() => (showing.value = false)} withDelete />}
    </>
  )
}

function CrashDialog({ close, withDelete = false }: { close: () => void; withDelete?: boolean }) {
  const note = useSignal('')
  const busy = useSignal(false)
  const error = useSignal('')
  const copied = useSignal(false)
  const text = reportsText(crashReports.value)

  async function sendReports() {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
      const count = total()
      const file = { bytes: new TextEncoder().encode(text), type: 'file', name: texts.support.crashFileName, width: 0, height: 0 }
      const conv = await sendSupportRequest('bug', texts.support.crashSubject(__APP_VERSION__), note.value.trim() || texts.support.crashDescription(count), [file])
      if (!conv) {
        error.value = texts.support.sendFailed
        return
      }
      clearCrashReports()
      close()
      section.value = 'messages'
      pane.value = 'chat'
      open(conv)
    } catch {
      error.value = texts.support.sendFailed
    } finally {
      busy.value = false
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      copied.value = true
      setTimeout(() => (copied.value = false), 1800)
    } catch {
      // Without clipboard the text under „Was geschickt wird“ stays for selecting.
    }
  }

  return (
    <Dialog title={texts.support.crashDialogTitle} onClose={close}>
      <div class="dialog-body">
        <p class="muted">{SUPPORT_SEND_READY ? texts.support.crashDialogInfo : texts.support.notYet}</p>
        {SUPPORT_SEND_READY && (
          <label class="field">
            <span>{texts.support.crashNote}</span>
            <textarea class="input" rows={2} disabled={busy.value} value={note.value} onInput={(e) => (note.value = e.currentTarget.value)} />
          </label>
        )}
        <details class="more">
          <summary>{texts.support.crashWhatIsSent}</summary>
          <pre class="crash-text">{text}</pre>
        </details>
        {error.value && <p class="error">{error.value}</p>}
        <div class="dialog-actions">
          {withDelete && (
            <Button
              kind="quiet"
              disabled={busy.value}
              onClick={() => {
                clearCrashReports()
                close()
              }}
            >
              {texts.support.crashDelete}
            </Button>
          )}
          {SUPPORT_SEND_READY ? (
            <Button kind="primary" disabled={busy.value} onClick={sendReports}>
              <Icons.Send size={18} /> {busy.value ? texts.support.sending : texts.support.send}
            </Button>
          ) : (
            <Button kind="primary" onClick={copy}>
              <Icons.Copy size={18} /> {copied.value ? texts.support.crashCopied : texts.support.crashCopy}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
