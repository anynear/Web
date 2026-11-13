// Builds the ANMP core as a JS library (Kotlin/JS, ES modules, ADR 0036) and puts it into vendor/anmp-core.
// As with the app, ANMP lives in a sibling folder: ../ANMP/kotlin from the main checkout, ../../ANMP/kotlin from a
// worktree under _worktrees/, otherwise ANMP_DIR=<ANMP/kotlin>.
// The Gradle build looks for ANDP next to ANMP by itself, otherwise ANDP_DIR=<ANDP/kotlin>.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const candidates = [process.env.ANMP_DIR, '../ANMP/kotlin', '../../ANMP/kotlin'].filter(Boolean)
const anmp = candidates.map((p) => resolve(root, p)).find((p) => existsSync(join(p, 'settings.gradle.kts')))
if (!anmp) {
  console.error(`ANMP nicht gefunden (gesucht: ${candidates.join(', ')}). ANMP_DIR setzen.`)
  process.exit(1)
}

console.log(`ANMP-Kern aus ${anmp}`)
execFileSync(join(anmp, 'gradlew'), ['-q', ':core:jsBrowserProductionLibraryDistribution'], { cwd: anmp, stdio: 'inherit' })

const out = join(anmp, 'core/build/dist/js/productionLibrary')
const target = join(root, 'vendor/anmp-core')
rmSync(target, { recursive: true, force: true })
cpSync(out, target, { recursive: true, filter: (f) => !f.endsWith('.map') })

// Kotlin writes a package.json for Node; for Vite, entry point and types count as an ES module.
const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
writeFileSync(join(target, 'package.json'), JSON.stringify({
  name: 'anmp-core',
  version: pkg.version,
  type: 'module',
  main: 'anmp-core.mjs',
  module: 'anmp-core.mjs',
  types: 'anmp-core.d.mts',
}, null, 2) + '\n')

let rev = ''
try { rev = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: anmp }).toString().trim() } catch {}
writeFileSync(join(target, 'SOURCE'), `ANMP ${rev}\n`)
console.log(`fertig: vendor/anmp-core (ANMP ${rev})`)
