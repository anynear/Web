// „Funkgerät einrichten“ (ADR 0095): Meshtastic onto a radio on the USB cable, in Chrome or Edge on a computer
// (WebSerial). For people with an iPhone, whose app cannot use USB; the iOS app links to `/radio`. Same steps and
// texts as the USB setup of the app (RadioSoftwareTexts): connect, recognise, choose the model (recommended ones from
// radios.json with picture, the full list under „Anderes Meshtastic-fähiges Funkgerät“), install with progress.
// ESP32: written by the ROM loader of the core. nRF52 (T1000-E, Solar Node): the file goes onto the drive of the radio.
// Afterwards the app on the phone pairs and sets up the radio; the browser has no radio.
import { useEffect, useRef, useState } from 'preact/hooks'
import { RadioSetupWeb, type WebEspLoader, type WebFirmwareList, type WebRadioCatalog, type WebRadioOption, type WebRadio, type WebRadioSelection, type WebSerialLine } from 'anmp-core'
import { texts } from '../i18n'
import { radioSoftware } from '../core/session'
import {
  drivePicker,
  fetchText,
  isNoPortChosen,
  isRadioPath,
  modelLabel,
  pickRadiosText,
  PortLine,
  saveFile,
  serialApi,
  uf2FileName,
  writeToDrive,
} from '../core/radioSetup'
import { RADIOS_FALLBACK } from '../core/radiosFallback'
import { Button, Spinner } from './components'
import * as Icons from './icons'
import { pane } from './nav'

const setup = RadioSetupWeb.getInstance()
const lang = texts.dateLocale.startsWith('de') ? 'de' : 'en'
/** First speed of the ROM loader; the core switches to a faster one itself (setBaud). */
const ROM_BAUD = 115200

type Note = 'noPortChosen' | 'portFailed' | 'holdBoot' | 'noList' | null

type Step =
  | { kind: 'start'; note: Note }
  | { kind: 'connecting' }
  | { kind: 'choose'; sel: WebRadioSelection; unfit: WebRadio[]; viaDrive: boolean; error: string | null }
  | { kind: 'working'; text: string; progress: number | null }
  | { kind: 'downloaded' }
  | { kind: 'done' }

/** Loads radios.json (fresh, else last good, else the copy in the web app) and the software list, once per visit. */
function loadBasics(): Promise<{ catalog: WebRadioCatalog | null; list: WebFirmwareList | null }> {
  const catalog = fetchText(setup.RADIOS_URL).then((fresh) => {
    let store: Storage | null = null
    try {
      store = localStorage
    } catch {}
    return setup.parseRadios(pickRadiosText(fresh, (t) => setup.parseRadios(t) !== null, store, RADIOS_FALLBACK))
  })
  return Promise.all([catalog, radioSoftware()]).then(([c, list]) => ({ catalog: c ?? null, list }))
}

export function RadioSetupPage({ standalone = false }: { standalone?: boolean }) {
  const [step, setStep] = useState<Step>({ kind: 'start', note: null })
  const basics = useRef<ReturnType<typeof loadBasics> | null>(null)
  const line = useRef<PortLine | null>(null)
  const loader = useRef<WebEspLoader | null>(null)
  const list = useRef<WebFirmwareList | null>(null)

  if (!basics.current) basics.current = loadBasics()

  /** Lets go of the radio: leave the loader (it starts what is on it) and close the port. */
  async function release() {
    const l = loader.current
    loader.current = null
    if (l) await l.restart().catch(() => {})
    const p = line.current
    line.current = null
    await p?.close()
  }

  useEffect(() => () => void release(), [])

  function leave() {
    void release()
    if (isRadioPath(location.pathname)) history.replaceState(null, '', '/')
    pane.value = 'chat'
  }

  async function connect() {
    const serial = serialApi()
    if (!serial) return
    await release()
    let port
    try {
      port = await serial.requestPort({ filters: setup.portFilters() })
    } catch (e) {
      setStep({ kind: 'start', note: isNoPortChosen(e) ? 'noPortChosen' : 'portFailed' })
      return
    }
    setStep({ kind: 'connecting' })
    const { catalog, list: software } = await basics.current!
    if (!software) {
      basics.current = null
      setStep({ kind: 'start', note: 'noList' })
      return
    }
    list.current = software
    const { usbVendorId = 0, usbProductId = 0 } = port.getInfo()
    const family = setup.usbFamily(usbVendorId, usbProductId)
    if (family === 'nrf52' || family === 'rp2040') {
      // Nothing over the serial line: the file goes onto the drive of the bootloader.
      const sel = setup.select(catalog, software, null, usbVendorId, usbProductId, null)
      setStep({ kind: 'choose', sel, unfit: unfitRadios(catalog, sel), viaDrive: true, error: null })
      return
    }
    const portLine = new PortLine(port)
    try {
      await portLine.open(ROM_BAUD)
    } catch {
      setStep({ kind: 'start', note: 'portFailed' })
      return
    }
    line.current = portLine
    const esp = await setup.connect(portLine as unknown as WebSerialLine, usbVendorId, (m) => console.debug('USB', m)).catch(() => null)
    if (!esp) {
      await release()
      setStep({ kind: 'start', note: 'holdBoot' })
      return
    }
    loader.current = esp
    const sel = setup.select(catalog, software, esp.info, usbVendorId, usbProductId, null)
    setStep({ kind: 'choose', sel, unfit: unfitRadios(catalog, sel), viaDrive: false, error: null })
  }

  async function installEsp(sel: WebRadioSelection, unfit: WebRadio[], option: WebRadioOption) {
    const esp = loader.current
    const software = list.current
    if (!esp || !software) return
    setStep({ kind: 'working', text: texts.radioSetup.downloading, progress: null })
    const result = await esp
      .install(software, option.hwModel, (phase, p) =>
        setStep(phase === 'write' ? { kind: 'working', text: texts.radioSetup.installing, progress: p } : { kind: 'working', text: texts.radioSetup.downloading, progress: null }),
      )
      .catch(() => 'write')
    if (result === 'done') {
      // The core restarted the radio after writing; only the port is left.
      loader.current = null
      await release()
      setStep({ kind: 'done' })
      return
    }
    const error = result === 'download' ? texts.radioSetup.downloadFailed : result === 'unknown' ? texts.radioSetup.nothingFits : texts.radioSetup.installFailed
    if (result === 'write') {
      // The ROM loader may be gone after a failed write: the button now connects anew („Nochmal versuchen“).
      await release()
    }
    setStep({ kind: 'choose', sel, unfit, viaDrive: false, error })
  }

  async function installDrive(sel: WebRadioSelection, unfit: WebRadio[], option: WebRadioOption, download: boolean) {
    const url = option.uf2Url
    if (!url) return
    const pick = download ? null : drivePicker()
    let dir = null
    if (pick) {
      // Ask for the drive first, while the click still counts as the person's action.
      try {
        dir = await pick({ mode: 'readwrite' })
      } catch {
        return
      }
    }
    setStep({ kind: 'working', text: texts.radioSetup.downloading, progress: null })
    // Checked against size and SHA-256 of the signed list, like the app: a file that does not match never reaches the drive.
    const software = list.current
    const checked = software ? await setup.fetchUf2(software, option.hwModel, url).catch(() => null) : null
    const bytes = checked ? new Uint8Array(checked.buffer, checked.byteOffset, checked.length) : null
    if (!bytes) {
      setStep({ kind: 'choose', sel, unfit, viaDrive: true, error: texts.radioSetup.downloadFailed })
      return
    }
    const name = uf2FileName(url)
    if (!dir) {
      saveFile(bytes, name)
      setStep({ kind: 'downloaded' })
      return
    }
    setStep({ kind: 'working', text: texts.radioSetup.driveWriting, progress: 0 })
    const ok = await writeToDrive(dir, name, bytes, (p) => setStep({ kind: 'working', text: texts.radioSetup.driveWriting, progress: p })).catch(() => false)
    setStep(ok ? { kind: 'done' } : { kind: 'choose', sel, unfit, viaDrive: true, error: texts.radioSetup.driveFailed })
  }

  const body = (() => {
    switch (step.kind) {
      case 'start':
        return <Start note={step.note} onConnect={() => void connect()} />
      case 'connecting':
        return (
          <p class="muted">
            <Spinner /> {texts.radioSetup.connecting}
          </p>
        )
      case 'choose':
        return (
          <Choose
            key={step.sel}
            sel={step.sel}
            unfit={step.unfit}
            viaDrive={step.viaDrive}
            error={step.error}
            canInstall={step.viaDrive || loader.current !== null}
            onInstall={(o, download) => void (step.viaDrive ? installDrive(step.sel, step.unfit, o, download) : installEsp(step.sel, step.unfit, o))}
            onAgain={() => void connect()}
          />
        )
      case 'working':
        return <Working text={step.text} progress={step.progress} />
      case 'downloaded':
        return (
          <div class="card-pad radio-card">
            <p>{texts.radioSetup.driveDownloaded}</p>
            <p class="muted small">{texts.radioSetup.doubleTapReset}</p>
            <Done />
          </div>
        )
      case 'done':
        return (
          <div class="card-pad radio-card">
            <h2 class="ok">{texts.radioSetup.doneTitle}</h2>
            <Done />
            <Button kind="secondary" onClick={() => setStep({ kind: 'start', note: null })}>
              {texts.radioSetup.again}
            </Button>
          </div>
        )
    }
  })()

  return (
    <section class={`page radio-setup ${standalone ? 'radio-standalone' : ''}`}>
      <header class="page-head">
        <button type="button" class="icon-btn back-btn" aria-label={texts.radioSetup.back} onClick={leave}>
          <Icons.Back />
        </button>
        <h1>{texts.radioSetup.title}</h1>
      </header>
      <div class="page-body">
        {body}
        {standalone && (
          <a class="link-btn small" href="/" onClick={(e) => (e.preventDefault(), leave())}>
            {texts.radioSetup.toApp}
          </a>
        )}
      </div>
    </section>
  )
}

function Start({ note, onConnect }: { note: Note; onConnect: () => void }) {
  if (!serialApi()) {
    return (
      <div class="card-pad radio-card" role="status">
        <h2>{texts.radioSetup.noSerialTitle}</h2>
        <p>{texts.radioSetup.noSerialText}</p>
      </div>
    )
  }
  return (
    <div class="card-pad radio-card">
      <p>{texts.radioSetup.intro}</p>
      <p class="muted small">{texts.radioSetup.cableHint}</p>
      {note && (
        <p class={note === 'noPortChosen' ? 'hint-text' : 'error'} role="status">
          {texts.radioSetup[note]}
        </p>
      )}
      <Button kind="main" onClick={onConnect}>
        {note === 'holdBoot' || note === 'noList' || note === 'portFailed' ? texts.radioSetup.tryAgain : texts.radioSetup.connect}
      </Button>
    </div>
  )
}

/** Recommended radios on another chip than the plugged-in one: shown greyed out, as in the app (ADR 0095). */
function unfitRadios(catalog: WebRadioCatalog | null, sel: WebRadioSelection): WebRadio[] {
  const shown = new Set(sel.recommended.map((o) => o.hwModel))
  return (catalog?.radios ?? []).filter((r) => !shown.has(r.hwModel))
}

/** Usable now: over the loader (ESP32) or as a file for the drive (nRF52, RP2040). */
const usable = (o: WebRadioOption, viaDrive: boolean) => (viaDrive ? o.uf2Url !== null : o.viaSerial)

function Choose({
  sel,
  unfit,
  viaDrive,
  error,
  canInstall,
  onInstall,
  onAgain,
}: {
  sel: WebRadioSelection
  unfit: WebRadio[]
  viaDrive: boolean
  error: string | null
  canInstall: boolean
  onInstall: (o: WebRadioOption, download: boolean) => void
  onAgain: () => void
}) {
  const recommended = sel.recommended.filter((o) => usable(o, viaDrive))
  const others = sel.others.filter((o) => usable(o, viaDrive))
  const all = [...recommended, ...others]
  // As in the app: preselected only what was recognised, otherwise nothing (the button stays off until a choice).
  const [chosen, setChosen] = useState<string | null>(sel.preselected ?? null)
  const [showOthers, setShowOthers] = useState(recommended.length === 0 || others.some((o) => o.hwModel === sel.preselected))
  const option = all.find((o) => o.hwModel === chosen) ?? null
  const recognised = sel.preselected ? all.find((o) => o.hwModel === sel.preselected) : undefined
  const picker = drivePicker() !== null

  if (!all.length) {
    return (
      <div class="card-pad radio-card">
        <p class="error">{texts.radioSetup.nothingFits}</p>
        <Button kind="secondary" onClick={onAgain}>
          {texts.radioSetup.tryAgain}
        </Button>
      </div>
    )
  }

  return (
    <div class="card-pad radio-card">
      <p>{texts.radioSetup.pick}</p>
      {recognised && <p class="muted small">{texts.radioSetup.recognisedHint}</p>}
      {recommended.length > 0 && (
        <div class="radio-choices" role="radiogroup" aria-label={texts.radioSetup.title}>
          {recommended.map((o) => (
            <label key={o.hwModel} class={`radio-choice ${chosen === o.hwModel ? 'chosen' : ''}`}>
              <input type="radio" name="radio-model" checked={chosen === o.hwModel} onChange={() => setChosen(o.hwModel)} />
              <RadioPicture src={o.radio?.image ?? null} />
              <span class="radio-choice-body">
                <span class="radio-choice-name">{o.radio?.name ?? modelLabel(o.hwModel)}</span>
                {o.radio?.use(lang) && <span class="muted small">{o.radio.use(lang)}</span>}
              </span>
              <span class="radio-badge">{o.recognised ? texts.radioSetup.recognisedBadge : texts.radioSetup.recommended}</span>
            </label>
          ))}
          {unfit.map((r) => (
            <div key={r.id} class="radio-choice unfit" aria-disabled="true">
              <input type="radio" name="radio-model" disabled />
              <RadioPicture src={r.image ?? null} />
              <span class="radio-choice-body">
                <span class="radio-choice-name">{r.name}</span>
                <span class="muted small">{texts.radioSetup.unfit}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {others.length > 0 &&
        (showOthers ? (
          <label class="field radio-other">
            <span>{recommended.length ? texts.radioSetup.other : texts.radioSetup.otherLabel}</span>
            <select class="input" value={others.some((o) => o.hwModel === chosen) ? chosen! : ''} onChange={(e) => setChosen(e.currentTarget.value || null)}>
              <option value="">{texts.radioSetup.otherChoose}</option>
              {others.map((o) => (
                <option key={o.hwModel} value={o.hwModel}>
                  {modelLabel(o.hwModel)}
                  {o.recognised ? ` – ${texts.radioSetup.recognisedBadge}` : ''}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <button type="button" class="link-btn small" onClick={() => setShowOthers(true)}>
            {texts.radioSetup.other}
          </button>
        ))}
      <p class="muted small">{texts.radioSetup.pickHint}</p>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {viaDrive ? (
        <>
          {picker ? (
            <ol class="steps radio-steps">
              {texts.radioSetup.driveSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          ) : (
            <p>{texts.radioSetup.driveNoPicker}</p>
          )}
          <Button kind="main" disabled={!option} onClick={() => option && onInstall(option, !picker)}>
            {picker ? texts.radioSetup.driveInstall : texts.radioSetup.driveDownload}
          </Button>
          {picker && (
            <button type="button" class="link-btn small" disabled={!option} onClick={() => option && onInstall(option, true)}>
              {texts.radioSetup.driveDownloadInstead}
            </button>
          )}
        </>
      ) : canInstall ? (
        <Button kind="main" disabled={!option} onClick={() => option && onInstall(option, false)}>
          {texts.radioSetup.install}
        </Button>
      ) : (
        <Button kind="main" onClick={onAgain}>
          {texts.radioSetup.tryAgain}
        </Button>
      )}
    </div>
  )
}

/** Picture from radios.json (anynear.app); hidden if it does not load. */
function RadioPicture({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <span class="radio-picture radio-picture-empty" aria-hidden="true"><Icons.Radio size={28} /></span>
  return <img class="radio-picture" src={src} alt="" width="64" height="64" loading="lazy" onError={() => setFailed(true)} />
}

function Working({ text, progress }: { text: string; progress: number | null }) {
  return (
    <div class="card-pad radio-card" aria-live="polite">
      <p>
        <Spinner /> {text}
      </p>
      <progress class="radio-progress" max={1} value={progress ?? undefined} />
      <p class="muted small">{texts.radioSetup.keepPlugged}</p>
    </div>
  )
}

function Done() {
  return (
    <>
      <p>{texts.radioSetup.doneText}</p>
      <ol class="steps radio-steps">
        {texts.radioSetup.doneSteps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </>
  )
}
