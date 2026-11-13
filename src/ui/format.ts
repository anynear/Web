// Date and time by language, in one place (like ui/TimeFormat.kt in the app).
import { texts } from '../i18n'

const time = new Intl.DateTimeFormat(texts.dateLocale, { hour: '2-digit', minute: '2-digit' })
const day = new Intl.DateTimeFormat(texts.dateLocale, { weekday: 'long', day: 'numeric', month: 'long' })
const longDate = new Intl.DateTimeFormat(texts.dateLocale, { day: 'numeric', month: 'long' })
const short = new Intl.DateTimeFormat(texts.dateLocale, { day: '2-digit', month: '2-digit', year: '2-digit' })

export const formatTime = (ts: number) => time.format(ts)

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Heading above the messages of a day. */
export function formatDay(ts: number, now = Date.now()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000)
  if (diff === 0) return texts.chat.today
  if (diff === 1) return texts.chat.yesterday
  return day.format(ts)
}

/** Time in the overview: today the time of day, yesterday „Gestern“, otherwise the date. */
export function formatListTime(ts: number, now = Date.now()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000)
  if (diff === 0) return formatTime(ts)
  if (diff === 1) return texts.chat.yesterday
  return short.format(ts)
}

/** Time of an alert or „gültig bis“: today only the time of day, otherwise date and time. */
export function formatDateTime(ts: number, now = Date.now()): string {
  return isSameDay(ts, now) ? formatTime(ts) : `${short.format(ts)} ${formatTime(ts)}`
}

/** Day with month written out, e.g. „20. November“ (ADR 0096 hint with date). */
export const formatLongDate = (ts: number) => longDate.format(ts)

/** Date without time, e.g. when an address was created. */
export const formatShortDate = (ts: number) => short.format(ts)

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b)
}

/** Web addresses in the text clickable, otherwise plain text (no HTML evaluation). */
export function splitLinks(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = []
  const re = /\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/gi
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) })
    out.push({ text: m[0], href: m[0] })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** „1 GB“, „1,5 GB“ for quotas; below that in whole MB („250 MB“, ADR 0076). */
export function formatStorageSize(bytes: number): string {
  const gb = 1024 * 1024 * 1024
  if (bytes < gb) return `${Math.round(bytes / 1024 / 1024)} MB`
  return texts.files.gigabytes(Math.round((bytes * 10) / gb))
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', texts.dateLocale.startsWith('de') ? ',' : '.')} MB`
}
