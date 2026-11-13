// Storage (ADR 0041) and circle storage (ADR 0049): list from the relays, upload, open, save, delete.
// Photos are downscaled as in the app and saved without metadata; other files stay as they are.
import { useSignal } from '@preact/signals'
import { DocIndex, DocItem, DocKind, FileOrder, FileTitles, type StoredFile } from 'anmp-core'
import { Fragment } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { texts } from '../i18n'
import { compareValue, freePlan, interestUrl, loadAbo, paidPlans, planCompare, planFeatures, planName, type AboCompare, type AboPlan, type AboPreview, yearlyPerMonth, yearlySaving } from '../core/abo'
import { LIMITS, mimeOf, prepareFile, rotateStoreImage, saveBytes } from '../core/media'
import { rememberNetStates } from '../core/netState'
import {
  BIN_DAYS,
  chooseStoredKind,
  circles,
  deleteStored,
  fetchStored,
  inBin,
  isSupportCircle,
  listStore,
  restoreStored,
  setStoredTitle,
  trashStored,
  putStored,
  refreshStorage,
  replaceStored,
  spaceState,
  storage,
  type StoreScope,
} from '../core/session'
import { Avatar } from './Avatar'
import { Button, Spinner } from './components'
import { formatShortDate, formatSize, formatStorageSize } from './format'
import * as Icons from './icons'
import { filesQuery, filesSel, section } from './nav'
import { openViewer } from './Viewer'
import { local } from '../core/storage'

/** Order of the storages (ADR 0091 §7), chosen in this browser for all storages. */
type FileSort = 'newest' | 'title' | 'name'
const SORT_KEY = 'files.sort'

function savedSort(): FileSort {
  const v = local.get(SORT_KEY)
  return v === 'title' || v === 'name' ? v : 'newest'
}

/** Title or file name A–Z with the order of the core (umlauts, numbers by value); equal ones newest first. */
export function sortFiles(files: StoredFile[], sort: FileSort): StoredFile[] {
  const newest = (a: StoredFile, b: StoredFile) => Number(b.added) - Number(a.added)
  if (sort === 'newest') return [...files].sort(newest)
  const key = (f: StoredFile) => (sort === 'title' ? FileTitles.getInstance().shown(f.title, f.name) : f.name)
  return [...files].sort((a, b) => FileOrder.getInstance().compare(key(a), key(b)) || newest(a, b))
}

/** Kinds that can be chosen by hand (ADR 0074): the important ones, photo and other. */
const choosable = [...DocKind.getInstance().choosable]

const dateFmt = new Intl.DateTimeFormat(texts.dateLocale, { day: 'numeric', month: 'long', year: 'numeric' })

/** Left list in the section „Ablage“. */
export function FilesNav() {
  const sel = filesSel.value
  // Support requests (ADR 0065) have no storage for users; support still sees it.
  const live = circles.value.filter((c) => !c.removed && !isSupportCircle(c.id))
  // Sum across all storages (ADR 0079): list them all once when the storages page opens.
  useEffect(() => {
    void refreshStorage()
  }, [])
  return (
    <div class="files-nav">
      <StorageMeter />
      <input
        type="search"
        class="store-search nav-search"
        placeholder={texts.files.searchAll}
        value={filesQuery.value}
        onInput={(e) => (filesQuery.value = e.currentTarget.value)}
      />
      <h2 class="section-title nav-title">{texts.files.personal}</h2>
      <button type="button" class={`conv ${sel === 'mine' ? 'active' : ''}`} onClick={() => (filesSel.value = 'mine')}>
        <span class="nav-icon">
          <Icons.Folder />
        </span>
        <span class="conv-body">
          <span class="conv-name">{texts.files.myFiles}</span>
          <span class="conv-preview">{texts.files.justForMe}</span>
        </span>
      </button>
      <button type="button" class={`conv ${sel === 'passwords' ? 'active' : ''}`} onClick={() => (filesSel.value = 'passwords')}>
        <span class="nav-icon">
          <Icons.Key />
        </span>
        <span class="conv-body">
          <span class="conv-name">{texts.passwords.title}</span>
          <span class="conv-preview">{texts.passwords.intro}</span>
        </span>
      </button>
      <h2 class="section-title nav-title">{texts.files.withYourCircles}</h2>
      {live.length === 0 && <p class="muted small nav-note">{texts.files.noCirclesYet}</p>}
      {live.map((c) => (
        <button key={c.id} type="button" class={`conv ${sel === c.id ? 'active' : ''}`} onClick={() => (filesSel.value = c.id)}>
          <Avatar id={c.id} kind="circle" size={40} image={c.image} />
          <span class="conv-body">
            <span class="conv-name">{c.name}</span>
            <span class="conv-preview">{texts.chat.members(c.members.length)}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

/** A storage as a page (right), with header. */
export function FilesPage({ scope }: { scope: StoreScope }) {
  if (scope === ABO) return <AboPreviewPage onBack={() => (filesSel.value = null)} />
  const circle = scope === 'mine' ? undefined : circles.value.find((c) => c.id === scope)
  const title = circle ? circle.name : texts.files.myFiles
  return (
    <section class="page">
      <header class="page-head">
        <button type="button" class="icon-btn back-btn" aria-label={texts.nav.back} onClick={() => (filesSel.value = null)}>
          <Icons.Back />
        </button>
        <h1>{title}</h1>
      </header>
      <div class="page-body">
        <StoreList scope={scope} intro={circle ? texts.files.circleIntro(circle.name) : texts.files.myFilesIntro} />
      </div>
    </section>
  )
}

/**
 * Hits of the search across all storages (ADR 0070 §7), grouped by place: first „Nur für mich“, then per circle. Every
 * entry stays in its storage; deleting asks with the text of that storage. Deliberately no mixed gallery.
 */
export function FilesSearchPage() {
  const live = circles.value.filter((c) => !c.removed && !isSupportCircle(c.id))
  const places: { scope: StoreScope; title: string }[] = [{ scope: 'mine', title: texts.files.justForMe }, ...live.map((c) => ({ scope: c.id, title: c.name }))]
  const lists = useSignal<Record<string, StoredFile[] | null>>({})
  const loading = useSignal(true)

  async function load() {
    loading.value = true
    const entries = await Promise.all(places.map(async (p) => [p.scope, await listStore(p.scope).catch(() => null)] as const))
    lists.value = Object.fromEntries(entries)
    loading.value = false
  }

  useEffect(() => {
    void load()
  }, [live.map((c) => c.id).join(',')])

  const query = filesQuery.value
  const groups = places
    .map((p) => {
      const list = lists.value[p.scope]?.filter((f) => !inBin(f))
      if (!list) return null
      const index = new DocIndex(list.map((f) => new DocItem(f.file, f.name, f.type, f.added, f.doc, '', f.title?.text ?? '')))
      const found = [...index.search(query, '')].map((id) => list.find((f) => f.file === id)!)
      return found.length ? { ...p, found } : null
    })
    .filter((g) => g !== null)

  return (
    <section class="page">
      <header class="page-head">
        <button type="button" class="icon-btn back-btn" aria-label={texts.nav.back} onClick={() => (filesQuery.value = '')}>
          <Icons.Back />
        </button>
        <h1>{texts.files.searchAll}</h1>
      </header>
      <div class="page-body">
        {loading.value ? (
          <p class="muted">
            <Spinner /> {texts.files.loading}
          </p>
        ) : groups.length === 0 ? (
          <p class="muted">{texts.files.nothingFound}</p>
        ) : (
          groups.map((g) => (
            <div key={g.scope} class="search-group">
              <h2 class="section-title">{g.title}</h2>
              <ul class="store-grid">
                {g.found.map((f) => (
                  <StoreItem key={f.file} scope={g.scope} f={f} onDeleted={() => void load()} onChanged={() => void load()} />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

/** Files of a storage; also embedded on the circle page. */
export function StoreList({ scope, compact = false, intro }: { scope: StoreScope; compact?: boolean; intro?: string }) {
  const files = useSignal<StoredFile[] | null | 'loading'>('loading')
  const uploading = useSignal(0)
  const problem = useSignal('')
  const dragging = useSignal(false)
  const query = useSignal('')
  const sort = useSignal<FileSort>(savedSort())
  const setSort = (v: FileSort) => {
    sort.value = v
    local.set(SORT_KEY, v === 'newest' ? null : v)
  }
  const kind = useSignal('')
  // Gallery (ADR 0070): photos and documents separated, topics instead of stacks.
  const photosView = useSignal(false)
  const topic = useSignal('')
  // Long lists shortened, the rest on click (as in the app); applies only to the search shown right now.
  const showAllFor = useSignal('')
  const picker = useRef<HTMLInputElement>(null)

  async function load() {
    files.value = 'loading'
    files.value = await listStore(scope).catch(() => null)
  }

  useEffect(() => {
    problem.value = ''
    query.value = ''
    kind.value = ''
    topic.value = ''
    photosView.value = false
    void load()
  }, [scope])

  async function upload(list: FileList | File[]) {
    problem.value = ''
    // Space across all storages full (ADR 0079): store nothing new; opening still works.
    if (storage.value && spaceState(storage.value) === 'full') {
      problem.value = texts.files.storageFull
      return
    }
    const all = [...list]
    uploading.value += all.length
    for (const f of all) {
      try {
        const p = await prepareFile(f, true)
        if (!p) {
          problem.value = texts.compose.photoUnreadable
          continue
        }
        if (p.bytes.length > LIMITS.storeBytes) {
          problem.value = texts.files.tooLarge
          continue
        }
        // Pictures keep their name, only with .jpg, because they are saved anew as JPEG (as in the app).
        const stem = f.name.replace(/\.[^.]+$/, '')
        const name = p.type === 'jpg' ? (stem ? `${stem}.jpg` : texts.files.photoName(dateFmt.format(f.lastModified || Date.now()))) : f.name
        if (!(await putStored(scope, p, name))) {
          const full = storage.value && spaceState(storage.value) === 'full'
          problem.value = full ? texts.files.storageFull : texts.files.notAccepted
        }
      } finally {
        uploading.value--
      }
    }
    await load()
  }

  const all = files.value
  // Bin (ADR 0086): not in the storage, but below it on its own.
  const list = Array.isArray(all) ? all.filter((f) => !inBin(f)) : all
  const bin = Array.isArray(all) ? all.filter(inBin).sort((a, b) => Number(b.trashed) - Number(a.trashed)) : []
  // Search and stacks instead of folders (ADR 0067). The browser reads no text; it searches in names and in what the
  // phones have recognised.
  const index = Array.isArray(list) ? new DocIndex(list.map((f) => new DocItem(f.file, f.name, f.type, f.added, f.doc, '', f.title?.text ?? ''))) : null
  const photos = Array.isArray(list) ? list.filter(isPhotoFile) : []
  const hasPhotos = photos.length > 0
  const hasDocs = Array.isArray(list) && photos.length < list.length
  // Only photos: the gallery right away; only documents: no gallery. On the circle page (compact) it stays a list.
  const gallery = !compact && hasPhotos && (photosView.value || !hasDocs)
  const kinds = index ? [...index.kinds()].filter((k) => k !== 'photo') : []
  const topics = index ? [...index.topics()] : []
  if (kind.value && !kinds.includes(kind.value)) kind.value = ''
  if (topic.value && !topics.includes(topic.value)) topic.value = ''
  const ids = index ? (gallery ? index.searchTopic(query.value, 'photo', topic.value) : index.search(query.value, kind.value)) : null
  const found = Array.isArray(list) && ids
    ? ids.map((id) => list.find((f) => f.file === id)!).filter((f) => compact || isPhotoFile(f) === gallery)
    : list
  // Order (ADR 0091 §7): only for the documents without a search; hits stay by relevance, the gallery by time.
  const sortable = !gallery && !query.value.trim()
  const shown = Array.isArray(found) && sortable ? sortFiles(found, sort.value) : found
  const listKey = [query.value, kind.value, topic.value, gallery].join('|')
  const limit = gallery ? PHOTO_LIMIT : FILE_LIMIT
  const showAll = showAllFor.value === listKey
  const visible = Array.isArray(shown) && !showAll ? shown.slice(0, limit) : shown
  return (
    <div
      class={`store ${dragging.value ? 'dragging' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files')) {
          e.preventDefault()
          dragging.value = true
        }
      }}
      onDragLeave={() => (dragging.value = false)}
      onDrop={(e) => {
        e.preventDefault()
        dragging.value = false
        if (e.dataTransfer?.files.length) void upload(e.dataTransfer.files)
      }}
    >
      {intro && <p class="muted">{intro}</p>}
      <div class="store-actions">
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const fl = e.currentTarget.files
            if (fl?.length) void upload(fl)
            e.currentTarget.value = ''
          }}
        />
        <Button kind={compact ? 'secondary' : 'main'} onClick={() => picker.current?.click()}>
          <Icons.Plus size={18} /> {texts.files.addFile}
        </Button>
        {!compact && <span class="muted small">{texts.files.dropHere}</span>}
        {uploading.value > 0 && (
          <span class="muted small">
            <Spinner /> {texts.files.uploading(uploading.value)}
          </span>
        )}
      </div>
      {problem.value && <p class="error">{problem.value}</p>}
      {list === 'loading' ? (
        <p class="muted">
          <Spinner /> {texts.files.loading}
        </p>
      ) : list === null ? (
        <div class="card-pad card">
          <p class="muted">{texts.files.offline}</p>
          <Button kind="secondary" onClick={() => void load()}>
            {texts.files.retry}
          </Button>
        </div>
      ) : list.length === 0 ? (
        <p class="muted empty-store">{texts.files.noFilesYet}</p>
      ) : (
        <>
          {!compact && (
            <div class="store-find">
              {hasPhotos && hasDocs && (
                <div class="view-switch" role="group">
                  <button type="button" class={!gallery ? 'active' : ''} aria-pressed={!gallery} onClick={() => (photosView.value = false)}>
                    {texts.files.documentsView}
                  </button>
                  <button type="button" class={gallery ? 'active' : ''} aria-pressed={gallery} onClick={() => (photosView.value = true)}>
                    {texts.files.photosView}
                  </button>
                </div>
              )}
              <input
                type="search"
                class="store-search"
                placeholder={gallery ? texts.files.searchPhotos : texts.files.search}
                value={query.value}
                onInput={(e) => (query.value = e.currentTarget.value)}
              />
              {gallery && topics.length > 0 && (
                <div class="store-kinds" role="group">
                  <button type="button" class={`chip ${topic.value === '' ? 'active' : ''}`} onClick={() => (topic.value = '')}>
                    {texts.files.allKinds}
                  </button>
                  {topics.map((t) => (
                    <button key={t} type="button" class={`chip ${topic.value === t ? 'active' : ''}`} onClick={() => (topic.value = topic.value === t ? '' : t)}>
                      {texts.files.topics[t] ?? t}
                    </button>
                  ))}
                </div>
              )}
              {sortable && Array.isArray(shown) && shown.length > 1 && (
                <label class="store-sort small">
                  <span class="muted">{texts.files.sort}:</span>
                  <select value={sort.value} onChange={(e) => setSort(e.currentTarget.value as FileSort)}>
                    <option value="newest">{texts.files.sortNewest}</option>
                    <option value="title">{texts.files.sortTitle}</option>
                    <option value="name">{texts.files.sortName}</option>
                  </select>
                </label>
              )}
              {!gallery && kinds.length > 1 && (
                <div class="store-kinds" role="group">
                  <button type="button" class={`chip ${kind.value === '' ? 'active' : ''}`} onClick={() => (kind.value = '')}>
                    {texts.files.allKinds}
                  </button>
                  {kinds.map((k) => (
                    <button key={k} type="button" class={`chip ${kind.value === k ? 'active' : ''}`} onClick={() => (kind.value = kind.value === k ? '' : k)}>
                      {texts.files.kinds[k] ?? k}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {Array.isArray(shown) && shown.length === 0 ? (
            <p class="muted">{texts.files.nothingFound}</p>
          ) : (
            <ul class={gallery ? 'photo-grid' : `store-grid ${compact ? 'compact' : ''}`}>
              {(visible as StoredFile[]).map((f) => (
                <StoreItem key={f.file} scope={scope} f={f} tile={gallery} onDeleted={() => void load()} onChanged={() => void load()} />
              ))}
            </ul>
          )}
          {Array.isArray(shown) && !showAll && shown.length > limit && (
            <button type="button" class="link-btn" onClick={() => (showAllFor.value = listKey)}>
              {texts.files.showAll(shown.length)}
            </button>
          )}
        </>
      )}
      {bin.length > 0 && <Bin scope={scope} bin={bin} onChanged={() => void load()} />}
    </div>
  )
}

/** Bin of a storage (ADR 0086), expandable under the list: restore, delete permanently, empty. */
function Bin({ scope, bin, onChanged }: { scope: StoreScope; bin: StoredFile[]; onChanged: () => void }) {
  const busy = useSignal(false)
  const problem = useSignal('')
  const circle = scope !== 'mine'

  async function run(work: () => Promise<boolean>) {
    busy.value = true
    problem.value = ''
    const ok = await work().catch(() => false)
    busy.value = false
    if (!ok) problem.value = texts.files.offline
    onChanged()
  }

  function remove(f: StoredFile) {
    const text = circle ? texts.files.circleDeleteText : texts.files.deleteText
    if (!confirm(`${texts.files.deleteQuestion(FileTitles.getInstance().shown(f.title, f.name))}\n\n${text}`)) return
    void run(() => deleteStored(scope, f.file))
  }

  function empty() {
    const text = circle ? texts.files.circleEmptyBinText : texts.files.emptyBinText
    if (!confirm(`${texts.files.emptyBinQuestion}\n\n${text}`)) return
    void run(async () => {
      let ok = true
      for (const f of bin) ok = (await deleteStored(scope, f.file).catch(() => false)) && ok
      return ok
    })
  }

  return (
    <details class="store-bin card card-pad">
      <summary>
        <Icons.Trash size={18} /> {texts.files.binRow(bin.length)}
      </summary>
      <p class="muted">{circle ? texts.files.circleBinIntro(BIN_DAYS) : texts.files.binIntro(BIN_DAYS)}</p>
      <ul class="bin-list">
        {bin.map((f) => (
          <li key={f.file}>
            <span class="bin-name">
              {FileTitles.getInstance().shown(f.title, f.name)}
              {Number(f.purgeAt) > 0 && <small class="muted">{texts.files.binGoneOn(formatShortDate(Number(f.purgeAt)))}</small>}
            </span>
            <Button kind="secondary" disabled={busy.value} onClick={() => void run(() => restoreStored(scope, f.file))}>
              {texts.files.restore}
            </Button>
            <button type="button" class="link-btn danger" disabled={busy.value} onClick={() => remove(f)}>
              {texts.files.deleteForGood}
            </button>
          </li>
        ))}
      </ul>
      {problem.value && <p class="error">{problem.value}</p>}
      <button type="button" class="link-btn danger" disabled={busy.value} onClick={empty}>
        {texts.files.emptyBin}
      </button>
    </details>
  )
}

/** This many files or photos the storage shows before „Alle ansehen“ opens the rest (as in the app). */
const FILE_LIMIT = 20
const PHOTO_LIMIT = 30

/** „Mehr Speicher“: the subscription plans as a separate page in the section „Ablage“ (ADR 0076). */
const ABO = '~abo'

/** Open the subscription plans, e.g. from the hint at a limit in the chat. */
export function openAboPlans() {
  section.value = 'files'
  filesSel.value = ABO
}

/** Online storage across all storages together (ADR 0029, 0079), only on top of the storages list; like the app's StorageMeter. */
function StorageMeter() {
  const space = storage.value
  if (!space) return null
  const state = spaceState(space)
  const percent = space.quota > 0 ? Math.min(100, (space.used / space.quota) * 100) : 0
  return (
    <div class={`storage card card-pad ${state}`}>
      <div class="storage-head">
        <div>
          <h2>{texts.files.storageTitle}</h2>
          <p>{texts.files.storageUsed(formatSize(space.used), formatStorageSize(space.quota))}</p>
        </div>
        <Button kind={state === 'ok' ? 'secondary' : 'primary'} onClick={() => (filesSel.value = ABO)}>
          {texts.files.moreStorage}
        </Button>
      </div>
      <div class="storage-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p class={state === 'ok' ? 'muted small' : 'error small'}>
        {state === 'full' ? texts.files.storageFull : state === 'nearlyFull' ? texts.files.storageNearlyFull : texts.files.storageAllStores}
      </p>
    </div>
  )
}

/** „Mehr Speicher“ (ADR 0076): plans with expected prices from the website and per plan „Interesse bekunden“. */
function AboPreviewPage({ onBack }: { onBack: () => void }) {
  const [preview, setPreview] = useState<AboPreview | null | 'loading'>('loading')
  // Monthly as default and large; yearly small below it.
  const [yearly, setYearly] = useState(false)
  async function load() {
    setPreview('loading')
    setPreview(await loadAbo())
  }
  useEffect(() => {
    void load()
  }, [])
  const german = texts.dateLocale.startsWith('de')
  const p = preview
  return (
    <section class="page">
      <header class="page-head">
        <button type="button" class="icon-btn back-btn" aria-label={texts.nav.back} onClick={onBack}>
          <Icons.Back />
        </button>
        <h1>{texts.files.moreStorage}</h1>
      </header>
      <div class="page-body abo">
        {p === 'loading' ? (
          <p class="muted">
            <Spinner /> {texts.files.aboLoading}
          </p>
        ) : p === null ? (
          <div class="card-pad card">
            <p class="muted">{texts.files.aboOffline}</p>
            <Button kind="secondary" onClick={() => void load()}>
              {texts.files.retry}
            </Button>
          </div>
        ) : (
          <>
            <p>{texts.files.aboIntro(p.trialMonths)}</p>
            <div class="view-switch" role="group">
              <button type="button" class={!yearly ? 'active' : ''} aria-pressed={!yearly} onClick={() => setYearly(false)}>
                {texts.files.aboMonthly}
              </button>
              <button type="button" class={yearly ? 'active' : ''} aria-pressed={yearly} onClick={() => setYearly(true)}>
                {texts.files.aboYearly}
              </button>
            </div>
            {planCompare(p, german) ? (
              <AboCompareView p={p} compare={planCompare(p, german)!} yearly={yearly} german={german} />
            ) : (
              // Older previews without a table: the free plan first, so that every plan can be read against it.
              <div class="abo-plans">
                {freePlan(p) && (
                  <article class="card card-pad abo-plan free">
                    <div class="abo-plan-head">
                      <h2>{planName(freePlan(p)!, german)}</h2>
                      <span class="muted small">{texts.files.aboFreeNow}</span>
                    </div>
                    <PlanFeatures plan={freePlan(p)!} german={german} />
                  </article>
                )}
                {paidPlans(p).map((plan) => (
                  <AboPlanCard key={plan.id} p={p} plan={plan} yearly={yearly} german={german} features />
                ))}
              </div>
            )}
            <p class="muted">{texts.files.aboNetwork}</p>
            <p class="muted small">
              {texts.files.aboPreviewNote} {texts.files.aboInterestNote}
            </p>
          </>
        )}
      </div>
    </section>
  )
}

/**
 * One table for all plans, the free plan the person has now first. Values that differ from the free plan are bold.
 * A paid plan is chosen with the radio buttons in the head (or by clicking its column); its price details and the one
 * button stand below.
 */
function AboCompareView({ p, compare, yearly, german }: { p: AboPreview; compare: AboCompare; yearly: boolean; german: boolean }) {
  const free = freePlan(p)
  const paid = paidPlans(p)
  const plans = [...(free ? [free] : []), ...paid]
  const [selectedId, setSelectedId] = useState((paid.find((x) => x.recommended) ?? paid[0])?.id)
  const selected = paid.find((x) => x.id === selectedId)
  const col = (plan: AboPlan) => `abo-col${plan.id === selectedId ? ' selected' : ''}${plan === free ? ' free' : ''}`
  const choose = (plan: AboPlan) => plan !== free && setSelectedId(plan.id)
  return (
    <>
      <p class="muted">{texts.files.aboChooseHint}</p>
      <div class="abo-compare-wrap">
        <table class="abo-compare">
          <caption>{texts.files.aboCompareCaption}</caption>
          <thead>
            <tr>
              <td />
              {plans.map((plan) => (
                <th key={plan.id} scope="col" class={col(plan)}>
                  {plan === free ? (
                    <span class="abo-col-head">
                      <b>{planName(plan, german)}</b>
                      <small>{texts.files.aboYourPlan}</small>
                    </span>
                  ) : (
                    <label class="abo-col-head">
                      <input type="radio" name="abo-plan" checked={plan.id === selectedId} onChange={() => setSelectedId(plan.id)} />
                      <b>{planName(plan, german)}</b>
                      <small>{plan.recommended ? texts.files.aboRecommended : '\u00a0'}</small>
                    </label>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr class="abo-price-row">
              <td />
              {plans.map((plan) => (
                <td key={plan.id} class={col(plan)} onClick={() => choose(plan)}>
                  <b>{texts.files.euro(yearly ? plan.yearlyCents : plan.monthlyCents)}</b>
                  <small>{yearly ? texts.files.aboYearShort : texts.files.aboMonthShort}</small>
                </td>
              ))}
            </tr>
            {compare.rows.map((row) => {
              const base = free ? compareValue(row, free) : null
              return (
                <Fragment key={row.label}>
                  {/* Narrow screens: the label as its own line above the values, so that all columns fit. */}
                  <tr class="abo-label-row" aria-hidden="true">
                    <td colSpan={plans.length + 1}>{row.label}</td>
                  </tr>
                  <tr>
                    <th scope="row">{row.label}</th>
                    {plans.map((plan) => {
                      const v = compareValue(row, plan)
                      return (
                        <td key={plan.id} class={col(plan)} onClick={() => choose(plan)}>
                          {plan !== free && v !== base ? <b>{v}</b> : v}
                        </td>
                      )
                    })}
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {compare.note && <p>{compare.note}</p>}
      {selected && (
        <div class="abo-plans">
          <AboPlanCard p={p} plan={selected} yearly={yearly} german={german} features={false} />
        </div>
      )}
    </>
  )
}

/** Price details of a paid plan and „Interesse bekunden“; with the text blocks only without a comparison table. */
function AboPlanCard({ p, plan, yearly, german, features }: { p: AboPreview; plan: AboPlan; yearly: boolean; german: boolean; features: boolean }) {
  const url = interestUrl(p, plan, yearly, german)
  return (
    <article class={`card card-pad abo-plan ${plan.recommended ? 'recommended' : ''}`}>
      <div class="abo-plan-head">
        <h2>{planName(plan, german)}</h2>
        {plan.recommended && <span class="abo-badge">{texts.files.aboRecommended}</span>}
      </div>
      <p class="abo-price">
        {yearly ? texts.files.aboPerYear(texts.files.euro(plan.yearlyCents)) : texts.files.aboPerMonth(texts.files.euro(plan.monthlyCents))}
      </p>
      <p class="muted small">
        {yearly
          ? texts.files.aboYearlyPerMonth(texts.files.euro(yearlyPerMonth(plan)), texts.files.euro(plan.monthlyCents))
          : texts.files.aboOrYearly(texts.files.euro(plan.yearlyCents))}
      </p>
      {/* Whoever commits for a year gets something out of it: the saving is shown alongside. */}
      {yearlySaving(plan) > 0 && <p class="abo-badge">{texts.files.aboSaving(yearlySaving(plan))}</p>}
      {features && <PlanFeatures plan={plan} german={german} />}
      {url && (
        <a class={`btn btn-${plan.recommended ? 'main' : 'secondary'}`} href={url} target="_blank" rel="noopener">
          {texts.files.aboInterest(p.trialMonths)}
        </a>
      )}
    </article>
  )
}

function PlanFeatures({ plan, german }: { plan: AboPlan; german: boolean }) {
  return (
    <ul class="abo-features">
      {planFeatures(plan, german).map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  )
}

/** A photo for the gallery (ADR 0070): recognised as a photo, or a picture that no phone has recognised yet. */
function isPhotoFile(f: StoredFile): boolean {
  return f.doc ? f.doc.kind === 'photo' : f.type === 'jpg'
}

function StoreItem({
  scope,
  f,
  tile = false,
  onDeleted,
  onChanged,
}: {
  scope: StoreScope
  f: StoredFile
  /** As a tile in the gallery: only the picture, saving and deleting above the picture. */
  tile?: boolean
  onDeleted: () => void
  onChanged: () => void
}) {
  const [thumb, setThumb] = useState<string | null>(null)
  const netState = useMemo(() => rememberNetStates([{ file: f.file, secured: f.secured }]).get(f.file) ?? 'securing', [f.file, f.secured])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isPhoto = f.type === 'jpg'
  const mime = mimeOf(f.type, f.name)
  // Title (ADR 0091), the file name small below it; without a title the file name alone.
  const shownName = FileTitles.getInstance().shown(f.title, f.name)
  const hasTitle = shownName !== f.name

  useEffect(() => {
    if (!isPhoto) return
    let alive = true
    let url: string | null = null
    fetchStored(scope, f).then((b) => {
      if (!alive || !b) return
      url = URL.createObjectURL(new Blob([b as BlobPart], { type: 'image/jpeg' }))
      setThumb(url)
    })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [f.entryId])

  /** Tapping shows the file in the app (Viewer), never in a new tab. */
  function view() {
    openViewer([
      {
        kind: isPhoto ? 'photo' : f.type === 'pdf' ? 'pdf' : 'file',
        name: shownName,
        size: Number(f.size),
        own: true,
        load: async () => {
          const b = await fetchStored(scope, f)
          return b ? URL.createObjectURL(new Blob([b as BlobPart], { type: mime })) : null
        },
      },
    ])
  }

  /** Save explicitly to the device (button „Speichern“). */
  async function save() {
    setError('')
    setBusy(true)
    try {
      const b = await fetchStored(scope, f)
      if (!b) {
        setError(texts.files.cantOpen)
        return
      }
      saveBytes(b, f.name, mime)
    } finally {
      setBusy(false)
    }
  }

  async function choose(kind: string) {
    setError('')
    setBusy(true)
    const ok = await chooseStoredKind(scope, f, kind)
    setBusy(false)
    if (ok) onChanged()
    else setError(texts.files.kindNotChanged)
  }

  /** Change the title by hand (ADR 0091 §5); empty gives it back to anynear. */
  async function retitle() {
    const text = prompt(`${texts.files.titleDialog}\n${texts.files.titleHint}`, f.title?.text ?? shownName)
    if (text == null) return
    setError('')
    setBusy(true)
    const ok = await setStoredTitle(scope, f, text)
    setBusy(false)
    if (ok) onChanged()
    else setError(texts.files.titleNotChanged)
  }

  /** A quarter turn to the right, as a new version of the same file (like „Drehen“ in the app). */
  async function rotate() {
    setError('')
    setBusy(true)
    try {
      const b = await fetchStored(scope, f)
      const turned = b ? await rotateStoreImage(b, 90) : null
      if (!turned || turned.bytes.length > LIMITS.storeBytes || !(await replaceStored(scope, f, turned))) {
        setError(texts.files.rotateFailed)
        return
      }
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const text = scope === 'mine' ? texts.files.binText(BIN_DAYS) : texts.files.circleBinText(BIN_DAYS)
    if (!confirm(`${texts.files.binQuestion(shownName)}\n\n${text}`)) return
    setBusy(true)
    const ok = await trashStored(scope, f.file)
    setBusy(false)
    if (ok) onDeleted()
    else setError(texts.files.offline)
  }

  if (tile) {
    const shows = f.doc?.topics.map((t) => texts.files.topics[t] ?? t).join(', ') ?? ''
    return (
      <li class="photo-tile">
        <button type="button" class="photo-open" onClick={view} aria-label={`${texts.files.open}: ${shownName}`} title={hasTitle ? `${shownName}\n${f.name}` : shows || f.name}>
          {thumb ? <img src={thumb} alt={shows} /> : <Icons.File size={34} />}
        </button>
        <div class="photo-actions">
          {busy && <Spinner />}
          <button type="button" class="icon-btn" aria-label={texts.files.rotate} title={texts.files.rotateHint} disabled={busy} onClick={() => void rotate()}>
            <Icons.Rotate size={16} />
          </button>
          <button type="button" class="icon-btn" aria-label={texts.files.save} title={texts.files.save} onClick={() => void save()}>
            <Icons.Download size={16} />
          </button>
          <button type="button" class="icon-btn danger" aria-label={texts.files.moveToBin} title={texts.files.moveToBin} onClick={() => void remove()}>
            <Icons.Trash size={16} />
          </button>
        </div>
        {error && <span class="error small">{error}</span>}
      </li>
    )
  }

  return (
    <li class="store-item">
      <button type="button" class="store-thumb" onClick={view} aria-label={`${texts.files.open}: ${shownName}`}>
        {thumb ? <img src={thumb} alt="" /> : <Icons.File size={34} />}
      </button>
      <div class="store-body">
        <span class="store-name" title={shownName}>
          {shownName}
        </span>
        {hasTitle && (
          <span class="store-filename muted small" title={f.name}>
            {f.name}
          </span>
        )}
        <span class="muted small">
          {formatSize(Number(f.size))} · {texts.files.addedOn(dateFmt.format(Number(f.added)))}
        </span>
        {/* Network status: distributed only from two providers on, not at the first relay yet (ADR 0028 §7); as in the app. */}
        <span
          class={netState === 'incomplete' ? 'error small' : 'small'}
          title={netState === 'secured' ? texts.files.netSecuredHint(f.operators) : netState === 'incomplete' ? texts.files.netIncompleteText : undefined}
        >
          <span class="muted">{texts.files.netStatus}:</span>{' '}
          {netState === 'secured' ? texts.files.netSecured : netState === 'incomplete' ? texts.files.netIncomplete : texts.files.netSecuring}
        </span>
        <label class="store-kind small" title={texts.files.kindHint}>
          <span class="muted">{texts.files.kind}:</span>
          <select value={f.doc?.kind ?? ''} onChange={(e) => void choose(e.currentTarget.value)}>
            {!f.doc && <option value="">{texts.files.kindNotYet}</option>}
            {/* For choosing only the important kinds, photo and other (ADR 0074); one chosen earlier stays visible. */}
            {[...choosable, ...(f.doc && !choosable.includes(f.doc.kind) ? [f.doc.kind] : [])].map((k) => (
              <option key={k} value={k}>
                {texts.files.kinds[k] ?? texts.files.kinds.other}
              </option>
            ))}
          </select>
        </label>
        {error && <span class="error small">{error}</span>}
      </div>
      <div class="store-buttons">
        {busy && <Spinner />}
        {isPhoto && (
          <button type="button" class="icon-btn" aria-label={texts.files.rotate} title={texts.files.rotateHint} disabled={busy} onClick={() => void rotate()}>
            <Icons.Rotate size={18} />
          </button>
        )}
        <button type="button" class="icon-btn" aria-label={texts.files.changeTitle} title={texts.files.changeTitle} disabled={busy} onClick={() => void retitle()}>
          <Icons.Edit size={18} />
        </button>
        <button type="button" class="icon-btn" aria-label={texts.files.save} title={texts.files.save} onClick={() => void save()}>
          <Icons.Download size={18} />
        </button>
        <button type="button" class="icon-btn danger" aria-label={texts.files.moveToBin} title={texts.files.moveToBin} onClick={() => void remove()}>
          <Icons.Trash size={18} />
        </button>
      </div>
    </li>
  )
}
