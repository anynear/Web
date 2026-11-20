// „Bei … anmelden?“ (ADR 0122), as in the app (ui/LoginUi.kt): service with its domain, „Dein Name dort“ with the
// profile name as default, three numbers. A number confirms; nothing leaves the browser before that.
import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { LoginInfo } from 'anmp-core'
import { texts } from '../i18n'
import { confirmLogin, defaultLoginName, loginInfo, loginNameOk, pendingLogin, type LoginStatus } from '../core/login'
import { ownName } from '../core/session'
import { Button, Dialog, Spinner } from './components'

function message(s: LoginStatus): string {
  switch (s) {
    case 'wrong-number':
      return texts.login.wrongNumber
    case 'expired':
      return texts.login.expired
    case 'rejected':
      return texts.login.rejected
    case 'too-many':
      return texts.login.tooMany
    case 'no-chain':
      return texts.login.noChain
    case 'bad-name':
      return texts.login.badName
    case 'invalid':
      return texts.login.invalid
    case 'locked':
      return texts.login.locked
    default:
      return texts.login.offline
  }
}

/** The request can no longer be used after these; only „Schließen“ is left. */
const FINAL: LoginStatus[] = ['wrong-number', 'expired', 'rejected', 'invalid', 'no-chain']

export function LoginDialog() {
  const link = pendingLogin.value
  if (!link) return null
  return <LoginDialogFor key={link} link={link} close={() => (pendingLogin.value = null)} />
}

function LoginDialogFor({ link, close }: { link: string; close: () => void }) {
  const info = useSignal<LoginInfo | null>(null)
  const name = useSignal(defaultLoginName(ownName.value))
  const busy = useSignal(false)
  const error = useSignal('')
  const over = useSignal(false)
  const done = useSignal('')

  useEffect(() => {
    let live = true
    loginInfo(link).then(
      (r) => {
        if (!live) return
        if (typeof r === 'string') {
          error.value = message(r)
          over.value = true
        } else info.value = r
      },
      () => {
        if (live) {
          error.value = texts.login.offline
          over.value = true
        }
      },
    )
    return () => {
      live = false
    }
  }, [link])

  async function pick(n: number) {
    const i = info.value
    if (!i || busy.value) return
    if (!loginNameOk(name.value)) {
      error.value = texts.login.badName
      return
    }
    busy.value = true
    error.value = ''
    let r: LoginStatus
    try {
      r = await confirmLogin(i, n, name.value)
    } catch {
      r = 'offline'
    }
    busy.value = false
    if (r === 'ok') {
      done.value = texts.login.done(i.name)
      over.value = true
      setTimeout(close, 2500)
    } else {
      error.value = message(r)
      over.value = FINAL.includes(r)
    }
  }

  const i = info.value
  return (
    <Dialog title={i ? texts.login.title(i.name) : texts.login.loading} onClose={() => !busy.value && close()}>
      <div class="dialog-body">
        {!i && !error.value && <Spinner />}
        {i && (
          <p>
            <strong>{i.domain}</strong>
          </p>
        )}
        {i && !over.value && (
          <>
            <label class="field">
              <span>{texts.login.nameLabel}</span>
              <input
                class="input"
                maxLength={80}
                value={name.value}
                disabled={busy.value}
                onInput={(e) => {
                  name.value = e.currentTarget.value
                  error.value = ''
                }}
              />
              <span class="muted">{texts.login.nameHint}</span>
            </label>
            <p>{texts.login.pickNumber}</p>
            <div class="login-choices">
              {Array.from(i.choices).map((n) => (
                <Button key={n} kind="secondary" class="login-choice" disabled={busy.value} onClick={() => void pick(n)}>
                  {String(n)}
                </Button>
              ))}
            </div>
            <p class="muted">{texts.login.footnote}</p>
          </>
        )}
        {busy.value && (
          <p>
            <Spinner /> {texts.login.confirming}
          </p>
        )}
        {done.value && <p class="ok">{done.value}</p>}
        {error.value && <p class="error">{error.value}</p>}
        <div class="dialog-actions">
          {over.value ? (
            <Button kind="main" onClick={close}>
              {texts.login.close}
            </Button>
          ) : (
            <Button kind="quiet" onClick={close} disabled={busy.value}>
              {texts.common.cancel}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
