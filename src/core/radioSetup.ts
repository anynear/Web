// Setting up a radio over USB in the browser (ADR 0095): WebSerial in Chrome and Edge on a computer. Loader, software
// list, radios.json and the choice of model come from the core (`RadioSetupWeb`, ANMP); here only what the browser
// itself provides: the serial line, the drive of an nRF52 (File System Access API) and the fallbacks.
// The browser has no radio: it only puts Meshtastic on; pairing and settings are done by the app on the phone.

/**
 * Fixed address of the page, linked from the iOS app (no USB there): `https://web.anynear.app/radio`, readable in
 * German and English. `/funkgeraet` (first proposal in ADR 0095) still works.
 */
export const RADIO_PATH = '/radio'
const RADIO_PATHS = [RADIO_PATH, '/funkgeraet']

export function isRadioPath(pathname: string): boolean {
  return RADIO_PATHS.includes(pathname.replace(/\/+$/, '').toLowerCase())
}

// --- WebSerial (only the parts used here; TypeScript's DOM types do not have them yet) -------------------------------

export interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>
  getInfo(): { usbVendorId?: number; usbProductId?: number }
}

interface SerialLike {
  requestPort(options: { filters: unknown[] }): Promise<SerialPortLike>
}

/** WebSerial is there: Chrome and Edge on a computer; not in Safari, Firefox or on a phone. */
export function serialApi(nav: Navigator = navigator): SerialLike | null {
  return ((nav as unknown as { serial?: SerialLike }).serial ?? null)
}

/** The user closed the port dialog without choosing (Chrome: `NotFoundError`). */
export function isNoPortChosen(e: unknown): boolean {
  return e instanceof Error ? e.name === 'NotFoundError' : (e as { name?: string })?.name === 'NotFoundError'
}

/**
 * The serial line for the ROM loader of the core (`WebSerialLine`). A pump reads all the time into a buffer, so that
 * [read] can end after its time without losing bytes. WebSerial cannot change the speed of an open port: [setBaud]
 * closes and opens it again.
 */
export class PortLine {
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private pump: Promise<void> | null = null
  private chunks: Uint8Array[] = []
  private wake: (() => void) | null = null

  constructor(private readonly port: SerialPortLike) {}

  async open(baud: number) {
    await this.port.open({ baudRate: baud })
    this.writer = this.port.writable?.getWriter() ?? null
    const reader = this.port.readable?.getReader() ?? null
    this.reader = reader
    if (reader) this.pump = this.run(reader)
  }

  private async run(reader: ReadableStreamDefaultReader<Uint8Array>) {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (value?.length) {
          this.chunks.push(value)
          this.wake?.()
        }
      }
    } catch {
      // Port closed or cable pulled: read then returns what is left (nothing).
    } finally {
      try {
        reader.releaseLock()
      } catch {}
    }
  }

  async close() {
    try {
      await this.reader?.cancel()
    } catch {}
    await this.pump
    try {
      this.writer?.releaseLock()
    } catch {}
    this.reader = null
    this.writer = null
    this.pump = null
    this.wake?.()
    try {
      await this.port.close()
    } catch {}
  }

  async write(bytes: Int8Array | Uint8Array) {
    if (!this.writer) throw new Error('Port zu')
    await this.writer.write(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length))
  }

  /** What is there, waiting at most [timeoutMs]; an empty array when nothing came. */
  async read(timeoutMs: number): Promise<Uint8Array> {
    if (!this.chunks.length && this.pump) {
      await new Promise<void>((done) => {
        const timer = setTimeout(finish, timeoutMs)
        function finish() {
          clearTimeout(timer)
          done()
        }
        this.wake = finish
      })
      this.wake = null
    }
    return this.take()
  }

  private take(): Uint8Array {
    if (this.chunks.length === 1) return this.chunks.pop()!
    const size = this.chunks.reduce((n, c) => n + c.length, 0)
    const out = new Uint8Array(size)
    let at = 0
    for (const c of this.chunks) {
      out.set(c, at)
      at += c.length
    }
    this.chunks = []
    return out
  }

  async setBaud(baud: number) {
    await this.close()
    this.chunks = []
    await this.open(baud)
  }

  async setSignals(dtr: boolean, rts: boolean) {
    await this.port.setSignals({ dataTerminalReady: dtr, requestToSend: rts })
  }
}

// --- radios.json -------------------------------------------------------------------------------------------------------

const RADIOS_KEY = 'app:web:radios'

/**
 * Text of radios.json to use (ADR 0095 §2): the fresh one if it can be read, otherwise the last good one, otherwise
 * the copy in the web app. A fresh, readable one is kept as the last good one.
 */
export function pickRadiosText(
  fresh: string | null,
  valid: (text: string) => boolean,
  store: Pick<Storage, 'getItem' | 'setItem'> | null,
  fallback: string,
): string {
  if (fresh && valid(fresh)) {
    try {
      store?.setItem(RADIOS_KEY, fresh)
    } catch {}
    return fresh
  }
  let last: string | null = null
  try {
    last = store?.getItem(RADIOS_KEY) ?? null
  } catch {}
  return last && valid(last) ? last : fallback
}

export async function fetchText(url: string, get: typeof fetch = fetch): Promise<string | null> {
  try {
    const r = await get(url, { cache: 'no-cache' })
    return r.ok ? await r.text() : null
  } catch {
    return null
  }
}

/** Name for a model without radios.json entry: `HELTEC_V3` → `HELTEC V3`, as printed in the software list. */
export function modelLabel(hwModel: string): string {
  return hwModel.replace(/_/g, ' ')
}

// --- Drive of an nRF52 / RP2040 (UF2) ----------------------------------------------------------------------------------

/** File name for the drive and the download, from the link; always ends in `.uf2`. */
export function uf2FileName(url: string): string {
  const last = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() ?? '')
  const safe = last.replace(/[^A-Za-z0-9._-]/g, '')
  return safe.toLowerCase().endsWith('.uf2') ? safe : 'firmware.uf2'
}

export interface DirectoryLike {
  getFileHandle(name: string, options: { create: boolean }): Promise<{
    createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>
  }>
}

/** The browser can write to a drive the person picks (Chrome and Edge on a computer). */
export function drivePicker(win: Window = window): ((options: { mode: 'readwrite' }) => Promise<DirectoryLike>) | null {
  const pick = (win as unknown as { showDirectoryPicker?: (o: { mode: 'readwrite' }) => Promise<DirectoryLike> }).showDirectoryPicker
  return typeof pick === 'function' ? pick.bind(win) : null
}

const CHUNK = 64 * 1024

/**
 * Writes [bytes] as [name] onto the drive [dir], [onProgress] 0..1. The radio restarts as soon as the whole file is
 * there, and the drive disappears; an error while closing after all bytes were written therefore counts as done.
 * Resolves to `true` when everything was written.
 */
export async function writeToDrive(dir: DirectoryLike, name: string, bytes: Uint8Array, onProgress: (p: number) => void): Promise<boolean> {
  const file = await dir.getFileHandle(name, { create: true })
  const out = await file.createWritable()
  let written = 0
  try {
    for (let at = 0; at < bytes.length; at += CHUNK) {
      const part = bytes.subarray(at, Math.min(at + CHUNK, bytes.length))
      await out.write(part)
      written += part.length
      onProgress(written / bytes.length)
    }
  } catch {
    return false
  }
  try {
    await out.close()
  } catch {
    return written === bytes.length
  }
  return true
}

/** Offers [bytes] to save as [name] (fallback without a drive picker): the person drags it onto the drive. */
export function saveFile(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
