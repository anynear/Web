// Places as in the app (ADR 0121 §24–§29): „Wer sieht mich?“ in three steps, the cards in the chat for places
// (SpotCard, MutualPlaceCard of the app), „Standort freigeben“, and the questions to be an SOS contact
// (SosUi of the app). The browser sends no place of its own; the phone does that (ADR 0121, Folgen).
import { useState } from 'preact/hooks'
import { texts } from '../i18n'
import {
  answerMutualPlace,
  askMutualPlace,
  circles,
  isSupportCircle,
  me,
  messages,
  people,
  personName,
  sharing,
  sharingState,
  theirLevel,
  type Person,
} from '../core/session'
import { mapLink } from '../core/lifesigns'
import { always, levelFor, ownCircleLevel, ownPersonLevel, wireOf, type Level } from '../core/sharing'
import { SPOT, answerTo, answersQuestion, mutualAnswered, newestShared } from '../core/spots'
import { askLater, askNow, askedLater, answerSos, currentAsk, sosAgreed, sosAsks } from '../core/sos'
import type { Msg } from '../core/messages'
import { parseKey } from '../core/messages'
import { Avatar } from './Avatar'
import { Button, Dialog, Row, Section } from './components'
import { formatTime } from './format'
import * as Icons from './icons'
import { pane } from './nav'

export function levelName(l: Level): string {
  const t = texts.place
  return l === 'off' ? t.levelOff : l === 'when' ? t.levelWhen : l === 'area' ? t.levelArea : t.levelExact
}

function levelText(l: Level): string {
  const t = texts.place
  return l === 'off' ? t.levelOffText : l === 'when' ? t.levelWhenText : l === 'area' ? t.levelAreaText : t.levelExactText
}

// --- Wer sieht mich? -------------------------------------------------------------------------------------------

/** The circles one shares with: not removed, no support circle (as the choices for a check-in). */
function shownCircles() {
  return circles.value.filter((c) => !c.removed && !isSupportCircle(c.id))
}

function otherPeople(): Person[] {
  const own = me.value?.personId
  return [...people.value.values()].filter((p) => p.id !== own).sort((a, b) => a.name.localeCompare(b.name))
}

/** „Wer sieht mich?“ (ADR 0121 §27): from top to bottom, everyone, the circles, single persons; and „Alles pausieren“. */
export function WhoSeesMePage() {
  const t = texts.place
  const s = sharingState.value
  const now = Date.now()
  const [editing, setEditing] = useState<{ kind: 'default' } | { kind: 'circle'; id: string } | { kind: 'person'; id: string } | null>(null)
  const base = levelName(s.default ?? 'off')
  const until = (key: string) => {
    const u = s.until[key]
    return u && u > now ? ` · ${t.until(formatTime(u))}` : ''
  }
  const list = shownCircles()
  const persons = otherPeople()
  return (
    <section class="page">
      <header class="page-head">
        <button type="button" class="icon-btn back-btn" aria-label={texts.nav.back} onClick={() => (pane.value = 'settings')}>
          <Icons.Back />
        </button>
        <h1>{t.whoSeesMe}</h1>
      </header>
      <div class="page-body">
        <p class="muted">{t.whoSeesMeText}</p>
        <p class="muted small">{t.whoSeesMeBrowser}</p>
        <Section>
          <Row
            icon={<Icons.Pause />}
            title={t.pauseAll}
            text={s.paused ? t.pauseAllOn : t.pauseAllOff}
            right={
              <input
                type="checkbox"
                role="switch"
                class="switch"
                aria-label={t.pauseAll}
                checked={s.paused}
                onChange={(e) => sharing.setPaused(e.currentTarget.checked)}
              />
            }
          />
        </Section>
        <Section title={t.stepAll} footer={t.stepAllFooter}>
          <Row icon={<Icons.Map />} title={base} right={<Icons.Forward size={18} />} onClick={() => setEditing({ kind: 'default' })} />
        </Section>
        {list.length > 0 && (
          <Section title={t.stepCircles} footer={t.stepCirclesFooter}>
            {list.map((c) => {
              const own = ownCircleLevel(s, c.id, now)
              return (
                <Row
                  key={c.id}
                  icon={<Avatar id={c.id} kind="circle" size={40} image={c.image} />}
                  title={c.name}
                  text={own ? levelName(own) + until(`c:${c.id}`) : t.likeAll(base)}
                  right={<Icons.Forward size={18} />}
                  onClick={() => setEditing({ kind: 'circle', id: c.id })}
                />
              )
            })}
          </Section>
        )}
        {persons.length > 0 && (
          <Section title={t.stepPersons} footer={t.stepPersonsFooter}>
            {persons.map((p) => {
              const own = ownPersonLevel(s, p.id, now)
              const inCircles = p.circles.filter((c) => list.some((x) => x.id === c))
              const level = levelName(levelFor(s, p.id, inCircles, now))
              const mutual = sharing.agreed(p.id) ? ` · ${t.mutualMark}` : ''
              return (
                <Row
                  key={p.id}
                  icon={<Avatar id={p.id} kind="person" size={40} image={p.image} />}
                  title={p.name}
                  text={
                    own
                      ? levelName(own) + until(`p:${p.id}`) + mutual
                      : inCircles.some((c) => ownCircleLevel(s, c, now))
                        ? t.likeCircles(level)
                        : t.likeAll(level)
                  }
                  right={<Icons.Forward size={18} />}
                  onClick={() => setEditing({ kind: 'person', id: p.id })}
                />
              )
            })}
          </Section>
        )}
      </div>
      {editing?.kind === 'default' && (
        <LevelDialog
          title={t.defaultRow}
          levels={['off', 'when']}
          current={s.default}
          onClose={() => setEditing(null)}
          onPick={(l) => {
            if (l) sharing.setDefault(l)
            setEditing(null)
          }}
        />
      )}
      {editing?.kind === 'circle' && (
        <LevelDialog
          title={t.chooseLevel(list.find((c) => c.id === editing.id)?.name ?? '')}
          levels={['off', 'when', 'area', 'exact']}
          current={ownCircleLevel(s, editing.id, now) ?? s.default}
          onClose={() => setEditing(null)}
          onPick={(l) => {
            const members = (circles.value.find((c) => c.id === editing.id)?.members ?? []).map((p) => p.id).filter((id) => id !== me.value?.personId)
            sharing.setCircle(editing.id, l, members)
            setEditing(null)
          }}
        />
      )}
      {editing?.kind === 'person' && (
        <LevelDialog
          title={t.chooseLevel(personName(editing.id))}
          levels={['off', 'when', 'area', 'exact']}
          current={ownPersonLevel(s, editing.id, now)}
          follow={t.followsCircles}
          onClose={() => setEditing(null)}
          onPick={(l) => {
            if (always(l)) sharing.approve([editing.id])
            sharing.setPerson(editing.id, l)
            setEditing(null)
          }}
        />
      )}
    </section>
  )
}

/** Choose a level; [follow] offers to have no own setting (`null`). */
function LevelDialog({
  title,
  levels,
  current,
  follow,
  onPick,
  onClose,
}: {
  title: string
  levels: Level[]
  current: Level | null
  follow?: string
  onPick: (level: Level | null) => void
  onClose: () => void
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <div class="dialog-body">
        {follow && (
          <label class="radio-row">
            <input type="radio" name="level" checked={current == null} onChange={() => onPick(null)} />
            <span>
              <strong>{follow}</strong>
            </span>
          </label>
        )}
        {levels.map((l) => (
          <label key={l} class="radio-row">
            <input type="radio" name="level" checked={current === l} onChange={() => onPick(l)} />
            <span>
              <strong>{levelName(l)}</strong>
              <br />
              <span class="muted small">{levelText(l)}</span>
            </span>
          </label>
        ))}
        <div class="dialog-actions">
          <Button kind="quiet" onClick={onClose}>
            {texts.common.cancel}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/** The row in the settings that leads to „Wer sieht mich?“. */
export function WhoSeesMeRow() {
  const s = sharingState.value
  const t = texts.place
  return (
    <Row
      icon={<Icons.Map />}
      title={t.whoSeesMe}
      text={s.paused ? t.pauseAllOn : `${t.defaultRow}: ${levelName(s.default ?? 'off')}`}
      right={<Icons.Forward size={18} />}
      onClick={() => (pane.value = 'whoSeesMe')}
    />
  )
}

// --- Standort freigeben (ADR 0121 §28) ----------------------------------------------------------------------------

/**
 * First what the person and the other already show each other, also when it was set up elsewhere (a circle, „Wer
 * sieht mich?“, the phone); then, if there is more to ask for, the level. The own place is shown at it from then on.
 */
export function MutualPlaceDialog({ personId, onClose }: { personId: string; onClose: () => void }) {
  const t = texts.place
  const name = personName(personId)
  // Reading the signal keeps the state current after a change on another own device.
  sharingState.value
  const inCircles = people.value.get(personId)?.circles.filter((c) => shownCircles().some((x) => x.id === c)) ?? []
  const b = sharing.between(personId, inCircles, theirLevel(personId), Date.now())
  const [level, setLevel] = useState<Level>(b.suggested ?? 'area')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <Dialog title={t.mutualTitle(name)} onClose={onClose}>
      <div class="dialog-body">
        {b.exists && (
          <>
            {b.both && (
              <p>
                <strong>{t.mutualBoth(name, b.both === 'exact')}</strong>
              </p>
            )}
            <p>
              {t.mutualMine(name, levelName(b.mine))}
              <br />
              {t.mutualTheirs(name, levelName(b.theirs))}
            </p>
            {b.open && <p class="muted small">{t.mutualWaiting(name)}</p>}
            <p class="muted small">{t.mutualChange}</p>
          </>
        )}
        {b.askable.length > 0 && <p>{b.exists ? t.mutualMore : t.mutualText}</p>}
        {(
          [
            ['area', t.mutualArea, t.mutualAreaText],
            ['exact', t.mutualExact, t.mutualExactText],
          ] as const
        )
          .filter(([l]) => b.askable.includes(l))
          .map(([l, title, text]) => (
            <label key={l} class="radio-row">
              <input type="radio" name="mutual" checked={level === l} onChange={() => setLevel(l)} />
              <span>
                <strong>{title}</strong>
                <br />
                <span class="muted small">{text}</span>
              </span>
            </label>
          ))}
        {failed && <p class="field-error">{t.sendFailed}</p>}
        <div class="dialog-actions">
          {b.askable.length === 0 ? (
            <Button kind="primary" onClick={onClose}>
              {texts.common.done}
            </Button>
          ) : (
            <>
              <Button kind="quiet" onClick={onClose}>
                {texts.common.cancel}
              </Button>
              <Button
                kind="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  const ok = await askMutualPlace(personId, b.askable.includes(level) ? level : (b.suggested ?? level))
                  setBusy(false)
                  if (ok) onClose()
                  else setFailed(true)
                }}
              >
                {t.mutualSend}
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  )
}

// --- Cards in the chat (ADR 0121 §26) ----------------------------------------------------------------------------

/**
 * A message about a place as a card in the middle, the same for sender and reader; it names who it is from. The
 * browser shows no map: a place opens on OpenStreetMap over the button, as before.
 */
export function SpotEvent({ m }: { m: Msg }) {
  const s = m.spot!
  const t = texts.place
  const who = personName(m.fromPerson, m.fromName)
  const all = messages.value
  if (s.kind === SPOT.SHARE || s.kind === SPOT.SHARED) return <MutualCard m={m} who={who} all={all} />
  if (s.kind === SPOT.ALL) {
    const over = !!s.until && s.until <= Date.now()
    return (
      <div class="spot-card">
        <div class="spot-title">
          <Icons.Map size={20} />
          <strong>{over ? t.shareAllOver : s.until ? t.shareAllUntil(formatTime(s.until)) : t.shareAll}</strong>
        </div>
        <span class="muted small">{m.outgoing ? t.spotByOwn : t.spotBy(who)}</span>
        {!over && !m.outgoing && <span class="muted small">{t.shareAllHint}</span>}
      </div>
    )
  }
  const arrived = s.kind === SPOT.ARRIVED
  const ask = s.kind === SPOT.ASK
  const title =
    s.kind === SPOT.MEET
      ? s.label
        ? t.spotMeetText(s.label)
        : t.spotMeet
      : ask
        ? m.outgoing
          ? t.spotAskOwn
          : t.spotAskBy(who)
        : arrived
          ? m.outgoing
            ? t.arrivedOwn
            : t.arrivedBy(who)
          : m.outgoing
            ? t.spotHereOwn
            : t.spotHere(who)
  const place = s.latitude != null && s.longitude != null
  const answer = ask ? answerTo(m, all) : undefined
  const direct = parseKey(m.conv).kind === 'direct'
  return (
    <div class={`spot-card ${arrived ? 'arrived' : ''}`}>
      <div class="spot-title">
        {arrived ? <span class="spot-tick" aria-hidden="true">✓</span> : <Icons.Map size={20} />}
        <strong>{title}</strong>
      </div>
      {s.kind === SPOT.MEET && <span class="muted small">{m.outgoing ? t.spotByOwn : t.spotBy(who)}</span>}
      {arrived && s.label && <span>{s.label}</span>}
      {place && (
        <a
          class={`btn btn-secondary spot-map ${arrived ? 'done' : ''}`}
          href={mapLink({ latitude: s.latitude!, longitude: s.longitude!, at: s.at ?? 0, accuracy: null })}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icons.Map size={18} /> {t.showOnMap}
        </a>
      )}
      {place && !arrived && !!s.at && <span class="muted small">{t.spotFrom(formatTime(s.at))}</span>}
      {arrived && <span class="muted small">{t.arrivedDone}</span>}
      {ask &&
        (answer && !m.outgoing ? (
          <span class="muted small">{t.spotAnsweredOwn(formatTime(answer.ts))}</span>
        ) : answer && direct ? (
          <span class="muted small">{t.spotAnsweredBy(personName(answer.fromPerson, answer.fromName), formatTime(answer.ts))}</span>
        ) : (
          <>
            {(!m.outgoing || direct) && <div class="spot-empty">{t.spotNoPlaceYet}</div>}
            {!m.outgoing && <span class="muted small">{t.spotAnswerHint}</span>}
          </>
        ))}
    </div>
  )
}

/** The question to see each other and its answer as cards (ADR 0121 §28). */
function MutualCard({ m, who, all }: { m: Msg; who: string; all: Msg[] }) {
  const t = texts.place
  const s = m.spot!
  const { kind: convKind, id } = parseKey(m.conv)
  const other = convKind === 'direct' ? personName(id) : who
  const exact = s.level === wireOf('exact')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  // Reading the state keeps „Weiter zeigen“ current.
  void sharingState.value
  if (s.kind === SPOT.SHARED) {
    const agreed = (s.level ?? 0) > 0
    if (!answersQuestion(m, all)) {
      const kept = !m.outgoing && convKind === 'direct' && newestShared(m, all) ? sharing.kept(id) : null
      return (
        <div class="spot-card">
          <div class="spot-title">
            <Icons.Map size={20} />
            <strong>{m.outgoing ? t.mutualLoweredOwn(other, agreed) : t.mutualLoweredBy(who, agreed)}</strong>
          </div>
          <span class="muted small">{m.outgoing ? t.mutualLoweredOwnText(other) : t.mutualLoweredText(who, agreed)}</span>
          {kept && (
            <Button kind="quiet" onClick={() => sharing.keepShowing(id)}>
              {t.mutualKeep(levelName(kept))}
            </Button>
          )}
        </div>
      )
    }
    return (
      <div class={`spot-card ${agreed ? 'arrived' : ''}`}>
        <div class="spot-title">
          {agreed ? <span class="spot-tick" aria-hidden="true">✓</span> : <Icons.Close size={20} />}
          <strong>
            {agreed
              ? m.outgoing
                ? t.mutualAgreedOwn(exact)
                : t.mutualAgreedBy(who, exact)
              : m.outgoing
                ? t.mutualRefusedOwn
                : t.mutualRefusedBy(who)}
          </strong>
        </div>
        <span class="muted small">{!agreed && !m.outgoing ? t.mutualRefusedBack : t.mutualChange}</span>
      </div>
    )
  }
  const answered = mutualAnswered(m, all)
  const answer = async (level: Level | null) => {
    setBusy(true)
    const ok = await answerMutualPlace(id, level)
    setBusy(false)
    setFailed(!ok)
  }
  return (
    <div class="spot-card">
      <div class="spot-title">
        <Icons.Map size={20} />
        <strong>{m.outgoing ? t.mutualAskOwn(other, exact) : t.mutualAskBy(who, exact)}</strong>
      </div>
      {!answered && m.outgoing && <span class="muted small">{t.mutualOwnHint}</span>}
      {!answered && !m.outgoing && convKind === 'direct' && (
        <>
          <span class="muted small">{t.mutualAlready(who, exact)}</span>
          <div class="spot-actions">
            <Button kind="secondary" disabled={busy} onClick={() => void answer(exact ? 'exact' : 'area')}>
              {t.mutualYes(exact)}
            </Button>
            {exact && (
              <Button kind="quiet" disabled={busy} onClick={() => void answer('area')}>
                {t.mutualOnlyArea}
              </Button>
            )}
            <Button kind="quiet" disabled={busy} onClick={() => void answer(null)}>
              {t.mutualNo}
            </Button>
          </div>
          {failed && <span class="field-error">{t.sendFailed}</span>}
        </>
      )}
    </div>
  )
}

// --- SOS-Kontakte (ADR 0121 §25) ---------------------------------------------------------------------------------

/** A person asks to have us as SOS contact: yes, no or later, on every page (as SosAskDialog in the app). */
export function SosAskDialog() {
  const ask = currentAsk(sosAsks.value, askedLater.value)
  const [busy, setBusy] = useState(false)
  if (!ask) return null
  const t = texts.sos
  const name = personName(ask.person)
  const answer = async (agree: boolean) => {
    setBusy(true)
    await answerSos(ask.person, agree)
    setBusy(false)
  }
  return (
    <Dialog key={ask.person} title={t.askTitle(name)} onClose={() => askLater(ask.person)}>
      <div class="dialog-body">
        <p>{t.askText(name)}</p>
        <div class="dialog-actions">
          <Button kind="quiet" disabled={busy} onClick={() => askLater(ask.person)}>
            {t.askLater}
          </Button>
          <Button kind="quiet" disabled={busy} onClick={() => void answer(false)}>
            {t.askNo}
          </Button>
          <Button kind="primary" disabled={busy} onClick={() => void answer(true)}>
            {t.askYes}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/** Open questions and the persons one is SOS contact for, with „zurücknehmen“; nothing if both are empty. */
export function SosContactsSection() {
  const t = texts.sos
  const asks = sosAsks.value
  const agreed = sosAgreed.value
  if (!asks.length && !agreed.length) return null
  return (
    <>
      {asks.length > 0 && (
        <Section id="sos" title={t.openAsks}>
          {asks.map((a) => (
            <Row key={a.person} icon={<Icons.Person />} title={t.askTitle(personName(a.person))} right={<Icons.Forward size={18} />} onClick={() => askNow(a.person)} />
          ))}
        </Section>
      )}
      {agreed.length > 0 && (
        <Section id={asks.length ? undefined : 'sos'} title={t.contactFor} footer={t.contactsFooter}>
          {agreed.map((p) => (
            <Row key={p} icon={<Icons.Person />} title={personName(p)} text={t.withdraw} onClick={() => void answerSos(p, false)} />
          ))}
        </Section>
      )}
    </>
  )
}

/** Is [personId] someone the own place can be shared with each other in a chat? */
export function canShareWith(personId: string): boolean {
  return personId !== me.value?.personId && people.value.has(personId)
}
