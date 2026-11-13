import { describe, expect, it } from 'vitest'
import { MAX_AGE_MILLIS, MAX_BYTES, MAX_REPORTS, addReport, clip, type CrashReport, reportText, scrub } from './crashes'

function report(at: number, error = 'TypeError: kaputt', trace = '    at render (index-abc.js:1:2)'): CrashReport {
  return { kind: 'Crash', atMillis: at, build: '0.3.0-abc1234', platform: 'web', os: 'Firefox auf Mac', model: null, error, trace, log: [], count: 1, lastMillis: at }
}

describe('Absturzberichte (ADR 0082)', () => {
  it('nimmt Schlüssel aus Links und lange Folgen heraus', () => {
    expect(scrub('https://anynear.app/k#Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA und 0123456789abcdef0123456789abcdef')).toBe('https://anynear.app/k#… und …')
  })

  it('lässt Aufrufketten und UUIDs stehen', () => {
    const t = '    at render (https://web.anynear.app/assets/index-B1x2.js:10:5)\n3F2504E0-4F89-11D3-9A0C-0305E82C3301'
    expect(scrub(t)).toBe(t)
  })

  it('fasst gleiche zusammen und hält höchstens fünf', () => {
    let list = addReport([], report(1000), 1000)
    list = addReport(list, report(2000, 'TypeError: anders'), 2000)
    expect(list).toHaveLength(1)
    expect(list[0].count).toBe(2)
    for (let i = 0; i < 7; i++) list = addReport(list, report(3000 + i, 'TypeError: x', `    at f${i} (a.js:1:1)`), 3000 + i)
    expect(list).toHaveLength(MAX_REPORTS)
    const later = 3006 + MAX_AGE_MILLIS + 1
    expect(addReport(list, report(later, 'Error: neu'), later)).toHaveLength(1)
  })

  it('bleibt unter der Größe', () => {
    const big = { ...report(0), log: Array.from({ length: 500 }, (_, i) => `-${i}s ` + 'x'.repeat(300)) }
    expect(new TextEncoder().encode(reportText(clip(big))).length).toBeLessThanOrEqual(MAX_BYTES)
  })

  it('schreibt denselben Text wie die App', () => {
    const lines = reportText({ ...report(0), count: 3, lastMillis: 86_400_000 }).split('\n')
    expect(lines.slice(0, 6)).toEqual([
      'kind: Crash',
      'first: 1970-01-01T00:00:00Z',
      'last: 1970-01-02T00:00:00Z (3x)',
      'build: 0.3.0-abc1234',
      'platform: web Firefox auf Mac',
      'error: TypeError: kaputt',
    ])
  })
})
