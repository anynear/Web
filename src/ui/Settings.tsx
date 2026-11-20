// Settings: name, own contact link, my devices (view only), connections, notifications,
// install as app, help (report a bug, question to us), delete in this browser.
import { useSignal } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'
import { texts } from '../i18n'
import {
  disableNotifications,
  eraseHere,
  enableNotifications,
  me,
  ownContactLink,
  isSupportIdentity,
  publicContactLink,
  revokePublicContactLink,
  ownDevices,
  ownImage,
  ownName,
  pushState,
  pushSupported,
  relays,
  setName,
  setOwnPicture,
  type PushState,
} from '../core/session'
import { Avatar } from './Avatar'
import { Button, CopyLink, Qr, Row, Section } from './components'
import * as Icons from './icons'
import { installPrompt } from './install'
import { pane, settingsAnchor, supportKind } from './nav'
import { setUsageStats, usageStatsLast, usageStatsOn, usageStatsTestMode } from '../core/usageStats'
import { CrashReportsRow } from './CrashReport'

export function Settings() {
  const name = useSignal(ownName.value)
  const [saved, setSaved] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [pictureError, setPictureError] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const [notify, setNotify] = useState<PushState>(pushState())
  const [notifyBusy, setNotifyBusy] = useState(false)

  // From the menu ⋮: jump to the chosen section.
  const anchor = settingsAnchor.value
  useEffect(() => {
    if (!anchor) return
    document.getElementById(anchor)?.scrollIntoView({ block: 'start' })
    settingsAnchor.value = null
  }, [anchor])

  useEffect(() => {
    ownContactLink().then(setLink, () => setLink(null))
  }, [])

  const r = relays.value
  return (
    <section class="page">
      <header class="page-head">
        <button type="button" class="icon-btn back-btn" aria-label={texts.nav.back} onClick={() => (pane.value = 'chat')}>
          <Icons.Back />
        </button>
        <h1>{texts.settings.title}</h1>
      </header>
      <div class="page-body">
        <Section id="profile" title={texts.settings.profile} footer={texts.settings.nameHint}>
          <div class="card-pad picture-edit">
            {ownImage.value ? (
              <img class="avatar" src={ownImage.value} width={72} height={72} style={{ borderRadius: '50%' }} alt={texts.profile.picture} />
            ) : (
              <Avatar id={me.value?.personId ?? ''} kind="person" size={72} />
            )}
            <input
              ref={picker}
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.currentTarget.files?.[0]
                e.currentTarget.value = ''
                if (f) setPictureError((await setOwnPicture(f)) ? '' : texts.profile.pictureFailed)
              }}
            />
            <Button kind="secondary" onClick={() => picker.current?.click()}>
              <Icons.Camera size={18} /> {texts.profile.changePicture}
            </Button>
            {ownImage.value && (
              <button type="button" class="link-btn danger" onClick={() => void setOwnPicture(null)}>
                {texts.profile.removePicture}
              </button>
            )}
            {pictureError && <p class="error">{pictureError}</p>}
          </div>
          <form
            class="card-pad inline-form"
            onSubmit={async (e) => {
              e.preventDefault()
              await setName(name.value)
              setSaved(true)
              setTimeout(() => setSaved(false), 1800)
            }}
          >
            <label class="field">
              <span>{texts.settings.name}</span>
              <input class="input" value={name.value} maxLength={40} onInput={(e) => (name.value = e.currentTarget.value)} />
            </label>
            <Button kind="primary" type="submit" disabled={!name.value.trim() || name.value.trim() === ownName.value}>
              {saved ? texts.settings.saved : texts.settings.save}
            </Button>
          </form>
        </Section>

        {link && (
          <Section title={texts.settings.ownContact} footer={texts.settings.ownContactText}>
            <div class="card-pad">
              {showQr && <Qr text={link} size={200} />}
              <CopyLink link={link} />
              {!showQr && (
                <button type="button" class="link-btn" onClick={() => setShowQr(true)}>
                  {texts.settings.ownContactQr}
                </button>
              )}
            </div>
          </Section>
        )}

        {isSupportIdentity.value && <PublicContact />}

        <Section id="devices" title={texts.settings.devices} footer={texts.settings.devicesText}>
          {ownDevices.value.map((d) => (
            <Row key={d.deviceId} icon={<Icons.Device />} title={d.name || '—'} text={d.deviceId === me.value?.deviceId ? texts.settings.thisDevice : undefined} />
          ))}
        </Section>

        <Section id="connections" title={texts.settings.connections}>
          <Row
            icon={<Icons.Signal />}
            title={r.reachable > 0 ? texts.settings.relaysOk(r.reachable, r.known) : texts.settings.relaysNone}
            right={<span class={`dot ${r.reachable > 0 ? 'ok' : ''}`} />}
          />
        </Section>

        {notify !== 'unsupported' && (
          <Section title={texts.settings.notifications} footer={pushSupported() ? texts.settings.notificationsPushText : texts.settings.notificationsText}>
            <Row
              icon={<Icons.Bell />}
              title={
                notify === 'on'
                  ? texts.settings.notificationsActive
                  : notify === 'tabOnly'
                    ? texts.settings.notificationsTabOnly
                    : notify === 'blocked'
                      ? texts.settings.notificationsBlocked
                      : texts.settings.notifications
              }
              right={
                notify === 'off' ? (
                  <Button
                    kind="secondary"
                    disabled={notifyBusy}
                    onClick={async () => {
                      setNotifyBusy(true)
                      setNotify(await enableNotifications())
                      setNotifyBusy(false)
                    }}
                  >
                    {texts.settings.notificationsOn}
                  </Button>
                ) : notify === 'on' || notify === 'tabOnly' ? (
                  <button type="button" class="link-btn" onClick={async () => setNotify(await disableNotifications())}>
                    {texts.settings.notificationsOff}
                  </button>
                ) : undefined
              }
            />
          </Section>
        )}

        <Section title={texts.settings.privacy}>
          <Row
            icon={<Icons.Lock />}
            title={texts.settings.usageStats}
            text={
              usageStatsTestMode.value
                ? texts.settings.usageStatsTestMode
                : usageStatsOn.value
                  ? texts.settings.usageStatsOn
                  : texts.settings.usageStatsOff
            }
            right={
              <input
                type="checkbox"
                role="switch"
                class="switch"
                aria-label={texts.settings.usageStats}
                checked={usageStatsOn.value}
                onChange={(e) => {
                  const on = e.currentTarget.checked
                  // Switching off only after confirmation: the switch is quickly flipped by accident.
                  if (!on && !confirm(texts.settings.usageStatsOffConfirm)) {
                    e.currentTarget.checked = true
                    return
                  }
                  void setUsageStats(on)
                }}
              />
            }
          />
          <Row
            icon={<Icons.File />}
            title={texts.settings.usageStatsSent}
            text={usageStatsLast.value ? texts.settings.usageStatsReport(usageStatsLast.value) : texts.settings.usageStatsNone}
          />
        </Section>

        {installPrompt.value && (
          <Section title={texts.settings.install} footer={texts.settings.installText}>
            <div class="card-pad">
              <Button
                kind="secondary"
                onClick={async () => {
                  await installPrompt.value?.prompt()
                  installPrompt.value = null
                }}
              >
                {texts.settings.installButton}
              </Button>
            </div>
          </Section>
        )}

        <Section id="help" title={texts.settings.help}>
          <CrashReportsRow />
          <Row
            icon={<Icons.Wrench />}
            title={texts.settings.reportProblem}
            text={texts.settings.reportProblemText}
            onClick={() => {
              supportKind.value = 'bug'
              pane.value = 'support'
            }}
          />
          <Row
            icon={<Icons.Help />}
            title={texts.settings.askUs}
            text={texts.settings.askUsText}
            onClick={() => {
              supportKind.value = 'question'
              pane.value = 'support'
            }}
          />
        </Section>

        <Section title={texts.settings.danger}>
          <div class="card-pad">
            <Button
              kind="danger"
              onClick={() => {
                if (confirm(texts.settings.eraseConfirm)) void eraseHere()
              }}
            >
              {texts.settings.erase}
            </Button>
          </div>
        </Section>
        <Section id="about" title={texts.settings.about}>
          <Row icon={<Icons.Circle />} title="anynear" text={texts.settings.version(__APP_VERSION__, __APP_BUILD__)} />
          {/* License as in the app (LICENSE, TRADEMARKS.md), with the required source of the region data (NOTICE). */}
          <details class="card-pad more">
            <summary>
              {texts.settings.license} · {texts.settings.licenseShort}
            </summary>
            <p class="small">{texts.settings.licenseText}</p>
            <p class="muted small">{texts.alerts.regionSource}</p>
          </details>
        </Section>

        <Section title={texts.settings.legal} footer={texts.settings.legalFooter}>
          <Row icon={<Icons.Help />} title={texts.settings.legalNotice} onClick={() => openPage(texts.settings.legalUrls.notice)} />
          <Row icon={<Icons.Lock />} title={texts.settings.privacy} onClick={() => openPage(texts.settings.legalUrls.privacy)} />
          <Row icon={<Icons.File />} title={texts.settings.terms} onClick={() => openPage(texts.settings.legalUrls.terms)} />
        </Section>
      </div>
    </section>
  )
}

/** A page of the website in a new tab: the web app stays open. */
function openPage(url: string) {
  window.open(url, '_blank', 'noopener')
}

/** Only on the support identity: contact link for publishing with authorisation for one year (ADR 0084 §6). */
function PublicContact() {
  const [link, setLink] = useState<string | null>(null)
  useEffect(() => {
    publicContactLink().then(setLink, () => setLink(null))
  }, [])
  return (
    <Section title={texts.settings.publicContact} footer={texts.settings.publicContactText}>
      <div class="card-pad">
        {link ? (
          <>
            <CopyLink link={link} />
            <button
              type="button"
              class="link-btn danger"
              onClick={async () => {
                await revokePublicContactLink()
                setLink(null)
              }}
            >
              {texts.settings.publicContactRevoke}
            </button>
          </>
        ) : (
          <Button kind="secondary" onClick={() => publicContactLink().then(setLink, () => setLink(null))}>
            {texts.settings.publicContactRenew}
          </Button>
        )}
      </div>
    </Section>
  )
}
