// Invitation links in message text, as in the app (chats/InviteCards.kt): channel (`/a#`), contact (`/c#`), circle (`/k#`)
// and code of a new own device (`/p#`, ADR 0042 §5).
// The card replaces the link; whatever else is in the text stays visible. The stored text does not change.

export type InviteKind = 'channel' | 'contact' | 'circle' | 'device'

export interface InviteLink {
  start: number
  end: number
  url: string
  kind: InviteKind
}

/** Web addresses like `splitLinks` in `ui/format.ts`. */
const LINK = /\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/gi
/** Our links, also those with broken content; whether they are any good only the core says (`previewLink`). */
const INVITE = /^https:\/\/anynear\.(?:app|net)\/([ackp])\/?#/i
const KINDS: Record<string, InviteKind> = { a: 'channel', c: 'contact', k: 'circle', p: 'device' }

/** Invitation links in [text], in the order in which they appear. Other web addresses stay normal links. */
export function findInviteLinks(text: string): InviteLink[] {
  const out: InviteLink[] = []
  for (const m of text.matchAll(LINK)) {
    const kind = INVITE.exec(m[0])?.[1]?.toLowerCase()
    if (kind) out.push({ start: m.index!, end: m.index! + m[0].length, url: m[0], kind: KINDS[kind] })
  }
  return out
}

/**
 * The sentences that „Teilen“ of the app puts in front of an invitation link (both languages, any names). If only such
 * a sentence stands next to the link, the card says the same and the sentence is dropped.
 */
const SHARE_SENTENCES: RegExp[] = [
  /^.+ lädt dich zum Kanal „.+“ bei anynear ein$/,
  /^.+ invites you to the channel “.+” on anynear$/,
  /^Komm in meinen Kreis „.+“ bei anynear$/,
  /^Join my circle “.+” on anynear$/,
  /^Komm wieder in den Kreis „.+“ bei anynear$/,
  /^Come back to the circle “.+” on anynear$/,
  /^.+ bei anynear\. Tippe auf den Link, um mich als Kontakt hinzuzufügen$/,
  /^.+ on anynear\. Tap the link to add me as a contact$/,
]

/** What stays visible of [text] without the invitation links; empty if the message consists only of links. */
export function withoutInviteLinks(text: string, links: InviteLink[] = findInviteLinks(text)): string {
  if (links.length === 0) return text
  let rest = ''
  let last = 0
  for (const l of [...links].sort((a, b) => a.start - b.start)) {
    rest += text.slice(last, l.start)
    last = l.end
  }
  rest += text.slice(last)
  const cleaned = rest
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    // „Komm in meinen Kreis bei anynear: <Link>“ would otherwise end with a colon leading nowhere.
    .replace(/[:\s\-–]+$/, '')
  return SHARE_SENTENCES.some((r) => r.test(cleaned)) ? '' : cleaned
}

/** Circle invitation to confirm before joining („Dem Kreis … beitreten?“), as in the app; `null` if broken, another kind or already a member. */
export function circleToJoin(p: { kind: string; name: string; joined: boolean; inviter?: string } | null): { name: string; inviter: string } | null {
  return p && p.kind === 'circle' && !p.joined ? { name: p.name, inviter: (p.inviter ?? '').trim() } : null
}
