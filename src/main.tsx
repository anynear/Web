import { render } from 'preact'
import { registerSW } from 'virtual:pwa-register'
import { boot } from './core/session'
import { App } from './ui/App'
import { CrashBoundary } from './ui/CrashBoundary'
import './style.css'

document.documentElement.lang = navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en'
// Never inside a frame of another page: it could lay itself over the buttons (clickjacking, e.g. „Passwörter öffnen“).
// The hosting sets no frame-ancestors header and a <meta> CSP cannot carry it, so the app checks itself.
if (inFrame()) {
  document.getElementById('app')?.replaceChildren()
} else {
  // Crash = error while rendering; the error boundary records it (ADR 0082).
  render(<CrashBoundary><App /></CrashBoundary>, document.getElementById('app')!)
  registerSW({ immediate: true })
  boot().catch((e) => console.error('Start', e))
}

function inFrame(): boolean {
  try {
    return window.top !== window.self
  } catch {
    return true
  }
}
