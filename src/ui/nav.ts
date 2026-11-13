// What is visible on the right or on the phone and which dialog is open.
import { signal } from '@preact/signals'
import { isRadioPath } from '../core/radioSetup'

export type Section = 'messages' | 'people' | 'files' | 'alerts'
export type Pane = 'chat' | 'details' | 'settings' | 'support' | 'radio'
export type DialogKind = 'startCircle' | 'joinCircle' | 'addContact' | 'createChannel' | 'joinChannel' | 'ownContact' | null

/** Section of the sidebar: messages, people, storage (with passwords) or alerts, like the tabs of the app. */
export const section = signal<Section>('messages')
/** Under „Menschen“: contacts or circles, like the toggle of the app. */
export const peopleTab = signal<'contacts' | 'circles'>('contacts')
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
