// Guided steps after pairing (ADR 0073 §9), without UI, so that they can be tested.

export type GuideStep = 'notifications' | 'alerts'

/**
 * Whether the step "notifications" has something to do: the browser can show notifications, they are not blocked and
 * the web app has not switched them on yet. A permission the browser already gave is not enough, the web app also has
 * to switch them on (and subscribe to Web Push), otherwise nothing arrives while it is closed.
 */
export function notificationsOpen(supported: boolean, permission: string, switchedOn: boolean): boolean {
  return supported && permission !== 'denied' && !switchedOn
}

/**
 * Offer the guided steps once to a browser that was paired before they existed or skipped a step it now has to do:
 * only when paired, not offered before and something is open.
 */
export function offerGuide(paired: boolean, offeredBefore: boolean, somethingOpen: boolean): boolean {
  return paired && !offeredBefore && somethingOpen
}

/** What has something to do in this browser; what is done and what the browser cannot do is dropped. */
export function planGuide(notificationsAsk: boolean, officialAvailable: boolean, officialOn: boolean): GuideStep[] {
  const steps: GuideStep[] = []
  if (notificationsAsk) steps.push('notifications')
  if (officialAvailable && !officialOn) steps.push('alerts')
  return steps
}
