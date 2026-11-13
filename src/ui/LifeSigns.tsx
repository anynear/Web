// Signs of life in „Meldungen“ as in the app (LifeSignsSection.kt, ADR 0083 §1, §5): start in a circle of choice, the
// own card with „Alles gut“, the helpers' cards, and the big button over everything.
import { useSignal } from '@preact/signals'
import { useEffect, useState } from 'preact/hooks'
import { texts } from '../i18n'
import {
  ALARM,
  ASK,
  AWAY,
  BACK,
  ENDED,
  HINT,
  LOOKING,
  REASON_MISSED,
  TEMPLATES,
  type LifeSign,
  type Loudness,
  type Template,
  care,
  choices,
  confirm,
  end,
  fullScreen,
  helpers,
  lifeSigns,
  loudness,
  meAway,
  nameOf,
  openSection,
  preselect,
  setLoudness,
  start,
} from '../core/lifesigns'
import { circles } from '../core/session'
import { Button, Dialog } from './components'
import { formatDateTime, formatTime } from './format'
import { dialog, section } from './nav'

/** Section at the top of the left list in „Meldungen“. */
export function LifeSignsSection() {
  const all = lifeSigns.value
  const own = all.find((s) => s.own && s.phase !== ENDED)
  const watched = all.filter((s) => !s.own && s.phase !== ENDED)
  const [starting, setStarting] = useState(false)
  const [ending, setEnding] = useState(false)
  const l = texts.lifeSigns
  return (
    <>
      <h2 class="section-title nav-title">{l.section}</h2>
      <div class="active-alerts">
        {watched.map((s) => (
          <WatchedCard key={s.id} s={s} />
        ))}
        {own ? (
          <OwnCard s={own} onEnd={() => setEnding(true)} />
        ) : (
          <div class="nav-note">
            <Button kind="secondary" onClick={() => setStarting(true)}>
              {l.start}
            </Button>
            <p class="muted small">{l.intro}</p>
          </div>
        )}
        <p class="muted small nav-note">{l.browserNote}</p>
      </div>
      {starting && <StartDialog onClose={() => setStarting(false)} />}
      {ending && own && <EndDialog s={own} onClose={() => setEnding(false)} />}
    </>
  )
}

function OwnCard({ s, onEnd }: { s: LifeSign; onEnd: () => void }) {
  const l = texts.lifeSigns
  const asking = s.phase === ASK
  const { all, heard } = helpers(s)
  const circle = circles.value.find((c) => c.id === s.circleId)?.name ?? ''
  return (
    <div class={`alert-card ${asking ? 'warning' : ''}`}>
      <span class="alert-when">{[s.label, circle].filter(Boolean).join(' · ')}</span>
      <span class="alert-title big">{asking ? l.askNow : l.runningSince(formatTime(s.start))}</span>
      {!asking && <span class="alert-text">{l.nextQuestion(formatDateTime(s.due))}</span>}
      <span class="alert-text">{heard.length === 0 ? l.heardByNobody : l.heardBy(heard.length, all.length)}</span>
      {s.notArriving && <strong>{l.notArriving}</strong>}
      {s.looking.length > 0 && <span class="alert-text">{l.lookingBy(s.looking.map(nameOf).join(', '))}</span>}
      {s.away.length > 0 && <span class="alert-text">{l.awayBy(s.away.map(nameOf).join(', '))}</span>}
      <span class="alert-actions">
        <Button kind="main" onClick={() => void confirm(s.id)}>
          {l.allGood}
        </Button>
        <Button kind="secondary" class="alert-end" onClick={onEnd}>
          {l.done}
        </Button>
        <Button kind="quiet" onClick={() => (fullScreen.value = true)}>
          {l.bigButton}
        </Button>
      </span>
    </div>
  )
}

function WatchedCard({ s }: { s: LifeSign }) {
  const l = texts.lifeSigns
  const who = nameOf(s.owner)
  const tone = s.phase === ALARM ? 'alarm' : s.phase === HINT ? 'warning' : ''
  const missed = s.reason === REASON_MISSED
  const away = meAway(s)
  const circle = circles.value.find((c) => c.id === s.circleId)?.name ?? ''
  const [level, setLevel] = useState<Loudness>(loudness(s.circleId))
  const title =
    s.phase === ALARM ? (missed ? l.missedTitle(who) : l.unreachableTitle(who)) : s.phase === HINT ? (missed ? l.missedTitle(who) : l.hintTitle(who)) : l.watchTitle(who, s.label)
  const text =
    s.phase === ALARM ? (missed ? l.missedText : l.unreachableText(formatTime(s.lastAt))) : s.phase === HINT ? l.hintText : l.lastSign(formatDateTime(s.confirmedAt || s.start))
  return (
    <div class={`alert-card ${tone}`}>
      <span class="alert-when">{circle}</span>
      <span class="alert-title big">{title}</span>
      <span class="alert-text">{text}</span>
      {away && <span class="alert-text">{l.awayActive}</span>}
      {s.looking.length > 0 && <span class="alert-text">{l.lookingBy(s.looking.map(nameOf).join(', '))}</span>}
      <span class="alert-actions">
        {s.phase === HINT || s.phase === ALARM ? (
          <Button kind="main" onClick={() => void care(s.id, LOOKING)}>
            {l.looking}
          </Button>
        ) : away ? (
          <Button kind="secondary" class="alert-end" onClick={() => void care(s.id, BACK)}>
            {l.back}
          </Button>
        ) : (
          <Button kind="secondary" class="alert-end" onClick={() => void care(s.id, AWAY)}>
            {l.away}
          </Button>
        )}
      </span>
      <span class="alert-details">{l.loudness}</span>
      <span class="chips">
        {(['loud', 'normal', 'off'] as Loudness[]).map((v) => (
          <button
            key={v}
            type="button"
            class={`chip ${level === v ? 'active' : ''}`}
            aria-pressed={level === v}
            onClick={() => {
              setLoudness(s.circleId, v)
              setLevel(v)
            }}
          >
            {v === 'loud' ? l.loud : v === 'normal' ? l.normal : l.off}
          </button>
        ))}
      </span>
    </div>
  )
}

function StartDialog({ onClose }: { onClose: () => void }) {
  const l = texts.lifeSigns
  const usable = choices(circles.value)
  const known = (id: string) => (usable.find((c) => c.id === id)?.members.length ?? 1) - 1
  const template = useSignal<Template>('work')
  const circleId = useSignal<string | null>(preselect(usable, known))
  const hours = useSignal(2)
  const minutes = useSignal(30)
  const busy = useSignal(false)
  const names: Record<Template, [string, string]> = {
    work: [l.templateWork, l.templateWorkText],
    outside: [l.templateOutside, l.templateOutsideText],
    home: [l.templateHome, l.templateHomeText],
    daily: [l.templateDaily, l.templateDailyText],
    custom: [l.templateCustom, l.customText(hours.value, minutes.value)],
  }
  return (
    <Dialog title={l.startTitle} onClose={onClose}>
      <form
        class="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!circleId.value) return
          busy.value = true
          const ok = await start(template.value, circleId.value, hours.value, minutes.value).catch(() => false)
          busy.value = false
          if (ok) onClose()
        }}
      >
        {usable.length === 0 ? (
          <>
            {/* No circle yet: straight to creating one (afterwards it opens with the invitation). */}
            <p>{l.noCircle}</p>
            <Button
              kind="main"
              onClick={() => {
                onClose()
                dialog.value = 'startCircle'
              }}
            >
              {l.createCircle}
            </Button>
          </>
        ) : (
          <>
            <p>{l.startText}</p>
            {TEMPLATES.map((t) => (
              <label key={t} class="radio-row">
                <input type="radio" name="template" checked={template.value === t} onChange={() => (template.value = t)} />
                <span>
                  <strong>{names[t][0]}</strong>
                  <br />
                  <span class="muted small">{names[t][1]}</span>
                </span>
              </label>
            ))}
            {template.value === 'custom' && (
              <>
                <p class="muted small">{l.customHours}</p>
                <span class="chips">
                  {[1, 2, 4, 8, 12].map((h) => (
                    <button key={h} type="button" class={`chip ${hours.value === h ? 'active' : ''}`} onClick={() => (hours.value = h)}>
                      {h}
                    </button>
                  ))}
                </span>
                <p class="muted small">{l.customMinutes}</p>
                <span class="chips">
                  {[15, 30, 60, 120].map((m) => (
                    <button key={m} type="button" class={`chip ${minutes.value === m ? 'active' : ''}`} onClick={() => (minutes.value = m)}>
                      {m}
                    </button>
                  ))}
                </span>
              </>
            )}
            <p class="muted small">{l.goesTo}</p>
            {usable.map((c) => (
              <label key={c.id} class="radio-row">
                <input type="radio" name="circle" checked={circleId.value === c.id} onChange={() => (circleId.value = c.id)} />
                <span>{known(c.id) > 0 ? l.circleWithCount(c.name, known(c.id)) : l.circleNobodyYet(c.name)}</span>
              </label>
            ))}
            <p class="muted small">{l.notEmergency}</p>
          </>
        )}
        <div class="dialog-actions">
          <Button kind="quiet" onClick={onClose}>
            {texts.common.cancel}
          </Button>
          {usable.length > 0 && (
            <Button kind="main" type="submit" disabled={!circleId.value || busy.value}>
              {l.startNow}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  )
}

function EndDialog({ s, onClose }: { s: LifeSign; onClose: () => void }) {
  const l = texts.lifeSigns
  return (
    <Dialog title={l.done} onClose={onClose}>
      <div class="dialog-body">
        <p>{l.endConfirm}</p>
        <div class="dialog-actions">
          <Button kind="quiet" onClick={onClose}>
            {texts.common.cancel}
          </Button>
          <Button
            kind="primary"
            onClick={() => {
              onClose()
              void end(s.id)
            }}
          >
            {l.done}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/** Big button over everything (ADR 0083 §5.2); also after tapping the question. Rendered once, globally. */
export function LifeSignFullScreen() {
  const l = texts.lifeSigns
  const tick = openSection.value
  useEffect(() => {
    if (tick > 0) section.value = 'alerts'
  }, [tick])
  const s = lifeSigns.value.find((x) => x.own && x.phase !== ENDED)
  const [ending, setEnding] = useState(false)
  if (!fullScreen.value || !s) return null
  const asking = s.phase === ASK
  const { all, heard } = helpers(s)
  const circle = circles.value.find((c) => c.id === s.circleId)?.name ?? ''
  return (
    <div class={`lifesign-full ${asking ? 'asking' : ''}`} role="dialog" aria-modal="true" aria-label={l.section}>
      <div class="lifesign-full-top">
        <span>{[s.label, circle].filter(Boolean).join(' · ')}</span>
        <strong class="lifesign-full-next">{asking ? l.askNow : l.nextQuestion(formatDateTime(s.due))}</strong>
        <span>{heard.length === 0 ? l.heardByNobody : l.heardBy(heard.length, all.length)}</span>
        {s.notArriving && <strong>{l.notArriving}</strong>}
      </div>
      <button type="button" class="lifesign-big" onClick={() => void confirm(s.id)}>
        <span aria-hidden="true" class="lifesign-big-check">✓</span>
        <span>{l.allGood}</span>
      </button>
      <div class="lifesign-full-actions">
        <Button kind="secondary" onClick={() => setEnding(true)}>
          {l.done}
        </Button>
        <Button kind="quiet" onClick={() => (fullScreen.value = false)}>
          {l.close}
        </Button>
      </div>
      {ending && <EndDialog s={s} onClose={() => setEnding(false)} />}
    </div>
  )
}
