// Header of every main page and menu ⋮ as in the app (`AppHeader`, `MainMenu`, ADR 0062 §1): title on the left, the
// menu on the right, same place everywhere; no icons (as in the app). The browser has no radio, so „Funkgerät“ is missing;
// instead „Funkgerät einrichten“ puts Meshtastic on a radio over USB (ADR 0095).
// Above the fixed entries each area puts its own, rarely needed actions (ADR 0101), under a small heading with the
// title of the area and set apart by a thick line, as in the app (`MenuAction`, `AppHeader(menu = …)`).
import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { texts } from '../i18n'
import { open } from '../core/session'
import * as Icons from './icons'
import { dialog, filesSel, pane, section, settingsAnchor, supportKind } from './nav'
import { ownRunning } from './LifeSigns'

export function MainHeader({ title }: { title: string }) {
  return (
    <header class="app-head">
      <h1>{title}</h1>
      <MainMenu title={title} />
    </header>
  )
}

/** Opens the settings, on request at a section. */
function openSettings(anchor: string | null) {
  open(null)
  filesSel.value = null
  section.value = 'messages'
  pane.value = 'settings'
  settingsAnchor.value = anchor
}

/** One entry in the context part of the menu (ADR 0101). */
type MenuAction = { label: string; icon: ComponentChildren; action: () => void }

/** Rarely needed actions of the open area (ADR 0101); empty where the area has none. */
function contextActions(): MenuAction[] {
  switch (section.value) {
    case 'alerts':
      return [
        ...(ownRunning() ? [] : [{ label: texts.lifeSigns.start, icon: <Icons.Clock size={20} />, action: () => (dialog.value = 'startLifeSign') }]),
        { label: texts.alerts.createChannel, icon: <Icons.Plus size={20} />, action: () => (dialog.value = 'createChannel') },
        { label: texts.alerts.joinChannel, icon: <Icons.Link size={20} />, action: () => (dialog.value = 'joinChannel') },
      ]
    case 'circles':
      // Invitations mostly arrive as a link that opens anynear by itself (ADR 0101).
      return [{ label: texts.people.acceptInvite, icon: <Icons.Link size={20} />, action: () => (dialog.value = 'joinCircle') }]
    default:
      return []
  }
}

function MainMenu({ title }: { title: string }) {
  const shown = useSignal(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!shown.value) return
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) shown.value = false
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') shown.value = false
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [shown.value])
  const item = (label: string, icon: ComponentChildren, action: () => void) => (
    <button
      type="button"
      role="menuitem"
      class="menu-item"
      onClick={() => {
        shown.value = false
        action()
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
  const context = contextActions()
  return (
    <div class="menu-box" ref={box}>
      <button
        type="button"
        class="icon-btn"
        aria-label={texts.nav.more}
        aria-haspopup="menu"
        aria-expanded={shown.value}
        onClick={() => (shown.value = !shown.value)}
      >
        <Icons.More />
      </button>
      {shown.value && (
        <div class="menu" role="menu">
          {context.length > 0 && (
            <>
              <div class="menu-heading" role="presentation">
                {title}
              </div>
              {context.map((c) => item(c.label, c.icon, c.action))}
              <hr class="menu-split" />
            </>
          )}
          {item(texts.nav.profile, <Icons.Person size={20} />, () => openSettings('profile'))}
          <hr />
          {item(texts.nav.internet, <Icons.Globe size={20} />, () => openSettings('connections'))}
          <hr />
          {item(texts.settings.devices, <Icons.Device size={20} />, () => openSettings('devices'))}
          {item(texts.radioSetup.menu, <Icons.Radio size={20} />, () => {
            openSettings(null)
            pane.value = 'radio'
          })}
          <hr />
          {item(texts.nav.settings, <Icons.Settings size={20} />, () => openSettings(null))}
          {item(texts.settings.reportProblem, <Icons.Wrench size={20} />, () => {
            openSettings(null)
            supportKind.value = 'bug'
            pane.value = 'support'
          })}
          {item(texts.settings.help, <Icons.Help size={20} />, () => openSettings('help'))}
          {item(texts.settings.about, <Icons.Circle size={20} />, () => openSettings('about'))}
        </div>
      )}
    </div>
  )
}
