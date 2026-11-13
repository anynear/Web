// Building blocks as in the app (Components.kt): buttons with ranking, sections, rows, dialogs, QR code.
import type { ButtonHTMLAttributes, ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import QRCode from 'qrcode'
import { texts } from '../i18n'
import * as Icons from './icons'

/** `main` is the one orange main action of a screen (Docs/marke §5). */
export type ButtonKind = 'main' | 'primary' | 'secondary' | 'quiet' | 'danger'

export function Button({
  kind = 'primary',
  children,
  ...rest
}: { kind?: ButtonKind; children: ComponentChildren } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} class={`btn btn-${kind} ${rest.class ?? ''}`}>
      {children}
    </button>
  )
}

export function Section({ id, title, footer, children }: { id?: string; title?: string; footer?: string; children: ComponentChildren }) {
  return (
    <section class="section" id={id}>
      {title && <h2 class="section-title">{title}</h2>}
      <div class="card">{children}</div>
      {footer && <p class="section-footer">{footer}</p>}
    </section>
  )
}

export function Row({
  icon,
  title,
  text,
  right,
  onClick,
}: {
  icon?: ComponentChildren
  title: ComponentChildren
  text?: ComponentChildren
  right?: ComponentChildren
  onClick?: () => void
}) {
  const body = (
    <>
      {icon && <span class="row-icon">{icon}</span>}
      <span class="row-body">
        <span class="row-title">{title}</span>
        {text && <span class="row-text">{text}</span>}
      </span>
      {right && <span class="row-right">{right}</span>}
    </>
  )
  return onClick ? (
    <button type="button" class="row row-button" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div class="row">{body}</div>
  )
}

export function Dialog({ title, onClose, children, class: cls }: { title: string; onClose: () => void; children: ComponentChildren; class?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog ref={ref} class={cls ? `dialog ${cls}` : 'dialog'} onClose={onClose} onCancel={onClose}>
      <div class="dialog-head">
        <h2>{title}</h2>
        <button type="button" class="icon-btn" aria-label={texts.nav.close} onClick={onClose}>
          <Icons.Close />
        </button>
      </div>
      {children}
    </dialog>
  )
}

/** QR code as SVG; night blue on white, so that phone cameras read it reliably. */
export function Qr({ text, size = 240 }: { text: string; size?: number }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#0B1320', light: '#FFFFFF' } })
      .then(setSvg)
      .catch(() => setSvg(''))
  }, [text])
  return <div class="qr" style={{ width: `${size}px`, height: `${size}px` }} dangerouslySetInnerHTML={{ __html: svg }} />
}

/** Link with a „Kopieren“ button that briefly shows „Kopiert“. */
export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Without access to the clipboard the link stays there for selecting.
    }
  }
  return (
    <div class="copy-link">
      <input class="input mono" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
      <Button kind="secondary" onClick={copy}>
        <Icons.Copy size={18} /> {copied ? texts.circle.copied : texts.circle.copy}
      </Button>
    </div>
  )
}

export function Spinner() {
  return <span class="spinner" aria-hidden="true" />
}

/** Confirmation like the dialogs of the app: title, short text, cancel and the one (mostly red) action. */
export function Confirm({
  title,
  text,
  note,
  confirm,
  danger = true,
  onConfirm,
  onClose,
}: {
  title: string
  text?: string
  note?: string
  confirm: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog title={title} onClose={onClose}>
      <div class="dialog-body">
        {text && <p>{text}</p>}
        {note && <p class="muted small">{note}</p>}
        <div class="dialog-actions">
          <Button kind="quiet" onClick={onClose}>
            {texts.common.cancel}
          </Button>
          <Button
            kind={danger ? 'danger' : 'primary'}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
              } finally {
                setBusy(false)
                onClose()
              }
            }}
          >
            {confirm}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
