// Guided steps after pairing (ADR 0073 §9), without UI, so that they can be tested.

export type GuideStep = 'notifications' | 'alerts'

/** What has something to do in this browser; what is done and what the browser cannot do is dropped. */
export function planGuide(notificationsAsk: boolean, officialAvailable: boolean, officialOn: boolean): GuideStep[] {
  const steps: GuideStep[] = []
  if (notificationsAsk) steps.push('notifications')
  if (officialAvailable && !officialOn) steps.push('alerts')
  return steps
}
