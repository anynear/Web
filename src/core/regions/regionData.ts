// Area table as text, loaded only via loadRegionTable() (separate part of the web app). The CSV files are
// unchanged copies from the app (`shared/src/commonMain/composeResources/files/regions/`, `scripts/regions.py`).
export { default as kreise } from './kreise.csv?raw'
export { default as gemeinden } from './gemeinden.csv?raw'
