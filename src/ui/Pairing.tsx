// Pairing as a further device (ADR 0042 §5): QR with `https://anynear.app/p#…`, the phone scans it with the camera
// (Universal Link / App Link) or under „Meine Geräte“ → „Gerät hinzufügen“ and hands over keys and name; then the page restarts.
import { useEffect, useState } from 'preact/hooks'
import { texts } from '../i18n'
import { browserDeviceName } from '../core/device'
import { awaitPairing, ownPairingCode, pairingOffer } from '../core/session'
import { Button, CopyLink, Qr, Spinner } from './components'

type State = { kind: 'creating' } | { kind: 'waiting'; link: string; code: string | null } | { kind: 'timeout' } | { kind: 'failed' } | { kind: 'done' }

export function Pairing() {
  const [state, setState] = useState<State>({ kind: 'creating' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setState({ kind: 'creating' })
    pairingOffer(browserDeviceName())
      .then(async (link) => {
        if (!alive) return
        setState({ kind: 'waiting', link, code: await ownPairingCode().catch(() => null) })
        const ok = await awaitPairing()
        if (alive) setState(ok ? { kind: 'done' } : { kind: 'timeout' })
      })
      .catch(() => alive && setState({ kind: 'failed' }))
    return () => {
      alive = false
    }
  }, [attempt])

  return (
    <main class="pairing">
      <div class="pairing-card">
        <img class="pairing-logo" src="/brand/anynear-logo.svg" alt="anynear" width="121" height="48" />
        <h1>{texts.pairing.title}</h1>
        <p class="lead">{texts.pairing.lead}</p>
        <div class="pairing-body">
          <div class="pairing-steps">
            <ol class="steps">
              {texts.pairing.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p class="muted small">{texts.pairing.fallback}</p>
          </div>
          <div class="pairing-code">
            {state.kind === 'waiting' && (
              <>
                <Qr text={state.link} size={248} />
                {state.code && (
                  <p class="pairing-compare">
                    {texts.pairing.codeLabel} <strong>{state.code}</strong>
                  </p>
                )}
                <p class="muted waiting">
                  <Spinner /> {texts.pairing.waiting}
                </p>
              </>
            )}
            {state.kind === 'creating' && (
              <div class="qr-placeholder">
                <Spinner />
              </div>
            )}
            {state.kind === 'done' && <p class="ok">{texts.pairing.done}</p>}
            {(state.kind === 'timeout' || state.kind === 'failed') && (
              <div class="qr-placeholder">
                <p>{state.kind === 'timeout' ? texts.pairing.timeout : texts.pairing.failed}</p>
                <Button kind="main" onClick={() => setAttempt((a) => a + 1)}>
                  {texts.pairing.again}
                </Button>
              </div>
            )}
          </div>
        </div>
        {state.kind === 'waiting' && (
          <details class="more">
            <summary>{texts.pairing.copyLink}</summary>
            <CopyLink link={state.link} />
          </details>
        )}
        <p class="muted small">{texts.pairing.privacy}</p>
        <p class="muted small">{texts.pairing.usageStats}</p>
        <p class="muted small">
          {texts.pairing.noApp}{' '}
          <a href="https://anynear.app/app/" target="_blank" rel="noopener">
            {texts.pairing.getApp}
          </a>
        </p>
        {/* Legal pages reachable before pairing too (§ 5 DDG); afterwards under Settings → Legal. */}
        <p class="muted small">
          <a href={texts.settings.legalUrls.notice} target="_blank" rel="noopener">
            {texts.settings.legalNotice}
          </a>
          {' · '}
          <a href={texts.settings.legalUrls.privacy} target="_blank" rel="noopener">
            {texts.settings.privacy}
          </a>
          {' · '}
          <a href={texts.settings.legalUrls.terms} target="_blank" rel="noopener">
            {texts.settings.terms}
          </a>
        </p>
      </div>
    </main>
  )
}
