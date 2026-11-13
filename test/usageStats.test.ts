import { describe, expect, it } from 'vitest'
import { detectTestMode } from '../src/core/usageStats'

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  }
}

const live = { dev: false, host: 'web.anynear.app', search: '' }

describe('usage stats test mode', () => {
  it('is off on the live site', () => {
    expect(detectTestMode(live, memoryStorage())).toBe(false)
  })

  it('is on in vite dev and on localhost', () => {
    expect(detectTestMode({ ...live, dev: true }, memoryStorage())).toBe(true)
    expect(detectTestMode({ ...live, host: 'localhost' }, memoryStorage())).toBe(true)
    expect(detectTestMode({ ...live, host: '127.0.0.1' }, memoryStorage())).toBe(true)
  })

  it('stays on after ?test=1 until ?test=0', () => {
    const store = memoryStorage()
    expect(detectTestMode({ ...live, search: '?test=1' }, store)).toBe(true)
    expect(detectTestMode(live, store)).toBe(true)
    expect(detectTestMode({ ...live, search: '?x=2&test=0' }, store)).toBe(false)
    expect(detectTestMode(live, store)).toBe(false)
  })

  it('survives resetting the web app', () => {
    const store = memoryStorage()
    detectTestMode({ ...live, search: '?test=1' }, store)
    store.removeItem('app:web:usageStatsLast')
    expect(detectTestMode(live, store)).toBe(true)
  })
})
