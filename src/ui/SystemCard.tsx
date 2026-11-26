import type { ComponentChildren } from 'preact'

/**
 * The one look of everything the app itself puts into a chat (system cards, like `SystemCard` of the app): changes in
 * the circle, steps about SOS contacts, places and sharing them, introduced contacts. In the middle, the same frame for
 * both sides, an icon with one title line, below it what the card has to say and at the end the time. A system card
 * has no menu, no reactions and cannot be deleted: it records what happened, not something someone typed.
 */
export function SystemCard({
  icon,
  title,
  good = false,
  meta,
  children,
}: {
  icon: ComponentChildren
  title: ComponentChildren
  /** Something good happened (accepted, arrived): icon and title in green. */
  good?: boolean
  /** Time and, for an own card, its state; at the end, right-aligned. */
  meta?: ComponentChildren
  children?: ComponentChildren
}) {
  return (
    <div class={`spot-card ${good ? 'arrived' : ''}`}>
      <div class="spot-title">
        {icon}
        <strong>{title}</strong>
      </div>
      {children}
      {meta && <div class="spot-meta">{meta}</div>}
    </div>
  )
}

/** The tick of a system card about something good, in place of the icon. */
export function GoodTick() {
  return (
    <span class="spot-tick" aria-hidden="true">
      ✓
    </span>
  )
}
