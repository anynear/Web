import { describe, expect, it } from 'vitest'
import { isFirstDay, today, versionOf, type UsageReport } from './usageStats'

describe('Nutzungsstatistik (ADR 0045)', () => {
  it('nimmt X.Y.Z aus der Version der Webapp', () => {
    expect(versionOf('0.1.0.ab12cd')).toBe('0.1.0')
    expect(versionOf('0.4.2')).toBe('0.4.2')
    expect(versionOf('dev')).toBe('other')
  })

  it('rechnet den Tag in UTC wie der Kern', () => {
    expect(today(951_782_400_000)).toBe('2000-02-29')
    expect(today(951_782_399_000)).toBe('2000-02-28')
  })

  describe('erst ab dem zweiten Tag (§1b)', () => {
    const memory = () => {
      const map = new Map<string, string>()
      return {
        get: (k: string) => map.get(k) ?? null,
        set: (k: string, v: string | null) => (v === null ? map.delete(k) : map.set(k, v)),
      }
    }
    const report = (day: string): UsageReport => ({ day, devices: 1, circles: 0, channels: 0, nina: false, version: '0.8.0' })

    it('wartet bei einer frischen Installation bis zum nächsten Tag', () => {
      const s = memory()
      expect(isFirstDay(s, null, '2026-11-13')).toBe(true)
      expect(isFirstDay(s, null, '2026-11-13')).toBe(true)
      expect(isFirstDay(s, null, '2026-11-14')).toBe(false)
    })

    it('lässt keinen Tag aus, wenn schon vorher gemeldet wurde', () => {
      const s = memory()
      expect(isFirstDay(s, report('2026-11-12'), '2026-11-13')).toBe(false)
      expect(isFirstDay(s, null, '2026-11-14')).toBe(false)
    })
  })
})
