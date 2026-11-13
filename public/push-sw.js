// Web Push for anynear (ADR 0060, ANDP §10.1): the relays send a wake-up without content. The service worker cannot
// decrypt and shows a neutral notice; the page fetches by itself when opened. If a page is visible,
// it shows nothing (the page reports new messages itself, with sender and text).
/* eslint-env serviceworker */

const TEXTS = {
  de: { title: 'anynear', body: 'Neue Nachricht' },
  en: { title: 'anynear', body: 'New message' },
}

function texts() {
  return (self.navigator.language || 'en').toLowerCase().startsWith('de') ? TEXTS.de : TEXTS.en
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (clients.some((c) => c.visibilityState === 'visible')) return
      const t = texts()
      await self.registration.showNotification(t.title, {
        body: t.body,
        tag: 'push',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = clients.find((c) => new URL(c.url).origin === self.location.origin)
      if (open) {
        await open.focus()
        open.postMessage({ type: 'open', conv: event.notification.data?.conv ?? null, channel: event.notification.data?.channel ?? null })
      } else await self.clients.openWindow('/')
    })(),
  )
})
