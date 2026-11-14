// Web Push for anynear (ADR 0060, ANDP §10.1): the relays send a wake-up without content. The service worker cannot
// decrypt and shows a neutral notice; the page fetches by itself when opened. If a page is visible, the page reports
// new messages itself (with sender and text), so the notice is closed right away. It is still shown first: Safari and
// web apps on iPhone, iPad and Mac revoke the push subscription after a few pushes without a notification, and then
// the relays can no longer wake the closed app (ANDP §10.1, watch "gone").
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
      const visible = clients.some((c) => c.visibilityState === 'visible')
      const t = texts()
      await self.registration.showNotification(t.title, {
        body: t.body,
        tag: 'push',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        silent: visible,
      })
      if (!visible) return
      const shown = await self.registration.getNotifications({ tag: 'push' })
      shown.forEach((n) => n.close())
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
