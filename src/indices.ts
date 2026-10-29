// The US and European air quality indices, from pollutant concentrations.
// Kept free of the Edge Apps library so it can be unit-tested without a DOM.

/** OpenWeather's component names for the six pollutants shown. */
export type Key = 'pm2_5' | 'pm10' | 'o3' | 'no2' | 'so2' | 'co'

/**
 * Piecewise-linear between breakpoints: concentration `at[i]` reads as index
 * `to[i]`. Past the last breakpoint the last segment carries on, so an
 * extreme reading keeps climbing rather than sticking at the ceiling.
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

/**
 * US EPA breakpoints, from the AQS breakpoint table (PM2.5 as revised in
 * 2024). Gases are converted to ppb (CO to ppm) first.
 */
const US = {
  index: [0, 50, 100, 150, 200, 300, 500],
  pm2_5: [0, 9, 35.4, 55.4, 125.4, 225.4, 325.4], // 24-hour mean
  pm10: [0, 54, 154, 254, 354, 424, 604], // 24-hour mean
  o3_8h: [0, 54, 70, 85, 105, 200], // ppb, 8-hour mean, up to Very unhealthy
  o3_1h: [125, 164, 204, 404, 604], // ppb, hourly, from USG upwards
  no2: [0, 53, 100, 360, 649, 1249, 2049], // ppb, hourly
  so2_1h: [0, 35, 75, 185, 304], // ppb, hourly, up to Unhealthy
  so2_24h: [304, 604, 1004], // ppb, 24-hour mean, above that
  co: [0, 4.4, 9.4, 12.4, 15.4, 30.4, 50.4], // ppm, 8-hour mean
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
  const { index } = US
  switch (key) {
    case 'pm2_5':
    case 'pm10': {
      const mean = window(key, 24)
      return mean === null ? null : interpolate(mean, US[key], index)
    }
    case 'o3': {
      const hourly = window(key, 1)
      const mean = window(key, 8)
      if (hourly === null || mean === null) return null
      const h = ppb(hourly, MOLAR_MASS.o3)
      const m = ppb(mean, MOLAR_MASS.o3)
      // The 8-hour table stops at 200 ppb; above it only the hourly one applies.
      const eight = m <= 200 ? interpolate(m, US.o3_8h, index) : 300
      const one = h >= 125 ? interpolate(h, US.o3_1h, index.slice(2)) : 0
      return Math.max(eight, one)
    }
    case 'no2': {
      const hourly = window(key, 1)
      return hourly === null
        ? null
        : interpolate(ppb(hourly, MOLAR_MASS.no2), US.no2, index)
    }
    case 'so2': {
      const hourly = window(key, 1)
      if (hourly === null) return null
      const h = ppb(hourly, MOLAR_MASS.so2)
      if (h < 305) return interpolate(h, US.so2_1h, index)
      // From 305 ppb an hour, the EPA reads SO₂ on its 24-hour mean instead.
      const m = ppb(window(key, 24) ?? hourly, MOLAR_MASS.so2)
      return m < 305 ? 200 : interpolate(m, US.so2_24h, index.slice(4))
    }
    case 'co': {
      const mean = window(key, 8)
      return mean === null
        ? null
        : interpolate(ppb(mean, MOLAR_MASS.co) / 1000, US.co, index)
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
