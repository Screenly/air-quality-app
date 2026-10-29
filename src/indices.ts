// The US and European air quality indices, from pollutant concentrations.
// Kept free of the Edge Apps library so it can be unit-tested without a DOM.

/** OpenWeather's component names for the six pollutants shown. */
export type Key = 'pm2_5' | 'pm10' | 'o3' | 'no2' | 'so2' | 'co'

/**
 * Piecewise-linear between breakpoints, for the European index: concentration
 * `at[i]` reads as index `to[i]`. Past the last breakpoint the last segment
 * carries on, so an extreme reading keeps climbing rather than sticking.
 */
export function interpolate(value: number, at: number[], to: number[]): number {
  if (value <= at[0]!) return to[0]!
  let i = 1
  while (i < at.length - 1 && value > at[i]!) i++
  const [c0, c1, i0, i1] = [at[i - 1]!, at[i]!, to[i - 1]!, to[i]!]
  return i0 + ((value - c0) / (c1 - c0)) * (i1 - i0)
}

/** μg/m³ to ppb at 25 °C and 1 atm, from the gas's molar mass in g/mol. */
function ppb(microgrammes: number, molarMass: number): number {
  return (microgrammes * 24.45) / molarMass
}

const MOLAR_MASS = { o3: 48.0, no2: 46.01, so2: 64.07, co: 28.01 }

/** One row of an EPA table: concentrations lo–hi read as index lo–hi. */
type Row = [cLo: number, cHi: number, iLo: number, iHi: number]

/**
 * The EPA's own calculation. The concentration is truncated to the table's
 * precision, then placed in the row whose range holds it. The rows are discrete
 * (PM2.5 9.0 is 50, 9.1 is 51), so a reading is never blended across two
 * categories. Past the last row its slope carries on.
 */
function epa(value: number, decimals: number, rows: Row[]): number {
  const scale = 10 ** decimals
  // The epsilon keeps a unit conversion landing on 69.99999 from truncating to 69.
  const c = Math.floor(value * scale + 1e-6) / scale
  const row = rows.find(([, cHi]) => c <= cHi) ?? rows[rows.length - 1]!
  const [cLo, cHi, iLo, iHi] = row
  return iLo + ((iHi - iLo) / (cHi - cLo)) * (Math.max(c, cLo) - cLo)
}

/**
 * US EPA breakpoints, from the AQS breakpoint table (PM2.5 as revised in
 * 2024). Gases are converted to ppb (CO to ppm) first.
 */
const US: Record<string, Row[]> = {
  // μg/m³, 24-hour mean, one decimal.
  pm2_5: [
    [0, 9, 0, 50],
    [9.1, 35.4, 51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 125.4, 151, 200],
    [125.5, 225.4, 201, 300],
    [225.5, 325.4, 301, 500],
  ],
  // μg/m³, 24-hour mean, whole numbers.
  pm10: [
    [0, 54, 0, 50],
    [55, 154, 51, 100],
    [155, 254, 101, 150],
    [255, 354, 151, 200],
    [355, 424, 201, 300],
    [425, 604, 301, 500],
  ],
  // ppb, 8-hour mean, up to Very unhealthy.
  o3_8h: [
    [0, 54, 0, 50],
    [55, 70, 51, 100],
    [71, 85, 101, 150],
    [86, 105, 151, 200],
    [106, 200, 201, 300],
  ],
  // ppb, hourly, from Unhealthy for sensitive groups upwards.
  o3_1h: [
    [125, 164, 101, 150],
    [165, 204, 151, 200],
    [205, 404, 201, 300],
    [405, 604, 301, 500],
  ],
  // ppb, hourly.
  no2: [
    [0, 53, 0, 50],
    [54, 100, 51, 100],
    [101, 360, 101, 150],
    [361, 649, 151, 200],
    [650, 1249, 201, 300],
    [1250, 2049, 301, 500],
  ],
  // ppb, hourly, up to Unhealthy.
  so2_1h: [
    [0, 35, 0, 50],
    [36, 75, 51, 100],
    [76, 185, 101, 150],
    [186, 304, 151, 200],
  ],
  // ppb, 24-hour mean, above that.
  so2_24h: [
    [305, 604, 201, 300],
    [605, 1004, 301, 500],
  ],
  // ppm, 8-hour mean, one decimal.
  co: [
    [0, 4.4, 0, 50],
    [4.5, 9.4, 51, 100],
    [9.5, 12.4, 101, 150],
    [12.5, 15.4, 151, 200],
    [15.5, 30.4, 201, 300],
    [30.5, 50.4, 301, 500],
  ],
}

/**
 * European Environment Agency bands as revised in 2024, on hourly values for
 * all five pollutants. Each band is 20 points wide; past Very poor (100) the
 * last band's slope carries on.
 */
const EUROPEAN = {
  index: [0, 20, 40, 60, 80, 100],
  pm2_5: [0, 5, 15, 50, 90, 140],
  pm10: [0, 15, 45, 120, 195, 270],
  o3: [0, 60, 100, 120, 160, 180],
  no2: [0, 10, 25, 60, 100, 150],
  so2: [0, 20, 40, 125, 190, 275],
}

/**
 * A pollutant's mean over the trailing hours ending at the hour being scored,
 * in μg/m³; 1 is that hour's own value. Null when none of those hours has one.
 */
export type Window = (key: Key, hours: number) => number | null

export function usIndex(key: Key, window: Window): number | null {
  switch (key) {
    case 'pm2_5': {
      const mean = window(key, 24)
      return mean === null ? null : epa(mean, 1, US.pm2_5!)
    }
    case 'pm10': {
      const mean = window(key, 24)
      return mean === null ? null : epa(mean, 0, US.pm10!)
    }
    case 'o3': {
      const hourly = window(key, 1)
      const mean = window(key, 8)
      if (hourly === null || mean === null) return null
      const h = ppb(hourly, MOLAR_MASS.o3)
      const m = ppb(mean, MOLAR_MASS.o3)
      const one = epa(h, 0, US.o3_1h!)
      // The 8-hour table stops at 200 ppb; above it only the hourly one applies.
      if (Math.floor(m + 1e-6) > 200) return one
      const eight = epa(m, 0, US.o3_8h!)
      // Below 125 ppb an hour, the hourly table does not apply.
      return Math.floor(h + 1e-6) >= 125 ? Math.max(eight, one) : eight
    }
    case 'no2': {
      const hourly = window(key, 1)
      return hourly === null
        ? null
        : epa(ppb(hourly, MOLAR_MASS.no2), 0, US.no2!)
    }
    case 'so2': {
      const hourly = window(key, 1)
      if (hourly === null) return null
      const h = ppb(hourly, MOLAR_MASS.so2)
      if (Math.floor(h + 1e-6) < 305) return epa(h, 0, US.so2_1h!)
      // From 305 ppb an hour, the EPA reads SO₂ on its 24-hour mean instead.
      const m = ppb(window(key, 24) ?? hourly, MOLAR_MASS.so2)
      return Math.floor(m + 1e-6) < 305 ? 200 : epa(m, 0, US.so2_24h!)
    }
    case 'co': {
      const mean = window(key, 8)
      return mean === null
        ? null
        : epa(ppb(mean, MOLAR_MASS.co) / 1000, 1, US.co!)
    }
  }
}

export function europeanIndex(key: Key, window: Window): number | null {
  if (key === 'co') return null
  const hourly = window(key, 1)
  return hourly === null
    ? null
    : interpolate(hourly, EUROPEAN[key], EUROPEAN.index)
}
