// Top level: depending on the phase loading, pairing, main view or notice.
import { texts } from '../i18n'
import { later, reloadToNewVersion } from '../core/appUpdate'
import { eraseHere, guidePending, openConv, phase, updateBanner, updateTick, webUpdate } from '../core/session'
import { formatLongDate } from './format'
import { AlertsDialogs, ChannelPage } from './Alerts'
import { LifeSignFullScreen } from './LifeSigns'
import { Chat } from './Chat'
import { Button, Spinner } from './components'
import { ConversationList } from './ConversationList'
import { Details } from './Details'
import { Dialogs } from './Dialogs'
import { LoginDialog } from './Login'
import { Viewer } from './Viewer'
import { FilesPage, FilesSearchPage } from './Files'
import { alertSel, filesQuery, filesSel, forwarding, pane, section, supportKind } from './nav'
import { PasswordsPage } from './Passwords'
import { Guide } from './Guide'
import { Pairing } from './Pairing'
import { Settings } from './Settings'
import { SupportPage } from './Support'
import { RadioSetupPage } from './RadioSetup'

export function App() {
  // „Funkgerät einrichten“ also works without pairing (link from the iOS app, ADR 0095).
  if (pane.value === 'radio' && phase.value !== 'loading' && phase.value !== 'ready') {
    return (
      <main class="radio-standalone-shell">
        <RadioSetupPage standalone />
      </main>
    )
  }
  switch (phase.value) {
    case 'loading':
      return (
        <main class="center-screen">
          <img src="/brand/anynear-emblem.svg" width="65" height="56" alt="" />
          <p>
            <Spinner /> {texts.loading}
          </p>
        </main>
      )
    case 'unsupported':
      return <Notice title={texts.unsupported.title} text={texts.unsupported.text} />
    case 'revoked':
      return (
        <Notice title={texts.revoked.title} text={texts.revoked.text}>
          <Button kind="main" onClick={() => void eraseHere()}>
            {texts.revoked.reset}
          </Button>
        </Notice>
      )
    case 'pairing':
      return (
        <>
          <UpdateBar />
          <Pairing />
        </>
      )
    case 'ready':
      return (
        <>
          <UpdateBar />
          {guidePending.value ? <Guide /> : <Main />}
        </>
      )
  }
}

/**
 * One update bar (ADR 0096 §4 with `clients.min`): notice with date, or „Bitte aktualisiere anynear“ (the relays
 * require a newer version, or still old after reloading by itself). Reloading fetches the new version via the service
 * worker. „Später“ only for the notice with date.
 */
function UpdateBar() {
  const banner = updateBanner.value
  if (banner === 'none') return null
  const t = texts.update
  return (
    <div class="update-bar" role={banner === 'outdated' ? 'alert' : 'status'}>
      <span>
        {banner === 'outdated' ? (
          <>
            <strong>{t.title}</strong> {t.text}
          </>
        ) : (
          t.soon(formatLongDate(webUpdate.value.from))
        )}
      </span>
      <Button onClick={() => void reloadToNewVersion()}>{t.reload}</Button>
      {banner !== 'outdated' && (
        <Button
          onClick={() => {
            later()
            updateTick.value++
          }}
        >
          {t.later}
        </Button>
      )}
    </div>
  )
}

function Main() {
  const conv = openConv.value
  const sel = filesSel.value
  const channel = alertSel.value
  const right =
    section.value === 'files'
      ? filesQuery.value.trim()
        ? 'filesSearch'
        : sel === 'passwords'
        ? 'passwords'
        : sel
          ? 'files'
          : 'none'
      : section.value === 'alerts'
        ? channel
          ? 'channel'
          : 'none'
        : pane.value === 'settings' || pane.value === 'support' || pane.value === 'radio'
          ? pane.value
          : conv
            ? pane.value
            : 'none'
  return (
    <div class={`shell ${right === 'none' || forwarding.value ? 'show-list' : 'show-main'}`}>
      <ConversationList />
      <main class="main">
        {right === 'settings' && <Settings />}
        {right === 'radio' && <RadioSetupPage />}
        {right === 'support' && <SupportPage key={supportKind.value} kind={supportKind.value} />}
        {right === 'details' && conv && <Details key={conv} conv={conv} />}
        {/* New per conversation: list, search and draft depend on the conversation. */}
        {right === 'chat' && conv && <Chat key={conv} conv={conv} />}
        {right === 'files' && sel && <FilesPage key={sel} scope={sel} />}
        {right === 'filesSearch' && <FilesSearchPage />}
        {right === 'passwords' && <PasswordsPage />}
        {right === 'channel' && channel && <ChannelPage key={channel} id={channel} />}
        {right === 'none' && (
          <div class="placeholder">
            <img src="/brand/anynear-emblem.svg" width="74" height="64" alt="" />
            <p>{section.value === 'alerts' ? texts.alerts.pick : texts.chat.pick}</p>
          </div>
        )}
      </main>
      <Dialogs />
      <AlertsDialogs />
      <LoginDialog />
      <LifeSignFullScreen />
      <Viewer />
    </div>
  )
}

function Notice({ title, text, children }: { title: string; text: string; children?: preact.ComponentChildren }) {
  return (
    <main class="center-screen">
      <img src="/brand/anynear-emblem.svg" width="65" height="56" alt="" />
      <h1>{title}</h1>
      <p class="lead">{text}</p>
      {children}
    </main>
  )
}
