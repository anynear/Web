// Passwords in the browser (ADR 0059 §5, §6): set up, open with the lock of the computer (default) or with a
// confirmation on the phone, view, copy, create, change, delete logins, one-time codes. Wording as in
// the app (PasswordTexts).
import { useSignal } from '@preact/signals'
import { useEffect, useState } from 'preact/hooks'
import { texts } from '../i18n'
import {
  enterPasswords,
  forgetPasswordsHere,
  leavePasswords,
  lockNow,
  passwordBusy,
  passwordError,
  passwordState,
  removeLogin,
  saveLogin,
  setUpPasswords,
  unlockPasswords,
  unlockWithPhone,
} from '../core/passwords'
import { type Login, displayName, generatePassword, newLoginId, otpCode, otpSecondsLeft, parseOtp, sortLogins } from '../core/vault'
import { Button, Dialog, Row, Section, Spinner } from './components'
import * as Icons from './icons'
import { filesSel } from './nav'

export function PasswordsPage() {
  useEffect(() => {
    void enterPasswords()
    return () => leavePasswords()
  }, [])
  const s = passwordState.value
  return (
    <section class="page">
      <header class="page-head">
        <button type="button" class="icon-btn back-btn" aria-label={texts.nav.back} onClick={() => (filesSel.value = null)}>
          <Icons.Back />
        </button>
        <h1>{texts.passwords.title}</h1>
        {s.kind === 'unlocked' && (
          <button type="button" class="icon-btn head-action" aria-label={texts.passwords.lock} title={texts.passwords.lock} onClick={lockNow}>
            <Icons.Lock />
          </button>
        )}
      </header>
      <div class="page-body">
        {s.kind === 'unavailable' && <Notice title={texts.passwords.unavailableTitle} text={texts.passwords.unavailableText} />}
        {s.kind === 'setup' && <SetUp remote={s.remote} computer={s.computer} />}
        {s.kind === 'locked' && <Locked computer={s.computer} />}
        {s.kind === 'phone' && <WaitingForPhone />}
        {s.kind === 'unlocked' && <Logins logins={s.logins} />}
        <More />
      </div>
    </section>
  )
}

function ErrorLine() {
  const e = passwordError.value
  if (!e) return null
  const text = e === 'noKey' ? texts.passwords.waitingText : texts.passwords[e === 'unsupported' ? 'unavailableText' : e]
  return <p class="error">{text}</p>
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div class="lock-card">
      <Icons.Key size={40} />
      <h2>{title}</h2>
      <p class="muted">{text}</p>
    </div>
  )
}

function SetUp({ remote, computer }: { remote: 'found' | 'noKey' | 'empty' | 'later'; computer: boolean }) {
  if (remote === 'noKey') return <Notice title={texts.passwords.waitingTitle} text={texts.passwords.waitingText} />
  return (
    <div class="lock-card">
      <Icons.Key size={40} />
      <h2>{texts.passwords.setUpTitle}</h2>
      <p class="muted">{computer ? texts.passwords.setUpText : texts.passwords.phoneOnlyText}</p>
      <p class="muted">{remote === 'empty' ? texts.passwords.setUpEmpty : texts.passwords.setUpFound}</p>
      <ErrorLine />
      {computer ? (
        <>
          <Button kind="main" disabled={passwordBusy.value} onClick={() => void setUpPasswords()}>
            {passwordBusy.value ? <Spinner /> : <Icons.Lock size={18} />} {texts.passwords.setUp}
          </Button>
          <PhoneLink />
        </>
      ) : (
        <Button kind="main" disabled={passwordBusy.value} onClick={() => void unlockWithPhone()}>
          <Icons.Device size={18} /> {texts.passwords.withPhone}
        </Button>
      )}
    </div>
  )
}

/** Second way under the main button: via the phone, in case the computer does not work or the phone is missing. */
function PhoneLink() {
  return (
    <div class="other-way">
      <span class="muted small">{texts.passwords.noComputerLock}</span>
      <button type="button" class="link-btn" onClick={() => void unlockWithPhone()}>
        {texts.passwords.withPhone}
      </button>
    </div>
  )
}

function Locked({ computer }: { computer: boolean }) {
  return (
    <div class="lock-card">
      <Icons.Lock size={40} />
      <h2>{texts.passwords.lockedTitle}</h2>
      <p class="muted">{computer ? texts.passwords.lockedText : texts.passwords.phoneOnlyText}</p>
      <ErrorLine />
      {computer ? (
        <>
          <Button kind="main" disabled={passwordBusy.value} onClick={() => void unlockPasswords()}>
            {passwordBusy.value ? <Spinner /> : <Icons.Lock size={18} />} {texts.passwords.unlock}
          </Button>
          <PhoneLink />
        </>
      ) : (
        <Button kind="main" disabled={passwordBusy.value} onClick={() => void unlockWithPhone()}>
          <Icons.Device size={18} /> {texts.passwords.withPhone}
        </Button>
      )}
    </div>
  )
}

function WaitingForPhone() {
  return (
    <div class="lock-card">
      <Icons.Device size={40} />
      <h2>{texts.passwords.phoneTitle}</h2>
      <p class="muted">{texts.passwords.phoneText}</p>
      <p class="muted">
        <Spinner />
      </p>
      <Button kind="quiet" onClick={lockNow}>
        {texts.passwords.phoneCancel}
      </Button>
    </div>
  )
}

function Logins({ logins }: { logins: Login[] }) {
  const query = useSignal('')
  const [editing, setEditing] = useState<Login | 'new' | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const q = query.value.trim().toLowerCase()
  const shown = sortLogins(logins).filter((l) => !q || l.website.toLowerCase().includes(q) || l.username.toLowerCase().includes(q))
  return (
    <>
      <div class="store-actions">
        <Button kind="main" onClick={() => setEditing('new')}>
          <Icons.Plus size={18} /> {texts.passwords.addLogin}
        </Button>
        {passwordBusy.value && <Spinner />}
      </div>
      <input class="input search" type="search" placeholder={texts.passwords.search} value={query.value} onInput={(e) => (query.value = e.currentTarget.value)} />
      <ErrorLine />
      <Section title={texts.passwords.logins}>
        {shown.length === 0 && <div class="card-pad muted">{texts.passwords.noLogins}</div>}
        {shown.map((l) => (
          <LoginRow key={l.id} l={l} open={openId === l.id} onToggle={() => setOpenId(openId === l.id ? null : l.id)} onEdit={() => setEditing(l)} />
        ))}
      </Section>
      {editing && <LoginDialog login={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function LoginRow({ l, open, onToggle, onEdit }: { l: Login; open: boolean; onToggle: () => void; onEdit: () => void }) {
  const [shown, setShown] = useState(false)
  const passkeys = l.passkeys?.length ?? 0
  return (
    <div class="login">
      <Row icon={<Icons.Key />} title={displayName(l.website)} text={l.username} onClick={onToggle} right={<Icons.Back size={16} />} />
      {open && (
        <div class="login-body">
          {l.username && <CopyField label={texts.passwords.username} value={l.username} copyLabel={texts.passwords.copyUsername} />}
          {l.password && (
            <div class="login-field">
              <span class="muted small">{texts.passwords.password}</span>
              <span class="login-value mono">{shown ? l.password : '••••••••••••'}</span>
              <span class="login-buttons">
                <button type="button" class="link-btn" onClick={() => setShown(!shown)}>
                  {shown ? texts.passwords.hide : texts.passwords.show}
                </button>
                <CopyButton value={l.password} label={texts.passwords.copyPassword} />
              </span>
            </div>
          )}
          {l.otp && <OtpField uri={l.otp} />}
          {passkeys > 0 && <p class="muted small">{texts.passwords.passkey(passkeys)}</p>}
          <div class="login-actions">
            <Button kind="secondary" onClick={onEdit}>
              <Icons.Edit size={16} /> {texts.passwords.edit}
            </Button>
            <Button
              kind="danger"
              onClick={() => {
                if (confirm(`${texts.passwords.deleteQuestion(displayName(l.website))}\n\n${texts.passwords.deleteText}`)) void removeLogin(l.id)
              }}
            >
              {texts.passwords.delete}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function CopyField({ label, value, copyLabel }: { label: string; value: string; copyLabel: string }) {
  return (
    <div class="login-field">
      <span class="muted small">{label}</span>
      <span class="login-value">{value}</span>
      <span class="login-buttons">
        <CopyButton value={value} label={copyLabel} />
      </span>
    </div>
  )
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      class="link-btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          // without clipboard only copying by hand remains
        }
      }}
    >
      {done ? texts.passwords.copied : label}
    </button>
  )
}

function OtpField({ uri }: { uri: string }) {
  const otp = parseOtp(uri)
  const [code, setCode] = useState('')
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!otp) return
    let alive = true
    const tick = async () => {
      const c = await otpCode(otp)
      if (!alive) return
      setCode(c)
      setLeft(otpSecondsLeft(otp))
    }
    void tick()
    const t = setInterval(tick, 1000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [uri])
  if (!otp) return <p class="error small">{texts.passwords.otpInvalid}</p>
  return (
    <div class="login-field">
      <span class="muted small">{texts.passwords.otp}</span>
      <span class="login-value mono otp">{code.replace(/(\d{3})(?=\d)/g, '$1 ')}</span>
      <span class="login-buttons">
        <span class="muted small">{texts.passwords.otpSeconds(left)}</span>
        <CopyButton value={code} label={texts.passwords.copyCode} />
      </span>
    </div>
  )
}

function LoginDialog({ login, onClose }: { login: Login | null; onClose: () => void }) {
  const website = useSignal(login?.website ?? '')
  const username = useSignal(login?.username ?? '')
  const password = useSignal(login?.password ?? '')
  const otp = useSignal(login?.otp ?? '')
  const showOtp = useSignal(!!login?.otp)
  const error = useSignal('')
  return (
    <Dialog title={login ? texts.passwords.editLogin : texts.passwords.addLogin} onClose={onClose}>
      <form
        class="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault()
          const hasPasskey = (login?.passkeys?.length ?? 0) > 0
          if (!website.value.trim() || (!password.value && !hasPasskey)) {
            error.value = texts.passwords.needWebsiteAndPassword
            return
          }
          if (otp.value.trim() && !parseOtp(otp.value)) {
            error.value = texts.passwords.otpInvalid
            return
          }
          await saveLogin({
            id: login?.id ?? newLoginId(),
            website: website.value.trim(),
            username: username.value.trim(),
            password: password.value,
            otp: otp.value.trim() || undefined,
          })
          onClose()
        }}
      >
        <label class="field">
          <span>{texts.passwords.website}</span>
          <input class="input" autoFocus placeholder={texts.passwords.websiteHint} value={website.value} onInput={(e) => (website.value = e.currentTarget.value)} autoComplete="off" />
        </label>
        <label class="field">
          <span>{texts.passwords.username}</span>
          <input class="input" placeholder={texts.passwords.usernameHint} value={username.value} onInput={(e) => (username.value = e.currentTarget.value)} autoComplete="off" />
        </label>
        <label class="field">
          <span>{texts.passwords.password}</span>
          <input class="input mono" type="text" value={password.value} onInput={(e) => (password.value = e.currentTarget.value)} autoComplete="off" spellcheck={false} />
        </label>
        <button type="button" class="link-btn" onClick={() => (password.value = generatePassword())}>
          {texts.passwords.generate}
        </button>
        {showOtp.value ? (
          <label class="field">
            <span>{texts.passwords.otp}</span>
            <input class="input mono" placeholder="otpauth://totp/…" value={otp.value} onInput={(e) => (otp.value = e.currentTarget.value)} autoComplete="off" />
            <span class="muted small">{texts.passwords.otpHint}</span>
          </label>
        ) : (
          <button type="button" class="link-btn" onClick={() => (showOtp.value = true)}>
            {texts.passwords.otpAdd}
          </button>
        )}
        {error.value && <p class="error">{error.value}</p>}
        <div class="dialog-actions">
          <Button kind="quiet" onClick={onClose}>
            {texts.passwords.cancel}
          </Button>
          <Button kind="main" type="submit" disabled={passwordBusy.value}>
            {texts.passwords.save}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function More() {
  const s = passwordState.value
  return (
    <details class="more">
      <summary>{texts.passwords.howItWorks}</summary>
      <ul class="more-list">
        <li>{texts.passwords.moreUnlock}</li>
        <li>{texts.passwords.moreLock}</li>
        <li>{texts.passwords.moreOnlyYou}</li>
      </ul>
      {(s.kind === 'locked' || s.kind === 'unlocked') && (
        <Button
          kind="danger"
          onClick={() => {
            if (confirm(texts.passwords.forgetHereText)) forgetPasswordsHere()
          }}
        >
          {texts.passwords.forgetHere}
        </Button>
      )}
    </details>
  )
}
