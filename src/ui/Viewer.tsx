// Viewer for attachments and files in the web app: photos large, PDFs in the page, other files with name, kind and size.
// Tapping always opens this viewer, never a new tab and never a download. A file only gets onto the device
// via the explicit button „Aufs Gerät speichern“ (like the in-app viewer of the app).
import { signal } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'
import { texts } from '../i18n'
import { Button, Dialog, Spinner } from './components'
import { FileActionDialog, type FileAction, type FileItem } from './FileActions'
import { formatSize } from './format'
import * as Icons from './icons'

export interface ViewerItem {
  kind: 'photo' | 'pdf' | 'file'
  /** Displayed name; empty for photos without a name. */
  name: string
  size?: number
  /** Loads the file and returns a blob URL, `null` if that does not work right now. */
  load: () => Promise<string | null>
  /** The URL belongs to the viewer and is released on closing (otherwise it belongs to a cache). */
  own?: boolean
  /** Attachment from the chat: can also be put into a storage. */
  file?: FileItem
}

const shown = signal<{ items: ViewerItem[]; index: number } | null>(null)

/** Opens the viewer; with several photos one can page through. */
export function openViewer(items: ViewerItem[], index = 0) {
  if (items.length) shown.value = { items, index: Math.min(Math.max(index, 0), items.length - 1) }
}

/** Mounted once in the app, like the other dialogs. */
export function Viewer() {
  const s = shown.value
  if (!s) return null
  return <ViewerDialog items={s.items} index={s.index} />
}

function ViewerDialog({ items, index }: { items: ViewerItem[]; index: number }) {
  const item = items[index]
  const [url, setUrl] = useState<string | null | 'loading'>('loading')
  const close = () => (shown.value = null)
  const go = (step: number) => {
    const next = index + step
    if (next >= 0 && next < items.length) shown.value = { items, index: next }
  }

  useEffect(() => {
    let alive = true
    let loaded: string | null = null
    setUrl('loading')
    item.load().then(
      (u) => {
        loaded = u
        if (alive) setUrl(u)
        else if (u && item.own) URL.revokeObjectURL(u)
      },
      () => alive && setUrl(null),
    )
    return () => {
      alive = false
      if (loaded && item.own) URL.revokeObjectURL(loaded)
    }
  }, [item])

  useEffect(() => {
    if (items.length < 2) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, index])

  const label = item.name || (item.kind === 'photo' ? texts.attachment.photo : item.kind === 'pdf' ? texts.attachment.pdf : texts.attachment.file)
  const title = item.kind === 'photo' && items.length > 1 ? texts.viewer.photoOf(index + 1, items.length) : label
  const ready = url !== 'loading' && url !== null
  const [action, setAction] = useState<FileAction | null>(null)
  const [notice, setNotice] = useState('')
  const asFile: FileItem = item.file ?? { name: saveName(item, label), load: () => Promise.resolve(ready ? url : null) }

  return (
    <Dialog title={title} onClose={close} class="viewer">
      <div class="dialog-body">
        {url === 'loading' ? (
          <p class="viewer-state muted">
            <Spinner /> {texts.attachment.loading}
          </p>
        ) : url === null ? (
          <p class="viewer-state error">{texts.viewer.cantShow}</p>
        ) : item.kind === 'photo' ? (
          <ZoomPhoto src={url} alt={label} />
        ) : item.kind === 'pdf' ? (
          <>
            <iframe class="viewer-pdf" src={url} title={label} />
            <p class="muted small">{texts.viewer.pdfHint}</p>
          </>
        ) : (
          <div class="viewer-file">
            <span class="viewer-file-icon">
              <Icons.File size={40} />
            </span>
            <span class="viewer-file-name">{label}</span>
            <span class="muted">
              {kindLabel(item, label)}
              {item.size !== undefined && item.size > 0 && ` · ${formatSize(item.size)}`}
            </span>
            <p class="muted small">{texts.viewer.noPreview}</p>
          </div>
        )}
        <div class="dialog-actions viewer-actions">
          {items.length > 1 && (
            <span class="viewer-nav">
              <button type="button" class="icon-btn" aria-label={texts.viewer.previous} title={texts.viewer.previous} disabled={index === 0} onClick={() => go(-1)}>
                <Icons.Back />
              </button>
              <button type="button" class="icon-btn viewer-next" aria-label={texts.viewer.next} title={texts.viewer.next} disabled={index === items.length - 1} onClick={() => go(1)}>
                <Icons.Back />
              </button>
            </span>
          )}
          {item.file && (
            <Button kind="secondary" disabled={!ready} onClick={() => setAction({ kind: 'store', items: [asFile] })}>
              <Icons.Lock size={18} /> {texts.viewer.toFiles}
            </Button>
          )}
          <Button kind={item.kind === 'file' ? 'main' : 'secondary'} disabled={!ready} onClick={() => setAction({ kind: 'download', items: [asFile] })}>
            <Icons.Download size={18} /> {texts.viewer.saveToDevice}
          </Button>
        </div>
        {notice && <p class="muted small" role="status">{notice}</p>}
        {action && <FileActionDialog action={action} onClose={() => setAction(null)} onDone={(t) => setNotice(t)} />}
      </div>
    </Dialog>
  )
}

const MAX_ZOOM = 5
const DOUBLE_TAP_ZOOM = 2.5
const DOUBLE_TAP_MS = 300

interface View {
  scale: number
  x: number
  y: number
}

/**
 * Photo to enlarge, like the full screen of the app: two fingers enlarge around the spot between them, a double tap
 * (double click) enlarges at that spot or goes back, Ctrl + wheel or the trackpad pinch too. Enlarged, one finger or
 * the mouse moves it, never beyond its edges.
 */
function ZoomPhoto({ src, alt }: { src: string; alt: string }) {
  const box = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })
  const current = useRef(view)
  current.current = view
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const lastTap = useRef({ t: 0, x: 0, y: 0 })

  useEffect(() => setView({ scale: 1, x: 0, y: 0 }), [src])

  // How far the photo may move at scale s: half of what it sticks out beyond the frame (object-fit: contain).
  const clamp = (scale: number, x: number, y: number): View => {
    const b = box.current
    const i = img.current
    if (!b || !i || !i.naturalWidth || !i.naturalHeight) return { scale, x: 0, y: 0 }
    const fit = Math.min(b.clientWidth / i.naturalWidth, b.clientHeight / i.naturalHeight)
    const mx = Math.max(0, (i.naturalWidth * fit * scale - b.clientWidth) / 2)
    const my = Math.max(0, (i.naturalHeight * fit * scale - b.clientHeight) / 2)
    return { scale, x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) }
  }

  // Spot relative to the centre of the frame; it stays where it is while zooming.
  const spot = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect()
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 }
  }

  const zoomTo = (target: number, fx: number, fy: number, base: View = current.current) => {
    const scale = Math.min(MAX_ZOOM, Math.max(1, target))
    const f = scale / base.scale
    const next = clamp(scale, base.x * f + fx * (1 - f), base.y * f + fy * (1 - f))
    current.current = next
    setView(next)
  }

  const toggle = (clientX: number, clientY: number) => {
    if (current.current.scale > 1) {
      current.current = { scale: 1, x: 0, y: 0 }
      setView(current.current)
    } else {
      const s = spot(clientX, clientY)
      zoomTo(DOUBLE_TAP_ZOOM, s.x, s.y)
    }
  }

  const onPointerDown = (e: PointerEvent) => {
    try {
      box.current?.setPointerCapture(e.pointerId)
    } catch {
      // Pointer already gone: the gesture still works as long as it stays over the photo.
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (e.pointerType !== 'mouse' && pointers.current.size === 1) {
      const last = lastTap.current
      if (e.timeStamp - last.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
        lastTap.current = { t: 0, x: 0, y: 0 }
        toggle(e.clientX, e.clientY)
      } else {
        lastTap.current = { t: e.timeStamp, x: e.clientX, y: e.clientY }
      }
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    const before = pointers.current.get(e.pointerId)
    if (!before) return
    const all = [...pointers.current.values()]
    if (all.length >= 2) {
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)![1]
      const oldDist = Math.hypot(before.x - other.x, before.y - other.y)
      const newDist = Math.hypot(e.clientX - other.x, e.clientY - other.y)
      const oldMid = spot((before.x + other.x) / 2, (before.y + other.y) / 2)
      const newMid = spot((e.clientX + other.x) / 2, (e.clientY + other.y) / 2)
      const base = current.current
      if (oldDist > 0) zoomTo(base.scale * (newDist / oldDist), oldMid.x, oldMid.y)
      const z = current.current
      current.current = clamp(z.scale, z.x + newMid.x - oldMid.x, z.y + newMid.y - oldMid.y)
      setView(current.current)
    } else if (current.current.scale > 1) {
      const z = current.current
      current.current = clamp(z.scale, z.x + e.clientX - before.x, z.y + e.clientY - before.y)
      setView(current.current)
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }

  const onPointerUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId)
  }

  const onWheel = (e: WheelEvent) => {
    // Ctrl + wheel, and the pinch on a trackpad (which the browser reports as Ctrl + wheel)
    if (!e.ctrlKey) return
    e.preventDefault()
    const s = spot(e.clientX, e.clientY)
    zoomTo(current.current.scale * Math.exp(-e.deltaY / 200), s.x, s.y)
  }

  return (
    <div
      ref={box}
      class={`viewer-photo${view.scale > 1 ? ' zoomed' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onDblClick={(e) => toggle(e.clientX, e.clientY)}
    >
      <img
        ref={img}
        src={src}
        alt={alt}
        draggable={false}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      />
    </div>
  )
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 && name.length - dot <= 8 ? name.slice(dot + 1) : ''
}

function kindLabel(item: ViewerItem, label: string): string {
  if (item.kind === 'photo') return texts.attachment.photo
  if (item.kind === 'pdf') return texts.viewer.kindPdf
  const ext = extOf(label)
  return ext ? texts.viewer.kindOf(ext.toUpperCase()) : texts.attachment.file
}

/** File name when saving: photos without a name get `.jpg`, PDFs `.pdf`. */
function saveName(item: ViewerItem, label: string): string {
  if (extOf(label)) return label
  if (item.kind === 'photo') return `${label}.jpg`
  if (item.kind === 'pdf') return `${label}.pdf`
  return label
}
