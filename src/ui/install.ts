// „Als App installieren“ (PWA): the browser offers it via beforeinstallprompt (Chrome, Edge).
import { signal } from '@preact/signals'

interface InstallPrompt extends Event {
  prompt(): Promise<void>
}

export const installPrompt = signal<InstallPrompt | null>(null)

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    installPrompt.value = e as InstallPrompt
  })
  window.addEventListener('appinstalled', () => (installPrompt.value = null))
}
