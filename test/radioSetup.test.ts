import { describe, expect, it } from 'vitest'
import { isNoPortChosen, isRadioPath, modelLabel, pickRadiosText, PortLine, type SerialPortLike, uf2FileName, writeToDrive } from '../src/core/radioSetup'
import { RADIOS_FALLBACK } from '../src/core/radiosFallback'

/** Serial port in memory: what the page writes lands in `written`, `send` plays bytes from the radio. */
function fakePort() {
  const opens: number[] = []
  const signals: { dataTerminalReady?: boolean; requestToSend?: boolean }[] = []
  const written: number[][] = []
  let push: ((b: Uint8Array) => void) | null = null
  let readable: ReadableStream<Uint8Array> | null = null
  let writable: WritableStream<Uint8Array> | null = null
  let open = false
  const port: SerialPortLike = {
    async open({ baudRate }) {
      if (open) throw new Error('schon offen')
      open = true
      opens.push(baudRate)
      readable = new ReadableStream<Uint8Array>({ start: (c) => void (push = (b) => c.enqueue(b)) })
      writable = new WritableStream<Uint8Array>({ write: (b) => void written.push([...b]) })
    },
    async close() {
      if (readable?.locked || writable?.locked) throw new Error('noch gesperrt')
      open = false
      readable = null
      writable = null
    },
    get readable() {
      return readable
    },
    get writable() {
      return writable
    },
    async setSignals(s) {
      signals.push(s)
    },
    getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
  }
  return { port, opens, signals, written, send: (b: number[]) => push?.(new Uint8Array(b)), isOpen: () => open }
}

describe('Adresse der Seite', () => {
  it('erkennt /radio und /funkgeraet, auch mit Schrägstrich am Ende', () => {
    expect(isRadioPath('/radio')).toBe(true)
    expect(isRadioPath('/Radio/')).toBe(true)
    expect(isRadioPath('/funkgeraet')).toBe(true)
    expect(isRadioPath('/funkgeraet/')).toBe(true)
    expect(isRadioPath('/')).toBe(false)
    expect(isRadioPath('/a')).toBe(false)
  })
})

describe('PortLine (WebSerialLine für den ROM-Lader)', () => {
  it('schreibt Int8Array als Bytes', async () => {
    const f = fakePort()
    const line = new PortLine(f.port)
    await line.open(115200)
    await line.write(new Int8Array([-64, 1, 127]))
    expect(f.written).toEqual([[0xc0, 1, 127]])
    await line.close()
  })

  it('liefert Angekommenes gesammelt und nach Zeitablauf ein leeres Array', async () => {
    const f = fakePort()
    const line = new PortLine(f.port)
    await line.open(115200)
    expect((await line.read(20)).length).toBe(0)
    f.send([1, 2])
    f.send([3])
    await new Promise((r) => setTimeout(r, 5))
    expect([...(await line.read(20))]).toEqual([1, 2, 3])
    const waiting = line.read(500)
    f.send([9])
    expect([...(await waiting)]).toEqual([9])
    await line.close()
    expect(f.isOpen()).toBe(false)
  })

  it('wechselt die Geschwindigkeit durch Schließen und neues Öffnen', async () => {
    const f = fakePort()
    const line = new PortLine(f.port)
    await line.open(115200)
    await line.setBaud(460800)
    expect(f.opens).toEqual([115200, 460800])
    await line.write(new Int8Array([5]))
    f.send([6])
    expect([...(await line.read(200))]).toEqual([6])
    await line.close()
  })

  it('setzt DTR und RTS wie verlangt', async () => {
    const f = fakePort()
    const line = new PortLine(f.port)
    await line.setSignals(false, true)
    expect(f.signals).toEqual([{ dataTerminalReady: false, requestToSend: true }])
  })
})

describe('radios.json', () => {
  const valid = (t: string) => {
    try {
      return Array.isArray(JSON.parse(t).radios)
    } catch {
      return false
    }
  }
  const memory = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
  }

  it('nimmt die frische Fassung und merkt sie sich', () => {
    const store = memory()
    const fresh = '{"version":1,"radios":[]}'
    expect(pickRadiosText(fresh, valid, store, RADIOS_FALLBACK)).toBe(fresh)
    expect(pickRadiosText(null, valid, store, RADIOS_FALLBACK)).toBe(fresh)
  })

  it('fällt auf die mitgelieferte Kopie zurück, wenn nichts geht', () => {
    expect(pickRadiosText('<html>404</html>', valid, memory(), RADIOS_FALLBACK)).toBe(RADIOS_FALLBACK)
    expect(pickRadiosText(null, valid, null, RADIOS_FALLBACK)).toBe(RADIOS_FALLBACK)
  })

  it('die Kopie enthält die drei getesteten Geräte', () => {
    const radios = JSON.parse(RADIOS_FALLBACK).radios.map((r: { hw_model: string }) => r.hw_model)
    expect(radios).toEqual(['HELTEC_V3', 'TRACKER_T1000_E', 'SEEED_SOLAR_NODE'])
  })
})

describe('Kleinigkeiten', () => {
  it('Modellname ohne Eintrag', () => {
    expect(modelLabel('TRACKER_T1000_E')).toBe('TRACKER T1000 E')
  })

  it('Dateiname fürs Laufwerk', () => {
    expect(uf2FileName('https://meshtastic.github.io/firmware-2.7.26/firmware-tracker-t1000-e-2.7.26.uf2')).toBe('firmware-tracker-t1000-e-2.7.26.uf2')
    expect(uf2FileName('https://example.invalid/x?y=1')).toBe('firmware.uf2')
  })

  it('Abbruch der Geräteauswahl', () => {
    expect(isNoPortChosen(new DOMException('No port selected by the user.', 'NotFoundError'))).toBe(true)
    expect(isNoPortChosen(new DOMException('Failed to open serial port.', 'NetworkError'))).toBe(false)
  })
})

describe('writeToDrive', () => {
  const drive = (fail: { write?: boolean; close?: boolean } = {}) => {
    const parts: number[] = []
    return {
      parts,
      dir: {
        getFileHandle: async () => ({
          createWritable: async () => ({
            write: async (d: Uint8Array) => {
              if (fail.write) throw new Error('weg')
              parts.push(d.length)
            },
            close: async () => {
              if (fail.close) throw new Error('Laufwerk verschwunden')
            },
          }),
        }),
      },
    }
  }

  it('schreibt in Stücken mit Fortschritt', async () => {
    const d = drive()
    const progress: number[] = []
    expect(await writeToDrive(d.dir, 'a.uf2', new Uint8Array(150 * 1024), (p) => progress.push(p))).toBe(true)
    expect(d.parts.reduce((a, b) => a + b, 0)).toBe(150 * 1024)
    expect(progress.at(-1)).toBe(1)
  })

  it('verschwindet das Laufwerk erst nach dem letzten Byte, gilt es als fertig', async () => {
    expect(await writeToDrive(drive({ close: true }).dir, 'a.uf2', new Uint8Array(10), () => {})).toBe(true)
    expect(await writeToDrive(drive({ write: true }).dir, 'a.uf2', new Uint8Array(10), () => {})).toBe(false)
  })
})
