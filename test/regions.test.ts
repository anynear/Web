import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RegionTable, loadRegionTable, regionView } from '../src/core/regions'

// District for the approximate location with the real table from src/core/regions (copy from the app), the same places
// as RegionTableTest of the app.
const dir = new URL('../src/core/regions/', import.meta.url)
const table = RegionTable.parse(readFileSync(new URL('kreise.csv', dir), 'utf8'), readFileSync(new URL('gemeinden.csv', dir), 'utf8'))
const kreis = (lat: number, lon: number) => table.nearest(lat, lon)?.kreis ?? null

describe('Gebietstabelle', () => {
  it('hat alle Kreise Deutschlands', () => {
    expect(table.size).toBeGreaterThan(10_000)
    expect(table.nearest(50.1106, 8.6821)?.name).toBe('Frankfurt am Main')
    expect(table.nearest(50.0546, 8.6953)?.name).toBe('Landkreis Offenbach') // Municipality centre from gemeinden.csv, just beyond the city limits of Frankfurt
  })

  it('bekannte Orte ergeben ihren Kreis', () => {
    expect(kreis(50.1106, 8.6821)).toBe('06412') // Frankfurt, Römer
    expect(kreis(48.1374, 11.5755)).toBe('09162') // Munich, Marienplatz
    expect(kreis(52.5163, 13.3777)).toBe('11000') // Berlin, Brandenburger Tor
    expect(kreis(53.5503, 9.992)).toBe('02000') // Hamburg, town hall
    expect(kreis(54.1817, 7.8857)).toBe('01056') // Heligoland (district of Pinneberg), 40 km off the coast
  })

  it('an der Grenze entscheidet der nächste Mittelpunkt', () => {
    expect(kreis(50.108, 8.72)).toBe('06412')
    expect(kreis(50.108, 8.725)).toBe('06413')
  })

  it('außerhalb Deutschlands kein Kreis', () => {
    expect(kreis(40.4168, -3.7038)).toBeNull() // Madrid
    expect(kreis(48.8566, 2.3522)).toBeNull() // Paris
    // Basel lies less than 5 km from the centre of a municipality in the district of Lörrach.
    expect(kreis(47.5596, 7.5886)).toBe('08336')
  })

  it('lädt erst bei Bedarf, aus demselben Text', async () => {
    const loaded = await loadRegionTable()
    expect(loaded.size).toBe(table.size)
    expect(loaded.nearest(50.1106, 8.6821)).toEqual({ kreis: '06412', name: 'Frankfurt am Main' })
  })
})

describe('Hinweis zum Kreis', () => {
  const frankfurt = { kreis: '06412', name: 'Frankfurt am Main' }

  it('mit Kreis der Name, sonst der Grund und ein Knopf', () => {
    expect(regionView(frankfurt, 'denied', 'failed')).toBe('region')
    expect(regionView(null, 'prompt', 'idle')).toBe('needsLocation')
    expect(regionView(null, 'unknown', 'idle')).toBe('needsLocation')
    expect(regionView(null, 'denied', 'idle')).toBe('blocked')
    expect(regionView(null, 'granted', 'idle')).toBe('searching')
    expect(regionView(null, 'prompt', 'busy')).toBe('searching')
    expect(regionView(null, 'granted', 'failed')).toBe('failed')
    expect(regionView(null, 'granted', 'abroad')).toBe('abroad')
  })
})
