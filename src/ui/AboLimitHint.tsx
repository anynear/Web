// Hint when reaching a limit of a message (ADR 0076 §1a): which plan allows more, with „Pakete ansehen“.
// Values from the website's subscription preview; without it (offline, older preview) nothing shows. Like the app's AboLimitHint.
import { useEffect, useState } from 'preact/hooks'
import { texts } from '../i18n'
import { loadAboOnce, planName, upgradeFor, type AboLimit, type AboPreview } from '../core/abo'
import { openAboPlans } from './Files'

const german = () => texts.dateLocale.startsWith('de')

export function AboLimitHint({ limit }: { limit: AboLimit }) {
  const [preview, setPreview] = useState<AboPreview | null>(null)
  useEffect(() => {
    let live = true
    loadAboOnce().then((p) => live && setPreview(p))
    return () => {
      live = false
    }
  }, [])
  const up = preview && upgradeFor(preview, limit)
  if (!up) return null
  const name = planName(up.plan, german())
  const text =
    limit === 'textChars'
      ? texts.compose.aboLongerText(name, up.value)
      : limit === 'attachmentMb'
        ? texts.compose.aboBiggerAttachments(name, up.value)
        : texts.compose.aboMoreAttachments(name, up.value)
  return (
    <span class="muted small">
      {text}{' '}
      <button type="button" class="link-btn" onClick={openAboPlans}>
        {texts.compose.aboSeePlans}
      </button>
    </span>
  )
}
