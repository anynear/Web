// Messages about places (ANMP `spot`, ADR 0121 §8, §26, §28): cards in the chat, not bubbles. What they say in the
// overview and in a notification is what the card says, not the stand-in text for older apps.
import { texts } from '../i18n'
import type { Msg } from './messages'

export const SPOT = {
  MEET: 1,
  ASK: 2,
  HERE: 3,
  ALL: 4,
  ARRIVED: 5,
  /** Asking to see each other's place, field 4 the level. */
  SHARE: 6,
  /** The answer to [SHARE], or that someone lowered what both agreed on; field 4 the level, 0 for no. */
  SHARED: 7,
} as const

/** The line for the overview and notifications, as `spotLineOf` in the app. */
export function spotLine(kind: number, label: string | undefined, outgoing: boolean): string {
  const t = texts.place
  switch (kind) {
    case SPOT.MEET:
      return label ? t.spotMeetText(label) : t.spotMeet
    case SPOT.ASK:
      return t.spotAsk
    case SPOT.ALL:
      return t.shareAll
    case SPOT.ARRIVED:
      return outgoing ? t.arrivedOwn : t.noticeArrived(label ?? null)
    case SPOT.SHARE:
      return t.mutualNotice
    case SPOT.SHARED:
      return t.mutualAnswerNotice
    default:
      return outgoing ? t.spotHereOwn : t.noticeHere
  }
}

/** [spotLine] of [m], `null` if it carries no place. */
export function spotLineOf(m: Pick<Msg, 'spot' | 'outgoing'>): string | null {
  return m.spot ? spotLine(m.spot.kind, m.spot.label, m.outgoing) : null
}

/** The answer to a „Wo bist du?“ [ask]: the first place the other side sent after it in the same conversation. */
export function answerTo(ask: Msg, all: Msg[]): Msg | undefined {
  return all.find((m) => m.conv === ask.conv && m.ts > ask.ts && m.outgoing !== ask.outgoing && m.spot?.kind === SPOT.HERE)
}

/** Was the question [ask] to see each other answered by the other side since? */
export function mutualAnswered(ask: Msg, all: Msg[]): boolean {
  return all.some((m) => m.conv === ask.conv && m.ts > ask.ts && m.outgoing !== ask.outgoing && m.spot?.kind === SPOT.SHARED)
}

/**
 * Does [answer] (kind [SPOT.SHARED]) answer a question of the other side? Otherwise it says that someone lowered later
 * what both agreed on.
 */
export function answersQuestion(answer: Msg, all: Msg[]): boolean {
  let before: Msg | undefined
  for (const m of all) {
    if (m.conv !== answer.conv || m.ts >= answer.ts) continue
    if (m.spot?.kind !== SPOT.SHARE && m.spot?.kind !== SPOT.SHARED) continue
    if (!before || m.ts >= before.ts) before = m
  }
  return !!before && before.spot?.kind === SPOT.SHARE && before.outgoing !== answer.outgoing
}

/** Is [m] the newest card of kind [SPOT.SHARED] in its conversation? „Weiter zeigen“ sits only on that one. */
export function newestShared(m: Msg, all: Msg[]): boolean {
  return !all.some((x) => x.conv === m.conv && x.spot?.kind === SPOT.SHARED && x.ts > m.ts)
}
