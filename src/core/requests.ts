// Contact requests and introductions (ADR 0116): what the overview and the card show, without the core.
import { texts } from '../i18n'
import { directKey, type ConvKey, type IntroCard } from './messages'

/** State of an introduction card: own one, already a contact, request sent, no longer valid, or to add. */
export type IntroState = 'own' | 'known' | 'pending' | 'expired' | 'open'

export function introState(intro: IntroCard, own: boolean, known: boolean, pending: boolean, now: number): IntroState {
  if (own) return 'own'
  if (known) return 'known'
  if (pending) return 'pending'
  if (intro.until < now) return 'expired'
  return 'open'
}

/** Status line under the card, as in the app; `undefined` for an own card or one still to add. */
export function introStatus(state: IntroState): string | undefined {
  switch (state) {
    case 'known':
      return texts.people.alreadyContact
    case 'pending':
      return texts.people.requestPending
    case 'expired':
      return texts.people.introExpired
    default:
      return undefined
  }
}

/** Conversations without those of persons still asking: what they wrote waits for the answer. */
export function withoutAsking(convs: ConvKey[], askingPersons: string[]): ConvKey[] {
  const asking = new Set(askingPersons.map(directKey))
  return convs.filter((c) => !asking.has(c))
}

/** „Vorgestellt von Anna“ or „Über deinen Kontaktlink“. */
export function requestOriginText(introducedByName: string | null | undefined): string {
  return introducedByName ? texts.people.introducedBy(introducedByName) : texts.people.viaYourContactLink
}
