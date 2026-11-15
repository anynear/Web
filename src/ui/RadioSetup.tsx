// „Funkgerät einrichten“ (ADR 0095): Meshtastic onto a radio on the USB cable, in Chrome or Edge on a computer
// (WebSerial). For people with an iPhone, whose app cannot use USB; the iOS app links to `/radio`. Same steps and
// texts as the USB setup of the app (RadioSoftwareTexts): connect, recognise, choose the model (recommended ones from
// radios.json with picture, the full list under „Anderes Meshtastic-fähiges Funkgerät“), install with progress.
// ESP32: written by the ROM loader of the core. nRF52 (T1000-E, Solar Node): the file goes onto the drive of the radio.
// Afterwards the app on the phone pairs and sets up the radio. A radio with Wi-Fi can instead be set up here as
// „Stationär im WLAN“ (ADR 0094 §3): radio profile, Wi-Fi and the gateway values go on over Meshtastic on the same
// cable, written by the core the same way as the app (`RadioWifiWeb`); the phone then finds it in the Wi-Fi.
import { useEffect, useRef, useState } from 'preact/hooks'
import { RadioSetupWeb, RadioWifiWeb, type WebEspLoader, type WebFirmwareList, type WebRadioCatalog, type WebRadioOption, type WebRadio, type WebRadioSelection, type WebSerialLine } from 'anmp-core'
import { texts } from '../i18n'
import { radioArea, radioAreaAt, radioAreas, radioGateway, radioSoftware } from '../core/session'
import { currentPosition, locationPermission } from '../core/channels'
import { local } from '../core/storage'
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
  type SerialPortLike,
  uf2FileName,
  writeToDrive,
} from '../core/radioSetup'
import { RADIOS_FALLBACK } from '../core/radiosFallback'
import { Button, Spinner } from './components'
import * as Icons from './icons'
import { pane } from './nav'

const setup = RadioSetupWeb.getInstance()
const wifiSetup = RadioWifiWeb.getInstance()
const lang = texts.dateLocale.startsWith('de') ? 'de' : 'en'
/** First speed of the ROM loader; the core switches to a faster one itself (setBaud). */
const ROM_BAUD = 115200
/** Speed of Meshtastic's serial API. */
const MESH_BAUD = 115200
const debug = (m: string) => console.debug('USB', m)

type Note = 'noPortChosen' | 'portFailed' | 'holdBoot' | 'noList' | null

type Step =
  | { kind: 'start'; note: Note }
  | { kind: 'connecting' }
  | { kind: 'choose'; sel: WebRadioSelection; unfit: WebRadio[]; viaDrive: boolean; error: string | null }
  | { kind: 'working'; text: string; progress: number | null }
  | { kind: 'downloaded' }
  | { kind: 'done' }
  | { kind: 'mode' }
  | { kind: 'wifi'; ssid: string; error: string | null }
  | { kind: 'wifiDone'; ssid: string; sure: boolean }

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
  const port = useRef<SerialPortLike | null>(null)

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
    let chosen: SerialPortLike
    try {
      chosen = await serial.requestPort({ filters: setup.portFilters() })
    } catch (e) {
      setStep({ kind: 'start', note: isNoPortChosen(e) ? 'noPortChosen' : 'portFailed' })
      return
    }
    port.current = chosen
    setStep({ kind: 'connecting' })
    const { catalog, list: software } = await basics.current!
    if (!software) {
      basics.current = null
      setStep({ kind: 'start', note: 'noList' })
      return
    }
    list.current = software
    const { usbVendorId = 0, usbProductId = 0 } = chosen.getInfo()
    const family = setup.usbFamily(usbVendorId, usbProductId)
    if (family === 'nrf52' || family === 'rp2040') {
      // Nothing over the serial line: the file goes onto the drive of the bootloader.
      const sel = setup.select(catalog, software, null, usbVendorId, usbProductId, null)
      setStep({ kind: 'choose', sel, unfit: unfitRadios(catalog, sel), viaDrive: true, error: null })
      return
    }
    const portLine = new PortLine(chosen)
    try {
      await portLine.open(ROM_BAUD)
    } catch {
      setStep({ kind: 'start', note: 'portFailed' })
      return
    }
    line.current = portLine
    const esp = await setup.connect(portLine as unknown as WebSerialLine, usbVendorId, debug).catch(() => null)
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
      await afterInstall()
      return
    }
    const error = result === 'download' ? texts.radioSetup.downloadFailed : result === 'unknown' ? texts.radioSetup.nothingFits : texts.radioSetup.installFailed
    if (result === 'write') {
      // The ROM loader may be gone after a failed write: the button now connects anew („Nochmal versuchen“).
      await release()
    }
    setStep({ kind: 'choose', sel, unfit, viaDrive: false, error })
  }

  /**
   * Meshtastic is on and starting: over the same cable, ask what the radio is. With Wi-Fi, ask how it is used (as the
   * app does after installing); otherwise, or if it does not answer, the phone does the rest as before.
   */
  async function afterInstall() {
    const p = port.current
    if (!p) return setStep({ kind: 'done' })
    setStep({ kind: 'working', text: texts.radioSetup.starting, progress: null })
    const l = new PortLine(p)
    try {
      await l.open(MESH_BAUD)
    } catch {
      return setStep({ kind: 'done' })
    }
    line.current = l
    const probe = await wifiSetup.probe(l as unknown as WebSerialLine, debug).catch(() => null)
    if (probe?.answered && probe.hasWifi) return setStep({ kind: 'mode' })
    await release()
    setStep({ kind: 'done' })
  }

  /** „Unterwegs“: nothing to write, the phone pairs over Bluetooth. */
  async function chooseMobile() {
    await release()
    setStep({ kind: 'done' })
  }

  /** „Stationär im WLAN“: radio profile, Wi-Fi and gateway values over the cable, then whether it got into the Wi-Fi. */
  async function setUpWifi(ssid: string, password: string, area: string | null) {
    const l = line.current
    if (!l) return setStep({ kind: 'start', note: null })
    const name = ssid.trim()
    setStep({ kind: 'working', text: texts.radioSetup.wifiWriting, progress: null })
    const gateway = await radioGateway()
    // Radio settings of the area (ADR 0054 §1b); without one the default of ADR 0006.
    const settings = area ? radioArea(area) : null
    const result = await wifiSetup.setUp(
      l as unknown as WebSerialLine,
      gateway,
      settings,
      name,
      password,
      (phase) => setStep({ kind: 'working', text: phase === 'network' ? texts.radioSetup.wifiJoining(name) : texts.radioSetup.wifiWriting, progress: null }),
      debug,
    ).catch(() => null)
    if (result?.kind === 'done' && result.wifi !== 'no') {
      await release()
      return setStep({ kind: 'wifiDone', ssid: name, sure: result.wifi === 'yes' })
    }
    const error = result?.kind === 'done' ? texts.radioSetup.wifiNotJoined : texts.radioSetup.wifiFailed
    setStep({ kind: 'wifi', ssid: name, error })
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
      case 'mode':
        return <Mode onMobile={() => void chooseMobile()} onStationary={() => setStep({ kind: 'wifi', ssid: '', error: null })} />
      case 'wifi':
        return <Wifi key={step.error ?? ''} ssid={step.ssid} error={step.error} onConnect={(ssid, password, area) => void setUpWifi(ssid, password, area)} />
      case 'wifiDone':
        return (
          <div class="card-pad radio-card">
            <h2 class="ok">{texts.radioSetup.wifiDoneTitle}</h2>
            <p>{step.sure ? texts.radioSetup.wifiDoneText(step.ssid) : texts.radioSetup.wifiDoneUnsure}</p>
            <ol class="steps radio-steps">
              {texts.radioSetup.wifiDoneSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <Button kind="secondary" onClick={() => setStep({ kind: 'start', note: null })}>
              {texts.radioSetup.again}
            </Button>
          </div>
        )
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

/** How the radio is used (ADR 0094 §3), with the honest note on power cuts before the choice. */
function Mode({ onMobile, onStationary }: { onMobile: () => void; onStationary: () => void }) {
  const [mode, setMode] = useState<'mobile' | 'stationary'>('mobile')
  const options = [
    { id: 'mobile' as const, name: texts.radioSetup.modeMobile, hint: texts.radioSetup.modeMobileHint },
    { id: 'stationary' as const, name: texts.radioSetup.modeStationary, hint: texts.radioSetup.modeStationaryHint },
  ]
  return (
    <div class="card-pad radio-card">
      <h2>{texts.radioSetup.modeTitle}</h2>
      <div class="radio-choices" role="radiogroup" aria-label={texts.radioSetup.modeTitle}>
        {options.map((o) => (
          <label key={o.id} class={`radio-choice radio-mode ${mode === o.id ? 'chosen' : ''}`}>
            <input type="radio" name="radio-mode" checked={mode === o.id} onChange={() => setMode(o.id)} />
            <span class="radio-choice-body">
              <span class="radio-choice-name">{o.name}</span>
              <span class="muted small">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {mode === 'stationary' && <p class="muted small">{texts.radioSetup.modePowerNote}</p>}
      <Button kind="main" onClick={mode === 'stationary' ? onStationary : onMobile}>
        {texts.radioSetup.modeNext}
      </Button>
    </div>
  )
}

/** Wi-Fi name and password; the password goes only onto the radio. */
/** Area chosen by hand (`null`: automatic) and the area found by location, per browser (ADR 0054 §1b). */
const AREA_CHOICE = 'radio.area.choice'
const AREA_LOCATED = 'radio.area.located'

function readArea(key: string): string | null {
  try {
    return local.get(key)
  } catch {
    return null
  }
}

function writeArea(key: string, value: string | null) {
  try {
    local.set(key, value)
  } catch {
    // Without storage the choice holds for this setup only.
  }
}

/**
 * Radio area for the setup: automatic by the approximate position (asked only on a click, or used if already allowed)
 * or one of the signed radio list. Without areas (no list) nothing shows and the default applies.
 */
function AreaPicker({ onArea }: { onArea: (area: string | null) => void }) {
  const [areas, setAreas] = useState<string[]>([])
  const [choice, setChoice] = useState<string | null>(readArea(AREA_CHOICE))
  const [located, setLocated] = useState<string | null>(readArea(AREA_LOCATED))
  const [busy, setBusy] = useState(false)

  async function locateArea() {
    setBusy(true)
    try {
      const pos = await currentPosition()
      const found = radioAreaAt(pos.coords.latitude, pos.coords.longitude, readArea(AREA_LOCATED))
      if (found) {
        setLocated(found)
        writeArea(AREA_LOCATED, found)
      }
    } catch {
      // Denied or no position: the known area stays.
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void radioAreas().then((list) => {
      setAreas(list)
      if (list.length > 0 && readArea(AREA_CHOICE) === null && locationPermission.peek() === 'granted') void locateArea()
    })
  }, [])

  const usable = (name: string | null) => (name && areas.includes(name) ? name : null)
  const effective = usable(choice) ?? usable(located)
  useEffect(() => onArea(effective), [effective])
  if (areas.length === 0) return null

  const label = effective ? radioArea(effective)?.label : null
  return (
    <div class="field">
      <label class="field">
        <span>{texts.radioSetup.radioArea}</span>
        <select
          class="input"
          value={usable(choice) ?? ''}
          onChange={(e) => {
            const v = e.currentTarget.value || null
            setChoice(v)
            writeArea(AREA_CHOICE, v)
          }}
        >
          <option value="">{texts.radioSetup.radioAreaAuto}</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <p class="muted small">
        {usable(choice) ? usable(choice) : texts.radioSetup.radioAreaAutoIs(usable(located))}
        {label ? ` · ${label}` : ''}
      </p>
      {!usable(choice) && (
        <button type="button" class="link-btn small" disabled={busy} onClick={() => void locateArea()}>
          {texts.radioSetup.radioAreaLocate}
        </button>
      )}
      <p class="muted small">{texts.radioSetup.radioAreaHint}</p>
    </div>
  )
}

function Wifi({ ssid: initial, error, onConnect }: { ssid: string; error: string | null; onConnect: (ssid: string, password: string, area: string | null) => void }) {
  const [ssid, setSsid] = useState(initial)
  const [password, setPassword] = useState('')
  const [area, setArea] = useState<string | null>(null)
  return (
    <form
      class="card-pad radio-card"
      onSubmit={(e) => {
        e.preventDefault()
        if (ssid.trim()) onConnect(ssid, password, area)
      }}
    >
      <p>{texts.radioSetup.wifiText}</p>
      <label class="field">
        <span>{texts.radioSetup.wifiName}</span>
        <input class="input" value={ssid} autoComplete="off" spellcheck={false} onInput={(e) => setSsid(e.currentTarget.value)} />
      </label>
      <label class="field">
        <span>{texts.radioSetup.wifiPassword}</span>
        <input class="input" type="password" value={password} autoComplete="off" onInput={(e) => setPassword(e.currentTarget.value)} />
      </label>
      <AreaPicker onArea={setArea} />
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <Button kind="main" type="submit" disabled={!ssid.trim()}>
        {texts.radioSetup.wifiConnect}
      </Button>
    </form>
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
