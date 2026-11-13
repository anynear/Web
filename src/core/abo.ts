// Subscription preview (ADR 0076): plans with expected prices from the website, as in the app (AboPreview.kt).
// Prices are never in the code, so that they can change without a new version.
export const ABO_PREVIEW_URL = 'https://anynear.app/v1/abo.json'

/**
 * A plan. The web app only knows name, prices and whether it is recommended; what is included is a finished text in
 * `features` per language, so that the building blocks can change without a new version.
 */
export interface AboPlan {
  id: string
  name?: Record<string, string>
  monthlyCents: number
  yearlyCents: number
  features?: Record<string, string[]>
  recommended?: boolean
  /** What a message may carry in the plan (ADR 0076 §1a); missing in older previews. */
  limits?: AboLimits
}

/** Limits of a message: text in characters, attachment in MB, attachments per message. */
export interface AboLimits {
  textChars: number
  attachmentMb: number
  attachments: number
}

export type AboLimit = keyof AboLimits

const lang = (german: boolean) => (german ? 'de' : 'en')

/** Name in the language, otherwise English, otherwise the ID. */
export const planName = (p: AboPlan, german: boolean) => p.name?.[lang(german)] ?? p.name?.en ?? p.id.charAt(0).toUpperCase() + p.id.slice(1)

/** Building blocks in the language, otherwise English. */
export const planFeatures = (p: AboPlan, german: boolean) => p.features?.[lang(german)] ?? p.features?.en ?? []

/** One row of the comparison table: label and a short value per plan ID. */
export interface AboCompareRow {
  label: string
  values: Record<string, string>
}

/** The building blocks as a comparison table, plus what all plans include. */
export interface AboCompare {
  rows: AboCompareRow[]
  note?: string
}

export interface AboPreview {
  trialMonths: number
  interest: Record<string, string>
  plans: AboPlan[]
  /** Comparison table per language (`de`, `en`); missing in older previews. */
  compare?: Record<string, AboCompare>
}

/** Comparison table in the language, otherwise English; `null` if the website sends none (then features apply). */
export function planCompare(p: AboPreview, german: boolean): AboCompare | null {
  const c = p.compare?.[lang(german)] ?? p.compare?.en
  return c && Array.isArray(c.rows) && c.rows.length > 0 ? c : null
}

/** Value of a plan in a row; a dash if the website names none. */
export const compareValue = (row: AboCompareRow, plan: AboPlan) => row.values?.[plan.id] ?? '–'

/** `null` if the text is not a usable plan directory. */
export function parseAbo(text: string): AboPreview | null {
  try {
    const d = JSON.parse(text)
    if (!d || !Array.isArray(d.plans) || d.plans.length === 0) return null
    return { trialMonths: Number(d.trialMonths) || 0, interest: d.interest ?? {}, plans: d.plans as AboPlan[], compare: d.compare ?? undefined }
  } catch {
    return null
  }
}

export const paidPlans = (p: AboPreview) => p.plans.filter((x) => x.monthlyCents > 0)
/** Saving of the yearly price over twelve monthly payments in percent, rounded; 0 without benefit. As in app and website. */
export const yearlySaving = (p: AboPlan) =>
  p.monthlyCents > 0 ? Math.max(0, Math.round(((p.monthlyCents * 12 - p.yearlyCents) * 100) / (p.monthlyCents * 12))) : 0
/** Yearly price converted to the month, rounded to cents. */
export const yearlyPerMonth = (p: AboPlan) => Math.round(p.yearlyCents / 12)
export const freePlan = (p: AboPreview) => p.plans.find((x) => x.monthlyCents === 0)

/**
 * The cheapest plan that allows more for [limit] than applies today (default: free), with its value; `null` if
 * none allows more or the preview names no limits. Like `upgradeFor` in the app.
 */
export function upgradeFor(p: AboPreview, limit: AboLimit, current = freePlan(p)?.limits?.[limit] ?? 0): { plan: AboPlan; value: number } | null {
  for (const plan of [...paidPlans(p)].sort((a, b) => a.monthlyCents - b.monthlyCents)) {
    const v = plan.limits?.[limit]
    if (v !== undefined && v > current) return { plan, value: v }
  }
  return null
}

let cached: AboPreview | null = null
/** Like [loadAbo], but loaded successfully only once (for hints in the chat). */
export async function loadAboOnce(): Promise<AboPreview | null> {
  if (!cached) cached = await loadAbo()
  return cached
}

/** Page „Interesse bekunden“ with preselected plan and billing period; `null` if the website names none. */
export function interestUrl(p: AboPreview, plan: AboPlan, yearly: boolean, german: boolean): string | null {
  const base = p.interest[german ? 'de' : 'en'] ?? p.interest.en
  if (!base || !base.startsWith('https://')) return null
  return `${base}?paket=${encodeURIComponent(plan.id)}&takt=${yearly ? 'jahr' : 'monat'}`
}

/** `null` without internet or on an unusable response. */
export async function loadAbo(): Promise<AboPreview | null> {
  try {
    const r = await fetch(ABO_PREVIEW_URL, { credentials: 'omit' })
    return r.ok ? parseAbo(await r.text()) : null
  } catch {
    return null
  }
}
