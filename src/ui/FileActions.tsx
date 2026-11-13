// Downloading and saving to storage for attachments, as in the app (ChatAttachments.kt): always after confirmation,
// when saving with a choice of storage (my storage or that of a circle, ADR 0040, 0049).
import { texts } from '../i18n'
import { LIMITS, prepareFile, saveUrl } from '../core/media'
import { circles, putStored, spaceState, storage, type StoreScope } from '../core/session'
import { Button, Dialog } from './components'
import * as Icons from './icons'

/** A file that can be downloaded or stored. */
export interface FileItem {
  name: string
  /** Loads the file as a blob URL, `null` if it is not available right now. */
  load: () => Promise<string | null>
}

export type FileAction = { kind: 'download' | 'store'; items: FileItem[] }

/** Confirmation for [action]; [onDone] gets what there is to say and whether it worked. */
export function FileActionDialog({ action, onClose, onDone }: { action: FileAction; onClose: () => void; onDone: (text: string, ok: boolean) => void }) {
  const n = action.items.length
  if (action.kind === 'download') {
    return (
      <Dialog title={texts.viewer.downloadTitle(n)} onClose={onClose}>
        <div class="dialog-body">
          <p>{texts.viewer.downloadText(n)}</p>
          <div class="dialog-actions">
            <Button kind="quiet" onClick={onClose}>
              {texts.common.cancel}
            </Button>
            <Button
              onClick={() => {
                onClose()
                void download(action.items).then((ok) => !ok && onDone(texts.viewer.cantShow, false))
              }}
            >
              <Icons.Download size={18} /> {texts.viewer.download}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }
  const targets: { scope: StoreScope; name: string; done: string }[] = [
    { scope: 'mine', name: texts.files.justForMe, done: texts.viewer.addedToMine },
    ...circles.value.filter((c) => !c.removed).map((c) => ({ scope: c.id, name: c.name, done: texts.viewer.addedTo(c.name) })),
  ]
  return (
    <Dialog title={texts.viewer.chooseStore(n)} onClose={onClose}>
      <div class="dialog-body">
        <div class="store-choice">
          {targets.map((t) => (
            <button
              key={t.scope}
              type="button"
              class="row row-button"
              onClick={() => {
                onClose()
                void store(t.scope, action.items).then((problem) => onDone(problem ?? t.done, !problem))
              }}
            >
              {t.scope === 'mine' ? <Icons.Lock size={20} /> : <Icons.Circle size={20} />}
              <span>{t.name}</span>
            </button>
          ))}
        </div>
        <div class="dialog-actions">
          <Button kind="quiet" onClick={onClose}>
            {texts.common.cancel}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

async function download(items: FileItem[]): Promise<boolean> {
  for (const item of items) {
    const url = await item.load().catch(() => null)
    if (!url) return false
    saveUrl(url, item.name)
  }
  return true
}

/** Puts all [items] into the storage [scope]; `null` if everything worked, otherwise what there is to say. */
async function store(scope: StoreScope, items: FileItem[]): Promise<string | null> {
  if (storage.value && spaceState(storage.value) === 'full') return texts.files.storageFull
  for (const item of items) {
    const url = await item.load().catch(() => null)
    if (!url) return texts.viewer.cantShow
    const blob = await (await fetch(url)).blob()
    const p = await prepareFile(new File([blob], item.name, { type: blob.type }), true)
    if (!p) return texts.compose.photoUnreadable
    if (p.bytes.length > LIMITS.storeBytes) return texts.files.tooLarge
    const name = p.type === 'jpg' ? item.name.replace(/\.[^.]+$/, '') + '.jpg' : item.name
    if (!(await putStored(scope, p, name))) {
      return storage.value && spaceState(storage.value) === 'full' ? texts.files.storageFull : texts.files.notAccepted
    }
  }
  return null
}
