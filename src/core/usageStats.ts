// Usage statistics (ADR 0045): once a day a report from this browser, as long as the person has not switched it
// off (setting `usage_stats` of the person, ADR 0050). The core counts, signs and sends; it is sent after
// a random waiting time of at most one minute, as long as the page is open. A missed day is not made up for.
// In test mode nothing goes out at all, not even a toggle report, so that tests do not distort the numbers.
// The daily report starts only on the second UTC day the stats run in this browser (ADR 0045 §1b), so that fresh
// test and review installs do not each count as a new person.
import { signal } from '@preact/signals'
import type { AnmpCoreWeb } from 'anmp-core'
import { OFFICIAL_ALERTS_LINK } from './alerts'
import { local } from './storage'

const SETTING = 'usage_stats'
const LAST = 'usageStatsLast'
const FIRST_DAY = 'usageStatsFirstDay'
const MAX_DELAY_MS = 60 * 1000
const CHECK_MS = 60 * 60 * 1000
export const NINA = 'nina'

export interface UsageReport {
  day: string
  devices: number
  circles: number
  channels: number
  nina: boolean
  version: string
}

function loadLast(): UsageReport | null {
  try {
    return JSON.parse(local.get(LAST) ?? 'null') as UsageReport | null
  } catch {
    return null
  }
}

const TEST_KEY = 'anynear-test'

/**
 * Test mode: `vite dev`, localhost or once `?test=1` in the address (stays in the browser, `?test=0` ends it).
 * Lives outside of `app:`, so that it survives resetting the web app.
 */
export function detectTestMode(env: { dev: boolean; host: string; search: string }, store?: Storage): boolean {
  const param = new URLSearchParams(env.search).get('test')
  try {
    if (param === '1') store?.setItem(TEST_KEY, '1')
    if (param === '0') store?.removeItem(TEST_KEY)
  } catch {}
  if (env.dev || env.host === 'localhost' || env.host === '127.0.0.1' || env.host === '[::1]') return true
  try {
    return store?.getItem(TEST_KEY) === '1'
  } catch {
    return false
  }
}

/** Test mode: no usage report is sent. */
export const usageStatsTestMode = signal(
  typeof location === 'undefined'
    ? false
    : detectTestMode(
        { dev: import.meta.env.DEV, host: location.hostname, search: location.search },
        typeof localStorage === 'undefined' ? undefined : localStorage,
      ),
)

/** On or off, as the person last set it. */
export const usageStatsOn = signal(true)
/** What was sent last; `null` as long as nothing was sent. */
export const usageStatsLast = signal<UsageReport | null>(loadLast())

let core: AnmpCoreWeb | null = null
let pending: ReturnType<typeof setTimeout> | null = null

/** UTC day YYYY-MM-DD as in the core. */
export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)

/** X.Y.Z from the version of the web app (`0.1.0.<rev>`). */
export const versionOf = (raw: string) => /^(\d{1,4}\.\d{1,4}\.\d{1,4})(?:\D.*)?$/.exec(raw)?.[1] ?? 'other'

async function readSetting(c: AnmpCoreWeb) {
  usageStatsOn.value = (await c.setting(SETTING)) !== 'false'
}

/**
 * `true` on the first UTC day the stats run in this browser (ADR 0045 §1b): then no daily report goes out. The first
 * day is noted on the first call; a browser that already reported before this rule counts from the day of its
 * [last] report, so it misses no day.
 */
export function isFirstDay(
  store: { get(key: string): string | null; set(key: string, value: string | null): void },
  last: UsageReport | null,
  day: string,
): boolean {
  let first = store.get(FIRST_DAY)
  if (!first) {
    first = last?.day ?? day
    store.set(FIRST_DAY, first)
  }
  return day <= first
}

/** After pairing: read the setting, then check at start and hourly. */
export function startUsageStats(c: AnmpCoreWeb) {
  core = c
  void checkUsageStats()
  setInterval(() => void checkUsageStats(), CHECK_MS)
}

/** At start, hourly and when the page becomes visible again. */
export async function checkUsageStats() {
  const c = core
  if (!c || usageStatsTestMode.value) return
  await sendSwitch(c)
  if (pending) return
  await readSetting(c)
  if (!usageStatsOn.value || usageStatsLast.value?.day === today()) return
  if (isFirstDay(local, usageStatsLast.value, today())) return
  pending = setTimeout(() => {
    pending = null
    void send(c)
  }, Math.random() * MAX_DELAY_MS)
}

async function send(c: AnmpCoreWeb) {
  if (usageStatsTestMode.value) return
  await readSetting(c)
  const day = today()
  if (!usageStatsOn.value || usageStatsLast.value?.day === day) return
  if (isFirstDay(local, usageStatsLast.value, day)) return
  const ok = await c.sendStats(__APP_VERSION__, OFFICIAL_ALERTS_LINK, OFFICIAL_ALERTS_LINK ? NINA : '').catch(() => false)
  if (!ok) return
  const channels = c.channels()
  const report: UsageReport = {
    day,
    devices: Math.max(1, c.ownDevices().length),
    circles: c.circles().filter((x) => !x.removed).length,
    channels: channels.filter((x) => !x.curated).length,
    nina: channels.some((x) => x.curated),
    version: versionOf(__APP_VERSION__),
  }
  local.set(LAST, JSON.stringify(report))
  usageStatsLast.value = report
}

const SWITCH = 'usageStatsSwitch'

/** Send a queued toggle report; stays queued until a relay has accepted it. */
async function sendSwitch(c: AnmpCoreWeb) {
  if (usageStatsTestMode.value) return
  const pending = local.get(SWITCH)
  if (pending !== 'true' && pending !== 'false') return
  if (await c.sendStatsSwitch(pending === 'true').catch(() => false)) {
    if (local.get(SWITCH) === pending) local.set(SWITCH, null)
  }
}

/** Switch in the settings; applies to the person on all devices. Toggling is reported once. */
export async function setUsageStats(on: boolean) {
  if (usageStatsOn.value === on) return
  usageStatsOn.value = on
  local.set(SWITCH, on ? 'true' : 'false')
  await core?.setSetting(SETTING, on ? 'true' : 'false')
  if (core) await sendSwitch(core)
  if (on) void checkUsageStats()
}
