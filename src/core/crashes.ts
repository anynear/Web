// Crash report (ADR 0082), like `CrashReports`/`CrashRecorder` in the app: record errors in the browser, scrubbed,
// merged, send nothing. Sending happens only after „Senden“ via support (ADR 0065).
import { signal } from '@preact/signals'

export type CrashKind = 'Crash' | 'Native' | 'NotResponding'

export interface CrashReport {
  kind: CrashKind
  atMillis: number
  build: string | null
  platform: string
  os: string | null
  model: string | null
  error: string
  trace: string
  log: string[]
  count: number
  lastMillis: number
}

export const MAX_REPORTS = 5
export const MAX_BYTES = 64 * 1024
export const MAX_AGE_MILLIS = 14 * 24 * 60 * 60 * 1000
const TOP_FRAMES = 5
const STORAGE_KEY = 'crashReports'
/** The first version counted every `error` event (also extensions, click handlers); these reports are discarded. */
const OLD_STORAGE_KEY = 'crashes'

const fragment = /(https?:\/\/\S*?)#\S*/g
const hexToken = /\b[0-9a-fA-F]{20,}\b/g
const longToken = /[A-Za-z0-9+_=-]{20,}/g
const uuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/**
 * Like `CrashReports.scrub` of the app: everything after `#` in addresses (links carry keys there), long hex and
 * Base64 sequences. File names of the web app (`/assets/index-abc123.js`) stay readable as they have dots and paths.
 */
export function scrub(text: string): string {
  return text
    .replace(fragment, (_, base: string) => `${base}#…`)
    .replace(hexToken, '…')
    .replace(longToken, (m) => (!uuid.test(m) && /\d/.test(m) && /[A-Za-z]/.test(m) ? '…' : m))
}

/** Same crashes: same kind, same error type, same topmost calls. */
export function signature(r: CrashReport): string {
  const errorType = r.error.split(':')[0].trim()
  const frames = r.trace
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at ') || l.includes('@'))
    .slice(0, TOP_FRAMES)
  return [r.kind, errorType, ...frames].join('|')
}

/** Add a new report: drop those older than 14 days, merge equal ones, at most 5, newest last. */
export function addReport(reports: CrashReport[], next: CrashReport, now: number): CrashReport[] {
  const fresh = reports.filter((r) => now - r.lastMillis <= MAX_AGE_MILLIS)
  const sig = signature(next)
  const same = fresh.find((r) => signature(r) === sig)
  const merged = same
    ? clip({ ...same, count: same.count + next.count, lastMillis: Math.max(same.lastMillis, next.lastMillis), trace: next.trace, log: next.log, build: next.build ?? same.build })
    : clip(next)
  return [...fresh.filter((r) => r !== same), merged].sort((a, b) => a.lastMillis - b.lastMillis).slice(-MAX_REPORTS)
}

function bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

export function clip(r: CrashReport): CrashReport {
  let c = { ...r, log: r.log.slice(-200) }
  while (bytes(reportText(c)) > MAX_BYTES && c.log.length > 0) c = { ...c, log: c.log.slice(Math.max(1, Math.floor(c.log.length / 4))) }
  if (bytes(reportText(c)) > MAX_BYTES) c = { ...c, trace: c.trace.slice(0, MAX_BYTES / 2) + '\n…' }
  return c
}

/** The same text as `CrashReports.text` of the app. */
export function reportText(r: CrashReport): string {
  const lines = [`kind: ${r.kind}`, `first: ${iso(r.atMillis)}`]
  if (r.count > 1) lines.push(`last: ${iso(r.lastMillis)} (${r.count}x)`)
  lines.push(`build: ${r.build ?? '?'}`)
  lines.push(`platform: ${r.platform}${r.os ? ` ${r.os}` : ''}${r.model ? ` · ${r.model}` : ''}`)
  lines.push(`error: ${r.error}`)
  let text = lines.join('\n') + '\n'
  if (r.trace.trim()) text += `\n${r.trace.trimEnd()}\n`
  if (r.log.length) text += `\nlog (seconds before the crash):\n${r.log.join('\n')}\n`
  return text
}

export function reportsText(reports: CrashReport[]): string {
  return reports.map(reportText).join('\n----------------------------------------\n\n')
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// --- Storage in the browser -------------------------------------------------------------------------------------

function load(): CrashReport[] {
  try {
    localStorage.removeItem(OLD_STORAGE_KEY)
    const raw = localStorage.getItem(STORAGE_KEY)
    const list = raw ? (JSON.parse(raw) as CrashReport[]) : []
    const cutoff = Date.now() - MAX_AGE_MILLIS
    return Array.isArray(list) ? list.filter((r) => r && r.lastMillis >= cutoff) : []
  } catch {
    return []
  }
}

/** Open reports; empty after „Senden“ or „Nicht senden“. */
export const crashReports = signal<CrashReport[]>(load())

function save(list: CrashReport[]) {
  crashReports.value = list
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // Without storage the report only stays until reload.
  }
}

export function clearCrashReports() {
  save([])
}

/** Record a report for an error; never throws. */
export function recordCrash(error: unknown, build: string, os: string | null) {
  try {
    const e = error instanceof Error ? error : new Error(String(error))
    const now = Date.now()
    const report: CrashReport = {
      kind: 'Crash',
      atMillis: now,
      build,
      platform: 'web',
      os,
      model: null,
      error: scrub(`${e.name}: ${e.message}`),
      trace: scrub((e.stack ?? '').split('\n').filter((l) => !l.startsWith(`${e.name}:`)).join('\n')),
      log: [],
      count: 1,
      lastMillis: now,
    }
    save(addReport(crashReports.value, report, now))
  } catch {
    // Do nothing further in case of an error.
  }
}
