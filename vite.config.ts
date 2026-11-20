import { defineConfig } from 'vitest/config'
import preact from '@preact/preset-vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Version as with the app (scripts/version.sh, Semantic Versioning): for a tag `vX.Y.Z` its number, otherwise the
// pre-release `X.Y.Z-pre.<build>` of the open version, the highest release-notes/X.Y.Z.md without a tag `vX.Y.Z`
// (main, pull requests, local). Without an open version the newest version with the commit as build metadata (`X.Y.Z+<hash>`); the
// deployment never publishes that, it stops in scripts/version.sh. APP_VERSION from the workflow wins.
const fallback = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
const git = (cmd: string) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
const release = /^v?(\d+\.\d+\.\d+)$/
const newestFirst = (list: string[]) => list.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
let rev = 'dev'
try {
  rev = git('git rev-parse --short=7 HEAD')
} catch {}
// Build number as in the app (ADR 0096 §8): number of commits up to HEAD. Needs the full history (CI: fetch-depth 0);
// without git 0, then the core never shows an update notice.
let build = 0
try {
  build = Number(git('git rev-list --count HEAD')) || 0
} catch {}
// In GitHub Actions the trigger decides (main = pre-release, tag = version), locally a tag exactly on HEAD.
let tag = process.env.GITHUB_REF_TYPE === 'tag' ? (process.env.GITHUB_REF_NAME ?? '') : ''
if (!process.env.GITHUB_REF_TYPE) {
  try {
    tag = git("git describe --tags --exact-match --match 'v*.*.*' --exclude 'v*-*' HEAD")
  } catch {}
}
let tags: string[] = []
try {
  tags = git("git tag --list 'v*'").split('\n').map((t) => release.exec(t)?.[1]).filter((t) => t !== undefined)
} catch {}
const notes = readdirSync(new URL('./release-notes/', import.meta.url)).map((f) => release.exec(f.replace(/\.md$/, ''))?.[1]).filter((v) => v !== undefined)
const open = newestFirst(notes)[0]
let version: string
if (process.env.APP_VERSION) version = process.env.APP_VERSION
else if (release.test(tag)) version = tag.replace(/^v/, '')
else if (open && !tags.includes(open)) version = `${open}-pre.${build}`
else version = `${newestFirst(tags)[0] ?? fallback}+${rev}`

// Emoji picker in the input (web only): names, search words and categories from emojibase-data, bundled
// locally and slimmed down to what the picker shows. One chunk per language, loaded only when the picker opens.
// Up to Unicode emoji 15.0, which current systems can show; skin tones and components are left out.
const EMOJI_DATA = 'virtual:emoji-data/'
const EMOJI_MAX_VERSION = 15
function emojiData() {
  return {
    name: 'emoji-data',
    resolveId: (id: string) => (id.startsWith(EMOJI_DATA) ? `\0${id}` : null),
    load(id: string) {
      if (!id.startsWith(`\0${EMOJI_DATA}`)) return null
      const lang = id.slice(EMOJI_DATA.length + 1)
      if (lang !== 'de' && lang !== 'en') throw new Error(`no emoji data for ${lang}`)
      type Entry = { emoji: string; label: string; tags?: string[]; group?: number; order?: number; version: number }
      const all: Entry[] = JSON.parse(readFileSync(new URL(`./node_modules/emojibase-data/${lang}/data.json`, import.meta.url), 'utf8'))
      const rows = all
        .filter((e) => e.group !== undefined && e.group !== 2 && e.version <= EMOJI_MAX_VERSION)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((e) => [e.emoji, e.group, e.label, (e.tags ?? []).join(' ')])
      return `export default ${JSON.stringify(rows)}`
    },
  }
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version), __APP_BUILD__: JSON.stringify(build) },
  plugins: [
    emojiData(),
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
        // The same for the emoji names (about 40 kB per language): only once the picker is opened.
        globIgnores: ['**/regionData-*.js', '**/emoji-data-*.js'],
        runtimeCaching: [
          { urlPattern: /\/assets\/regionData-[^/]+\.js$/, handler: 'CacheFirst', options: { cacheName: 'regions', expiration: { maxEntries: 2 } } },
          { urlPattern: /\/assets\/emoji-data-[^/]+\.js$/, handler: 'CacheFirst', options: { cacheName: 'emoji', expiration: { maxEntries: 2 } } },
        ],
      },
    }),
  ],
  resolve: {
    // ktor loads `ws` only under Node; in the browser it stays empty.
    alias: { ws: fileURLToPath(new URL('./src/core/ws-stub.ts', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
    // A recognizable name for the emoji data, so that the service worker can leave it out of the precache.
    rollupOptions: { output: { chunkFileNames: (c) => (c.facadeModuleId?.startsWith(`\0${EMOJI_DATA}`) ? `assets/emoji-data-${c.facadeModuleId.slice(EMOJI_DATA.length + 1)}-[hash].js` : 'assets/[name]-[hash].js') } },
  },
  test: { environment: 'node' },
})
