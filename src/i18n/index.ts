// Language as in the app (ADR 0026): German for `de*`, otherwise English.
import { de, type Texts } from './de'
import { en } from './en'

export function pickTexts(languages: readonly string[]): Texts {
  return languages[0]?.toLowerCase().startsWith('de') ? de : en
}

export const texts: Texts = pickTexts(typeof navigator === 'undefined' ? ['de'] : navigator.languages ?? [navigator.language])

export type { Texts }
