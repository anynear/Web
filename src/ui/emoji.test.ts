import { describe, expect, it } from 'vitest'
// As MAX_TEXT_CHARS in core/session (not imported here: it needs the browser).
const MAX_TEXT_CHARS = 4096
import { charsLeftHint, textLeft } from '../core/messages'
import { RECENT_MAX, addRecent, fold, insertEmoji, parseRecent, searchEmojis, toEmojis } from './emoji'
import de from 'virtual:emoji-data/de'
import en from 'virtual:emoji-data/en'

describe('emoji data', () => {
  it('is bundled per language, without skin tone components and in Unicode order', () => {
    for (const rows of [de, en]) {
      expect(rows.length).toBeGreaterThan(1500)
      expect(rows.some(([, group]) => group === 2)).toBe(false)
      expect(rows[0][0]).toBe('😀')
    }
    expect(de.find(([e]) => e === '👋')?.[2]).toBe('winkende Hand')
    expect(en.find(([e]) => e === '👋')?.[2]).toBe('waving hand')
  })
})

describe('emoji search', () => {
  const all = toEmojis(de)
  it('finds by name and search word, without accents and case', () => {
    expect(searchEmojis(all, 'Herz').map((e) => e.emoji)).toContain('❤️')
    expect(searchEmojis(all, 'tschuss').map((e) => e.emoji)).toContain('👋')
    expect(searchEmojis(all, '  ')).toEqual([])
  })
  it('puts names starting with the query first', () => {
    const hits = searchEmojis(all, 'daumen')
    expect(fold(hits[0].label).startsWith('daumen')).toBe(true)
  })
  it('needs every word', () => {
    expect(searchEmojis(all, 'katze lachend').every((e) => e.search.includes('katze') && e.search.includes('lachend'))).toBe(true)
  })
})

describe('recently used emoji', () => {
  it('keeps the newest first, once each, at most RECENT_MAX', () => {
    let list: string[] = []
    for (let i = 0; i < RECENT_MAX + 5; i++) list = addRecent(list, String.fromCodePoint(0x1f600 + i))
    list = addRecent(list, '😃')
    expect(list[0]).toBe('😃')
    expect(list.length).toBe(RECENT_MAX)
    expect(list.filter((e) => e === '😃').length).toBe(1)
  })
  it('ignores anything unreadable', () => {
    expect(parseRecent(null)).toEqual([])
    expect(parseRecent('kaputt')).toEqual([])
    expect(parseRecent('{"a":1}')).toEqual([])
    expect(parseRecent('["😀", 3, ""]')).toEqual(['😀'])
  })
})

describe('inserting an emoji', () => {
  it('goes in at the cursor and the cursor stays behind it', () => {
    expect(insertEmoji('Hallo Welt', 5, 5, '👋', MAX_TEXT_CHARS)).toEqual({ text: 'Hallo👋 Welt', caret: 7 })
  })
  it('replaces a selection', () => {
    expect(insertEmoji('ich mag dich', 4, 7, '❤️', MAX_TEXT_CHARS)).toEqual({ text: 'ich ❤️ dich', caret: 6 })
  })
  it('counts code points like the counter, and goes in whole or not at all', () => {
    const family = '👨‍👩‍👧' // 5 code points
    const text = 'a'.repeat(MAX_TEXT_CHARS - 6)
    const done = insertEmoji(text, text.length, text.length, family, MAX_TEXT_CHARS)!
    expect(textLeft(done.text, MAX_TEXT_CHARS)).toBe(1)
    expect(charsLeftHint(textLeft(done.text, MAX_TEXT_CHARS), 100, { charsLeft: (n) => `Noch ${n} Zeichen`, charsTooMany: (n) => `${n} zu viel` })).toBe('Noch 1 Zeichen')
    expect(insertEmoji(done.text, 0, 0, family, MAX_TEXT_CHARS)).toBeNull()
    expect(insertEmoji(done.text, 0, 0, '😀', MAX_TEXT_CHARS)?.text.startsWith('😀')).toBe(true)
  })
  it('keeps the cursor inside the text', () => {
    expect(insertEmoji('ab', 9, 9, '😀', MAX_TEXT_CHARS)).toEqual({ text: 'ab😀', caret: 4 })
  })
})
