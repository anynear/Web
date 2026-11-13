// Guided steps after pairing (ADR 0073 §9), as in the app after the name: per step one sentence, one main button,
// „Später“. Background and radio do not exist in the browser; name and picture come from the phone.
import { useEffect, useState } from 'preact/hooks'
import { texts } from '../i18n'
import { curatedChannel, enableOfficial, officialAvailable } from '../core/channels'
import { planGuide, type GuideStep } from '../core/guide'
import { enableNotifications, finishGuide } from '../core/session'
import { Button, Spinner } from './components'
import * as Icons from './icons'

function currentPlan(): GuideStep[] {
  const ask = typeof Notification !== 'undefined' && Notification.permission === 'default'
  return planGuide(ask, officialAvailable.peek(), !!curatedChannel.peek())
}

export function Guide() {
  // Determined once on opening, so that „Schritt x von y“ stays stable.
  const [steps] = useState(currentPlan)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const step = steps[index]
  // Nothing to do (everything allowed or the browser cannot do it): straight to the main view.
  useEffect(() => {
    if (!step) finishGuide()
  }, [step])
  if (!step) return null
  const next = () => {
    setFailed(false)
    if (index < steps.length - 1) setIndex(index + 1)
    else finishGuide()
  }
  const back = index > 0 ? () => setIndex(index - 1) : null
  const label = steps.length > 1 ? texts.guide.step(index + 1, steps.length) : null

  const notifications = (
    <>
      <Icons.Bell />
      {label && <p class="muted small">{label}</p>}
      <h1>{texts.guide.notificationsTitle}</h1>
      <p class="lead">{texts.guide.notificationsText}</p>
      <div class="guide-actions">
        <Button
          kind="main"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            // The browser's question; afterwards it continues, no matter what was decided.
            await enableNotifications().catch(() => null)
            setBusy(false)
            next()
          }}
        >
          {texts.guide.notificationsAllow}
        </Button>
        <Button kind="quiet" disabled={busy} onClick={next}>
          {texts.guide.later}
        </Button>
      </div>
    </>
  )

  const alerts = (
    <>
      <Icons.Warning />
      {label && <p class="muted small">{label}</p>}
      <h1>{texts.guide.alertsTitle}</h1>
      <p class="lead">{texts.guide.alertsText}</p>
      <p class="muted">{texts.guide.alertsLocationNote}</p>
      {failed && (
        <p class="error" role="status">
          {texts.guide.alertsFailed}
        </p>
      )}
      <div class="guide-actions">
        <Button
          kind="main"
          disabled={busy}
          onClick={async () => {
            if (failed) return next()
            setBusy(true)
            // Subscribes to the channel; the browser then asks for the approximate location (only for the district).
            const r = await enableOfficial().catch(() => 'invalid')
            setBusy(false)
            if (r === 'joined' || r === 'already') next()
            else setFailed(true)
          }}
        >
          {busy && <Spinner />} {failed ? texts.guide.next : texts.guide.alertsTurnOn}
        </Button>
        {!failed && (
          <Button kind="quiet" disabled={busy} onClick={next}>
            {texts.guide.later}
          </Button>
        )}
      </div>
    </>
  )

  return (
    <main class="pairing">
      <div class="pairing-card guide-card">
        {step === 'notifications' ? notifications : alerts}
        {back && (
          <Button kind="quiet" onClick={back}>
            {texts.guide.back}
          </Button>
        )}
      </div>
    </main>
  )
}
