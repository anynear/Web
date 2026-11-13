// District for the approximate location for official warnings, as in the app (alerts/Regions.kt): all in the browser,
// without a service on the internet. The table lives under `regions/` (copy from the app, created with its
// `scripts/regions.py`; source in the README under licence) and is only loaded when it is needed.

/**
 * Area for official warnings: the district the browser is roughly in. [kreis] are the first 5 digits of the
 * official regional key (e.g. `06412` Frankfurt am Main), [name] is there only for display. Stays in the browser.
 */
export interface AlertRegion {
  kreis: string
  name: string
}

/** Search for the district: running, done (or not started yet), location not available, outside Germany. */
export type Locating = 'idle' | 'busy' | 'failed' | 'abroad'

/** What is shown under „Amtliche Warnungen“; without a district the web app shows and reports no official warning. */
export type RegionView = 'region' | 'searching' | 'needsLocation' | 'blocked' | 'failed' | 'abroad'

/** [permission]: answer of the Permissions API, `unknown` without it. */
export function regionView(region: AlertRegion | null, permission: PermissionState | 'unknown', locating: Locating): RegionView {
  if (region) return 'region'
  if (locating === 'busy') return 'searching'
  if (permission === 'denied') return 'blocked'
  if (locating === 'failed' || locating === 'abroad') return locating
  // Right after allowing, the search is not running yet: then too "searching".
  return permission === 'granted' ? 'searching' : 'needsLocation'
}

/** No place in Germany lies further away from the nearest municipality centre. */
export const MAX_DISTANCE_KM = 30

const MICRO = 1_000_000
const KM_PER_DEGREE = 111.2

/**
 * District of the municipality with the nearest centre. At a district border this can be off by one municipality; the
 * approximate location is only accurate to a few hundred metres up to a few kilometres anyway.
 */
export class RegionTable {
  private constructor(
    private readonly names: Map<string, string>,
    private readonly keys: string[],
    private readonly latitudes: Int32Array,
    private readonly longitudes: Int32Array,
  ) {}

  get size(): number {
    return this.keys.length
  }

  /** District for latitude and longitude in degrees (WGS 84); `null` outside Germany (beyond [MAX_DISTANCE_KM]). */
  nearest(latitude: number, longitude: number): AlertRegion | null {
    // At these distances the flat approximation suffices: degrees of longitude shrink with the cosine of the latitude.
    const shrink = Math.cos((latitude * Math.PI) / 180)
    const lat = latitude * MICRO
    const lon = longitude * MICRO
    let best = -1
    let bestDistance = Infinity
    for (let i = 0; i < this.keys.length; i++) {
      const dy = this.latitudes[i] - lat
      const dx = (this.longitudes[i] - lon) * shrink
      const d = dy * dy + dx * dx
      if (d < bestDistance) {
        bestDistance = d
        best = i
      }
    }
    if (best < 0 || (Math.sqrt(bestDistance) / MICRO) * KM_PER_DEGREE > MAX_DISTANCE_KM) return null
    const kreis = this.keys[best]
    return { kreis, name: this.names.get(kreis) ?? kreis }
  }

  /** From `kreise.csv` (`key;name`) and `gemeinden.csv` (`key;latitude;longitude` in millionths of a degree). */
  static parse(kreise: string, gemeinden: string): RegionTable {
    const names = new Map<string, string>()
    for (const line of kreise.split('\n')) {
      const i = line.indexOf(';')
      if (i > 0) names.set(line.slice(0, i), line.slice(i + 1).trim())
    }
    const rows = gemeinden.split('\n').filter((l) => l.trim())
    const keys: string[] = new Array(rows.length)
    const latitudes = new Int32Array(rows.length)
    const longitudes = new Int32Array(rows.length)
    rows.forEach((line, i) => {
      const [key, lat, lon] = line.split(';')
      keys[i] = key
      latitudes[i] = Number(lat)
      longitudes[i] = Number(lon)
    })
    return new RegionTable(names, keys, latitudes, longitudes)
  }
}

let table: Promise<RegionTable> | null = null

/** Table as a separate part of the web app, loaded only on first need (about 100 kB packed). */
export function loadRegionTable(): Promise<RegionTable> {
  table ??= import('./regions/regionData').then((d) => RegionTable.parse(d.kreise, d.gemeinden))
  table.catch(() => (table = null))
  return table
}
