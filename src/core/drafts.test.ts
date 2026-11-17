import { describe, expect, it } from 'vitest'
import { addToDraft, incomingDrafts, takeIncoming } from './drafts'

describe('forwarding into a draft', () => {
  it('collects text and files per conversation until the input takes them', () => {
    const before = incomingDrafts.value
    addToDraft('c:kreis', ' Hallo ', ['a'])
    addToDraft('c:kreis', 'zweite', ['b'])
    addToDraft('d:person', '', [])
    expect(incomingDrafts.value).toBe(before + 3)
    expect(takeIncoming<string>('c:kreis')).toEqual({ text: 'Hallo\nzweite', files: ['a', 'b'] })
    expect(takeIncoming('c:kreis')).toBeNull()
    expect(takeIncoming('d:person')).toEqual({ text: '', files: [] })
  })
})
