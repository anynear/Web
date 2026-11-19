import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Attachments are shown from blob URLs made in the page. Without `media-src blob:` the CSP falls back to
// `default-src 'self'` and blocks voice messages: Chrome then shows a greyed-out player with only „⋮“.
describe('CSP in index.html', () => {
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(readFileSync(new URL('../index.html', import.meta.url), 'utf8'))?.[1] ?? ''
  const directive = (name: string) => csp.split(';').map((d) => d.trim().split(/\s+/)).find(([n]) => n === name)?.slice(1) ?? []

  it('lets voice messages play from blob URLs, nothing else from outside', () => {
    expect(directive('media-src')).toEqual(["'self'", 'blob:'])
    expect(directive('default-src')).toEqual(["'self'"])
    expect(directive('script-src')).toEqual(["'self'"])
  })
})
