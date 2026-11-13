// Overview „Nachrichten“ as in the app: circles and direct conversations, newest on top, with number of new ones.
import { computed, useSignal } from '@preact/signals'
import type { ImageRef } from 'anmp-core'
import { texts } from '../i18n'
import { parseKey, type ConvKey } from '../core/messages'
import { unread as alertsUnread } from '../core/channels'
import { circles, listedConvs, open, openConv, people, personName, summaries } from '../core/session'
import { Avatar } from './Avatar'
import { formatListTime } from './format'
import * as Icons from './icons'
import { AlertsNav } from './Alerts'
import { FilesNav } from './Files'
import { PeopleNav } from './People'
import { MainHeader } from './MainMenu'
import { chatSearch, dialog, pane, section } from './nav'
import { CrashCard } from './CrashReport'

interface Entry {
  key: ConvKey
  name: string
  kind: 'circle' | 'person'
  image: ImageRef | null
  preview: string
  ts: number
  unread: number
}

const entries = computed<Entry[]>(() => {
  const sums = summaries.value
  const list = listedConvs.value.map((key) => {
    const { kind, id } = parseKey(key)
    if (kind === 'circle') {
      const c = circles.value.find((x) => x.id === id)
      return entry(key, c?.name ?? '', 'circle', c?.image ?? null)
    }
    return entry(key, personName(id), 'person', people.value.get(id)?.image ?? null)
  })
  return list.sort((a, b) => b.ts - a.ts || a.name.localeCompare(b.name))

  function entry(key: ConvKey, name: string, kind: 'circle' | 'person', image: Entry['image']): Entry {
    const s = sums.get(key)
    const last = s?.last
    let preview = ''
    if (last?.deleted) preview = texts.chat.deletedMessage
    else if (last) {
      const body = last.text || attachmentPreview(last.attachments)
      preview = last.system ? body : last.outgoing ? `${texts.list.you}: ${body}` : kind === 'circle' ? `${personName(last.fromPerson, last.fromName)}: ${body}` : body
    }
    if (!last) preview = texts.chat.noMessagesYet
    return { key, name, kind, image, preview, ts: last?.ts ?? 0, unread: s?.unread ?? 0 }
  }
})

export function ConversationList() {
  const query = useSignal('')
  const q = query.value.trim().toLowerCase()
  // As in the app: search in names and last message.
  const shown = q ? entries.value.filter((e) => e.name.toLowerCase().includes(q) || e.preview.toLowerCase().includes(q)) : entries.value
  const goFiles = () => {
    section.value = 'files'
    if (pane.value === 'settings' || pane.value === 'support') pane.value = 'chat'
  }
  const goAlerts = () => {
    section.value = 'alerts'
    if (pane.value === 'settings' || pane.value === 'support') pane.value = 'chat'
  }
  const goPeople = () => {
    section.value = 'people'
    if (pane.value === 'settings' || pane.value === 'support') pane.value = 'chat'
  }
  const title =
    section.value === 'files' ? texts.nav.files : section.value === 'alerts' ? texts.nav.alerts : section.value === 'people' ? texts.nav.people : texts.nav.messages
  return (
    <>
    <nav class="rail" aria-label={texts.appName}>
      <img class="rail-logo" src="/brand/anynear-emblem-on-dark.svg" alt="anynear" width="44" height="38" />
      <div class="rail-items" role="tablist">
        <button type="button" role="tab" aria-selected={section.value === 'messages'} class={`rail-item ${section.value === 'messages' ? 'active' : ''}`} onClick={() => { section.value = 'messages'; if (pane.value === 'settings' || pane.value === 'support') pane.value = 'chat' }}>
          <Icons.Chat /> <span>{texts.nav.messages}</span>
        </button>
        <button type="button" role="tab" aria-selected={section.value === 'people'} class={`rail-item ${section.value === 'people' ? 'active' : ''}`} onClick={goPeople}>
          <Icons.Person /> <span>{texts.nav.people}</span>
        </button>
        <button type="button" role="tab" aria-selected={section.value === 'files'} class={`rail-item ${section.value === 'files' ? 'active' : ''}`} onClick={goFiles}>
          <Icons.Folder /> <span>{texts.nav.files}</span>
        </button>
        <button type="button" role="tab" aria-selected={section.value === 'alerts'} class={`rail-item ${section.value === 'alerts' ? 'active' : ''}`} onClick={goAlerts}>
          <span class="rail-icon">
            <Icons.Bell />
            {alertsUnread.value > 0 && <span class="rail-badge">{alertsUnread.value > 99 ? '99+' : alertsUnread.value}</span>}
          </span>
          <span>{texts.nav.alerts}</span>
        </button>
      </div>
    </nav>
    <nav class="list" aria-label={title}>
      <MainHeader title={title} />
      {section.value === 'files' ? (
        <FilesNav />
      ) : section.value === 'people' ? (
        <PeopleNav />
      ) : section.value === 'alerts' ? (
        <AlertsNav />
      ) : (
        <>
          <CrashCard />
          <div class="list-tools">
            <input class="input search" type="search" placeholder={texts.list.search} value={query.value} onInput={(e) => (query.value = e.currentTarget.value)} />
            <div class="list-actions">
              <button type="button" class="list-action" onClick={() => (dialog.value = 'startCircle')}>
                <Icons.Plus size={18} /> {texts.list.startCircle}
              </button>
              <button type="button" class="list-action" onClick={() => (dialog.value = 'joinCircle')}>
                <Icons.Link size={18} /> {texts.list.joinCircle}
              </button>
              <button type="button" class="list-action" onClick={() => (dialog.value = 'addContact')}>
                <Icons.Person size={18} /> {texts.list.addContact}
              </button>
            </div>
          </div>
          {shown.length === 0 && q ? (
            <div class="empty">
              <p>{texts.people.noResults}</p>
            </div>
          ) : shown.length === 0 ? (
            <div class="empty">
              <h2>{texts.list.empty}</h2>
              <p>{texts.list.emptyText}</p>
            </div>
          ) : (
            <ul class="conversations">
              {shown.map((e) => (
                <li key={e.key}>
                  <button
                    type="button"
                    class={`conv ${openConv.value === e.key ? 'active' : ''}`}
                    aria-current={openConv.value === e.key ? 'true' : undefined}
                    onClick={() => {
                      pane.value = 'chat'
                      chatSearch.value = false
                      open(e.key)
                    }}
                  >
                    <Avatar id={parseKey(e.key).id} kind={e.kind} image={e.image} />
                    <span class="conv-body">
                      <span class="conv-top">
                        <span class="conv-name">{e.name}</span>
                        {e.ts > 0 && <span class={`conv-time ${e.unread ? 'fresh' : ''}`}>{formatListTime(e.ts)}</span>}
                      </span>
                      <span class="conv-bottom">
                        <span class="conv-preview">{e.preview}</span>
                        {e.unread > 0 && <span class="badge">{e.unread > 99 ? '99+' : e.unread}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </nav>
    </>
  )
}

/** Short form of the attachments for the overview, like `previewText` of the app („📷 Foto“, „🎤 Sprachnachricht“). */
function attachmentPreview(list: { type: string; name: string }[]): string {
  const a = list[0]
  if (!a) return ''
  if (a.type === 'jpg') return `📷 ${texts.attachment.photo}`
  if (a.type === 'm4a') return `🎤 ${texts.attachment.voice}`
  return `📎 ${a.name || (a.type === 'pdf' ? texts.attachment.pdf : texts.attachment.file)}`
}
