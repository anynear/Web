import { describe, expect, it } from 'vitest'
import { freePlan, interestUrl, paidPlans, parseAbo, planFeatures, planName, upgradeFor } from '../src/core/abo'

// Example values as the website delivers them under /v1/abo.json (like AboPreviewTest in the app).
const sample = JSON.stringify({
  version: 1,
  trialMonths: 3,
  interest: { de: 'https://example.org/de/abo/', en: 'https://example.org/en/abo/' },
  plans: [
    { id: 'free', monthlyCents: 0, yearlyCents: 0, storageGb: 1, people: 1 },
    { id: 'plus', name: { de: 'Plus', en: 'Plus' }, monthlyCents: 500, yearlyCents: 5000, recommended: true, features: { de: ['100 GB Speicher', 'Neu: etwas anderes'], en: ['100 GB storage', 'New: something else'] } },
    { id: 'family', monthlyCents: 900, yearlyCents: 9000, features: { en: ['Only English'] } },
  ],
})

describe('Abo-Vorschau', () => {
  it('liest Pakete und baut den Link zum Interesse bekunden', () => {
    const p = parseAbo(sample)!
    expect(p.trialMonths).toBe(3)
    expect(freePlan(p)?.id).toBe('free')
    expect(paidPlans(p).map((x) => x.id)).toEqual(['plus', 'family'])
    expect(interestUrl(p, paidPlans(p)[0], true, true)).toBe('https://example.org/de/abo/?paket=plus&takt=jahr')
    expect(interestUrl(p, paidPlans(p)[1], false, false)).toBe('https://example.org/en/abo/?paket=family&takt=monat')
  })
  it('zeigt Name und Bausteine so, wie sie kommen', () => {
    const [plus, family] = paidPlans(parseAbo(sample)!)
    expect(planFeatures(plus, true)).toEqual(['100 GB Speicher', 'Neu: etwas anderes'])
    expect(planFeatures(plus, false)).toEqual(['100 GB storage', 'New: something else'])
    expect(planName(family, true)).toBe('Family')
    expect(planFeatures(family, true)).toEqual(['Only English'])
  })
  it('lehnt Unbrauchbares ab', () => {
    expect(parseAbo('<html>')).toBeNull()
    expect(parseAbo('{"plans":[]}')).toBeNull()
    const p = parseAbo(sample.replace('https://example.org/de/abo/', 'http://example.org/de/abo/'))!
    expect(interestUrl(p, paidPlans(p)[0], true, true)).toBeNull()
  })
})

describe('upgradeFor (ADR 0076 §1a)', () => {
  const p = parseAbo(
    JSON.stringify({
      plans: [
        { id: 'free', monthlyCents: 0, yearlyCents: 0, limits: { textChars: 1000, attachmentMb: 10, attachments: 5 } },
        { id: 'family', monthlyCents: 999, yearlyCents: 8990, limits: { textChars: 5000, attachmentMb: 50, attachments: 10 } },
        { id: 'plus', monthlyCents: 599, yearlyCents: 5390, limits: { textChars: 10000, attachmentMb: 100, attachments: 20 } },
        { id: 'single', monthlyCents: 299, yearlyCents: 2690, limits: { textChars: 5000, attachmentMb: 50, attachments: 10 } },
      ],
    }),
  )!
  it('nennt das günstigste Paket, das mehr erlaubt', () => {
    expect(upgradeFor(p, 'textChars')).toMatchObject({ plan: { id: 'single' }, value: 5000 })
    expect(upgradeFor(p, 'attachments', 10)).toMatchObject({ plan: { id: 'plus' }, value: 20 })
    expect(upgradeFor(p, 'textChars', 10000)).toBeNull()
  })
  it('ohne Limits in der Vorschau kein Hinweis', () => {
    expect(upgradeFor(parseAbo(JSON.stringify({ plans: [{ id: 'free', monthlyCents: 0, yearlyCents: 0 }] }))!, 'textChars')).toBeNull()
  })
})
