// Emoji picker below the input (web only, loaded only when it opens): recently used, categories and search, with the
// keyboard (Tab between search, categories and emoji; arrow keys in the emoji; Enter picks; Escape closes) and on the phone.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { texts } from '../i18n'
import { local } from '../core/storage'
import * as Icons from './icons'
import { type Emoji, GROUPS, addRecent, parseRecent, searchEmojis, toEmojis } from './emoji'

const RECENT_KEY = 'emoji-recent'

let data: Promise<Emoji[]> | null = null
function loadEmojis(): Promise<Emoji[]> {
  data ??= (texts.dateLocale.startsWith('de') ? import('virtual:emoji-data/de') : import('virtual:emoji-data/en')).then((m) => toEmojis(m.default))
  data.catch(() => (data = null))
  return data
}

function readRecent(): string[] {
  try {
    return parseRecent(local.get(RECENT_KEY))
  } catch {
    return []
  }
}

function saveRecent(list: string[]) {
  try {
    local.set(RECENT_KEY, JSON.stringify(list))
  } catch {}
}

type Section = { id: string; title: string; items: Emoji[] }

/** Nearest emoji button in the row above or below [from] (rows may be shorter at the end of a category). */
function verticalNeighbour(buttons: HTMLElement[], from: HTMLElement, down: boolean): HTMLElement | null {
  const r = from.getBoundingClientRect()
  const rows = buttons.map((b) => ({ b, r: b.getBoundingClientRect() })).filter((x) => (down ? x.r.top > r.top + 2 : x.r.top < r.top - 2))
  if (!rows.length) return null
  const top = down ? Math.min(...rows.map((x) => x.r.top)) : Math.max(...rows.map((x) => x.r.top))
  const row = rows.filter((x) => Math.abs(x.r.top - top) < 2)
  row.sort((a, b) => Math.abs(a.r.left - r.left) - Math.abs(b.r.left - r.left))
  return row[0].b
}

export default function EmojiPicker({ onPick, onClose, focusSearch }: { onPick: (emoji: string) => boolean; onClose: (toButton: boolean) => void; focusSearch: boolean }) {
  const t = texts.emoji
  const [all, setAll] = useState<Emoji[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string>('')
  const recent = useMemo(readRecent, [])
  const root = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    loadEmojis().then((e) => live && setAll(e), () => live && setFailed(true))
    // On a computer straight into the search; on the phone that would open the keyboard over the emoji.
    if (focusSearch) search.current?.focus()
    return () => {
      live = false
    }
  }, [])

  // A click or tap outside closes the picker (the button that opened it toggles it itself).
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const target = e.target as Node
      if (root.current?.contains(target) || (target as Element).closest?.('.emoji-btn')) return
      onClose(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [onClose])

  const byEmoji = useMemo(() => new Map((all ?? []).map((e) => [e.emoji, e])), [all])
  const results = useMemo(() => (all && query.trim() ? searchEmojis(all, query) : null), [all, query])
  const sections: Section[] = useMemo(() => {
    if (!all) return []
    if (results) return [{ id: 'emoji-results', title: t.found(results.length), items: results }]
    const list: Section[] = []
    const recentItems = recent.map((e) => byEmoji.get(e) ?? { emoji: e, group: -1, label: e, search: '' })
    if (recentItems.length) list.push({ id: 'emoji-recent', title: t.recent, items: recentItems })
    for (const g of GROUPS) list.push({ id: `emoji-${g.key}`, title: t.groups[g.key], items: all.filter((e) => e.group === g.group) })
    return list
  }, [all, results, recent, byEmoji])

  // Roving focus: exactly one emoji is reachable with Tab, the arrow keys move between them.
  useEffect(() => {
    const buttons = [...(grid.current?.querySelectorAll<HTMLElement>('.emoji-cell') ?? [])]
    buttons.forEach((b, i) => (b.tabIndex = i === 0 ? 0 : -1))
    if (grid.current) grid.current.scrollTop = 0
    setActive(sections[0]?.id ?? '')
  }, [sections])

  function moveTo(next: HTMLElement | null | undefined, from?: HTMLElement) {
    if (!next) return
    if (from) from.tabIndex = -1
    else grid.current?.querySelectorAll<HTMLElement>('.emoji-cell[tabindex="0"]').forEach((b) => (b.tabIndex = -1))
    next.tabIndex = 0
    next.focus()
  }

  function pick(e: string) {
    // Only what really went into the text counts as used (not one that no longer fit).
    if (onPick(e)) saveRecent(addRecent(readRecent(), e))
  }

  function onGridKey(e: KeyboardEvent) {
    const from = e.target as HTMLElement
    if (!from.classList.contains('emoji-cell')) return
    const buttons = [...grid.current!.querySelectorAll<HTMLElement>('.emoji-cell')]
    const i = buttons.indexOf(from)
    let next: HTMLElement | null | undefined
    if (e.key === 'ArrowRight') next = buttons[i + 1]
    else if (e.key === 'ArrowLeft') next = buttons[i - 1]
    else if (e.key === 'ArrowDown') next = verticalNeighbour(buttons, from, true)
    else if (e.key === 'ArrowUp') {
      next = verticalNeighbour(buttons, from, false)
      if (!next) {
        e.preventDefault()
        search.current?.focus()
        return
      }
    } else if (e.key === 'Home') next = buttons[0]
    else if (e.key === 'End') next = buttons[buttons.length - 1]
    else return
    e.preventDefault()
    moveTo(next, from)
  }

  // Highlight the category that is at the top of the list while scrolling.
  function onScroll() {
    const g = grid.current
    if (!g || results) return
    const top = g.getBoundingClientRect().top + 8
    let current = sections[0]?.id ?? ''
    for (const s of sections) {
      const el = g.querySelector<HTMLElement>(`#${s.id}`)
      if (el && el.getBoundingClientRect().top <= top) current = s.id
    }
    if (current !== active) setActive(current)
  }

  function jump(id: string) {
    const g = grid.current
    const el = g?.querySelector<HTMLElement>(`#${id}`)
    if (!g || !el) return
    g.scrollTop = el.offsetTop - g.offsetTop
    setActive(id)
    moveTo(el.parentElement?.querySelector<HTMLElement>('.emoji-cell'))
  }

  return (
    <div
      ref={root}
      class="emoji-picker"
      role="dialog"
      aria-label={t.title}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          // Only the picker closes, not the answer bar behind it.
          e.preventDefault()
          e.stopPropagation()
          onClose(true)
        }
      }}
    >
      <div class="emoji-search">
        <Icons.Search size={18} />
        <input
          ref={search}
          type="search"
          class="input"
          placeholder={t.search}
          aria-label={t.search}
          value={query}
          enterKeyHint="done"
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Enter picks the first hit, as in other pickers; never sends the message.
              e.preventDefault()
              if (results?.[0]) pick(results[0].emoji)
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              moveTo(grid.current?.querySelector<HTMLElement>('.emoji-cell'))
            }
          }}
        />
      </div>
      {!results && all && (
        <div
          class="emoji-tabs"
          role="toolbar"
          aria-label={t.categories}
          onKeyDown={(e) => {
            // One stop for Tab, the arrow keys move between the categories.
            const tabs = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.emoji-tab')]
            const i = tabs.indexOf(e.target as HTMLElement)
            const next = e.key === 'ArrowRight' ? tabs[i + 1] : e.key === 'ArrowLeft' ? tabs[i - 1] : e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : null
            if (i < 0 || !next) return
            e.preventDefault()
            next.focus()
          }}
        >
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              class={`emoji-tab ${active === s.id ? 'active' : ''}`}
              aria-label={s.title}
              aria-current={active === s.id ? 'true' : undefined}
              tabIndex={active === s.id ? 0 : -1}
              title={s.title}
              onClick={() => jump(s.id)}
            >
              {s.id === 'emoji-recent' ? <Icons.Clock size={18} /> : <span aria-hidden="true">{GROUPS.find((g) => `emoji-${g.key}` === s.id)?.icon}</span>}
            </button>
          ))}
        </div>
      )}
      <div ref={grid} class="emoji-grid" onKeyDown={onGridKey} onScroll={onScroll}>
        {!all && <p class="emoji-note">{failed ? t.failed : t.loading}</p>}
        {results && !results.length && <p class="emoji-note">{t.none}</p>}
        {sections.map((s) =>
          s.items.length ? (
            <section key={s.id} aria-labelledby={s.id}>
              <h3 id={s.id} class="emoji-heading">{s.title}</h3>
              <div class="emoji-cells" role="group" aria-labelledby={s.id}>
                {s.items.map((e) => (
                  <button
                    key={e.emoji}
                    type="button"
                    class="emoji-cell"
                    tabIndex={-1}
                    aria-label={e.label}
                    title={e.label}
                    // Keep the input's selection where it is while clicking.
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => pick(e.emoji)}
                  >
                    {e.emoji}
                  </button>
                ))}
              </div>
            </section>
          ) : null,
        )}
      </div>
      <p class="visually-hidden" role="status" aria-live="polite">
        {results ? (results.length ? t.found(results.length) : t.none) : ''}
      </p>
    </div>
  )
}
