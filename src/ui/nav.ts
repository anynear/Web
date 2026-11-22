// What is visible on the right or on the phone and which dialog is open.
import { signal } from '@preact/signals'
import type { Msg } from '../core/messages'
import { isRadioPath } from '../core/radioSetup'

export type Section = 'messages' | 'circles' | 'files' | 'alerts'
export type Pane = 'chat' | 'details' | 'settings' | 'support' | 'radio' | 'whoSeesMe' | 'requests'
export type DialogKind = 'startCircle' | 'joinCircle' | 'addContact' | 'inviteContact' | 'createChannel' | 'joinChannel' | 'ownContact' | 'startLifeSign' | null

/** Section of the sidebar: messages, circles (ADR 0100), storage (with passwords) or alerts, like the tabs of the app. */
export const section = signal<Section>('messages')
/** „Neue Nachricht“ open above „Nachrichten“: choosing whom to write to (contacts and circles). */
export const newMessage = signal(false)
/** „Weiterleiten“: this message waits for „An wen?“ (the same choice as „Neue Nachricht“), `null` = nothing. */
export const forwarding = signal<Msg | null>(null)
/** In the storage: `mine`, `passwords` or a circle ID; `null` = nothing chosen. */
export const filesSel = signal<string | null>(null)
/** Search across all storages (ADR 0070 §7); not empty: the hits are on the right. */
export const filesQuery = signal('')
/** `radio`: „Funkgerät einrichten“ (ADR 0095), also opened directly at `/radio`, even without pairing. */
export const pane = signal<Pane>(typeof location !== 'undefined' && isRadioPath(location.pathname) ? 'radio' : 'chat')
/** In the alerts: the open channel; `null` = nothing chosen. */
export const alertSel = signal<string | null>(null)
export const dialog = signal<DialogKind>(null)
/** Link with which „Kreis beitreten“ or „Kontakt hinzufügen“ opens (from a card in the chat). */
export const dialogLink = signal('')
/** Search in the open conversation (also opened from the profile page). */
export const chatSearch = signal(false)
/** Open support form (settings → help): report a bug or question to us. */
export const supportKind = signal<'bug' | 'question'>('bug')
/** Section of the settings that the menu ⋮ jumps to (`profile`, `connections`, `devices`, `help`, `about`). */
export const settingsAnchor = signal<string | null>(null)
