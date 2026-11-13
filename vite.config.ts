import { defineConfig } from 'vitest/config'
import preact from '@preact/preset-vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Version as with the app: for a tag `vX.Y.Z` (new version) its number, otherwise build `X.Y.Z-<hash>` with the
// newest tag `vX.Y.Z` at this state and the short commit hash (main, pull requests, local). Without tags in the checkout
// the version from package.json applies.
const fallback = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
const git = (cmd: string) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
const release = /^v(\d+\.\d+\.\d+)$/
let rev = 'dev'
try {
  rev = git('git rev-parse --short=7 HEAD')
} catch {}
// In GitHub Actions the trigger decides (push to main = build, tag = version), locally a tag exactly on HEAD.
let tag = process.env.GITHUB_REF_TYPE === 'tag' ? (process.env.GITHUB_REF_NAME ?? '') : ''
if (!process.env.GITHUB_REF_TYPE) {
  try {
    tag = git("git describe --tags --exact-match --match 'v*.*.*' --exclude 'v*-*' HEAD")
  } catch {}
}
let base = fallback
try {
  const tags = git("git tag --merged HEAD --list 'v*'").split('\n').map((t) => release.exec(t)?.[1]).filter((t) => t !== undefined)
  const newest = tags.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
  if (newest) base = newest
} catch {}
const version = release.test(tag) ? tag.slice(1) : `${base}-${rev}`
// Build number as in the app (ADR 0096 §8): number of commits up to HEAD. Needs the full history (CI: fetch-depth 0);
// without git 0, then the core never shows an update notice.
let build = 0
try {
  build = Number(git('git rev-list --count HEAD')) || 0
} catch {}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version), __APP_BUILD__: JSON.stringify(build) },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'fonts/inter.woff2', 'brand/*.svg'],
      manifest: {
        // Own name on the home screen, so that it can be told apart from the app „anynear“.
        name: 'anynear Web',
        short_name: 'anynear Web',
        description: 'anynear im Browser: deine Kreise und Kontakte auf dem Computer.',
        lang: 'de',
        start_url: '/',
        display: 'standalone',
        background_color: '#082C35',
        theme_color: '#082C35',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The core is large (Kotlin/JS); the relays never go through the service worker.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Web Push (ADR 0060): notice without content and click on the notice.
        importScripts: ['push-sw.js'],
        // Area table for official warnings (about 100 kB): only loaded by those who need it, then from the cache.
        globIgnores: ['**/regionData-*.js'],
        runtimeCaching: [{ urlPattern: /\/assets\/regionData-[^/]+\.js$/, handler: 'CacheFirst', options: { cacheName: 'regions', expiration: { maxEntries: 2 } } }],
      },
    }),
  ],
  resolve: {
    // ktor loads `ws` only under Node; in the browser it stays empty.
    alias: { ws: fileURLToPath(new URL('./src/core/ws-stub.ts', import.meta.url)) },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 4096 },
  test: { environment: 'node' },
})
