import { europeanIndex, type Key, usIndex, type Window } from './indices'

export type Scale = 'us' | 'european'

/** One step of an index: everything up to `max` (inclusive) reads as `name`. */
export interface Band {
  max: number
  name: string
  /** Darkened from the official hue so it still reads on the paper. */
  color: string
  advice: string
}

/** US EPA categories. The index is whole numbers, so the ceilings are inclusive. */
const US_BANDS: Band[] = [
  {
    max: 50,
    name: 'Good',
    color: '#2e8540',
    advice: 'Air quality is satisfactory. A good day to be outside.',
  },
  {
    max: 100,
    name: 'Moderate',
    color: '#a87f00',
    advice:
      'Acceptable. Unusually sensitive people should ease off long exertion outdoors.',
  },
  {
    max: 150,
    name: 'Unhealthy for sensitive groups',
    color: '#d0661a',
    advice:
      'Children, older adults and people with heart or lung conditions should take it easier outdoors.',
  },
  {
    max: 200,
    name: 'Unhealthy',
    color: '#c62828',
    advice:
      'Everyone may feel the effects. Sensitive groups should avoid long exertion outdoors.',
  },
  {
    max: 300,
    name: 'Very unhealthy',
    color: '#7b3fa0',
    advice: 'Health alert. Everyone should limit time outdoors.',
  },
  {
    max: Infinity,
    name: 'Hazardous',
    color: '#7e0023',
    advice: 'Emergency conditions. Everyone should stay indoors.',
  },
]

/** European Environment Agency bands, general-population advice. */
const EUROPEAN_BANDS: Band[] = [
  {
    max: 20,
    name: 'Good',
    color: '#1f8f87',
    advice: 'The air quality is good. Enjoy your usual outdoor activities.',
  },
  {
    max: 40,
    name: 'Fair',
    color: '#2e8a6e',
    advice: 'Enjoy your usual outdoor activities.',
  },
  {
    max: 60,
    name: 'Moderate',
    color: '#a08c00',
    advice: 'Consider reducing intense outdoor activity if you have symptoms.',
  },
  {
    max: 80,
    name: 'Poor',
    color: '#d13b3b',
    advice:
      'Consider reducing physical activity, particularly outdoors, if you have symptoms.',
  },
  {
    max: 100,
    name: 'Very poor',
    color: '#960032',
    advice: 'Reduce physical activity, particularly outdoors.',
  },
  {
    max: Infinity,
    name: 'Extremely poor',
    color: '#7d2181',
    advice: 'Avoid outdoor activities.',
  },
]

export function bandFor(scale: Scale, value: number): Band {
  const bands = scale === 'us' ? US_BANDS : EUROPEAN_BANDS
  return bands.find((band) => value <= band.max) ?? bands[bands.length - 1]!
}

export function scaleLabel(scale: Scale): string {
  return scale === 'us' ? 'US AQI' : 'European AQI'
}

/** The pollutants shown, in OpenWeather's own component names. */
export const POLLUTANTS = [
  { key: 'pm2_5', label: 'PM2.5' },
  { key: 'pm10', label: 'PM10' },
  { key: 'o3', label: 'O₃' },
  { key: 'no2', label: 'NO₂' },
  { key: 'so2', label: 'SO₂' },
  { key: 'co', label: 'CO' },
] as const

export interface Pollutant {
  label: string
  /** Concentration in μg/m³, or null where the model has none. */
  value: number | null
  /** This pollutant's own sub-index, or null (the European index has no CO). */
  index: number | null
}

/** One reading, trimmed to what is drawn. Small enough to cache as is. */
export interface Reading {
  /** Local wall-clock time of the reading at the screen: 2026-10-28T19:00. */
  time: string
  aqi: number
  pollutants: Pollutant[]
  /** The next 24 hours of the index, starting at the reading's own hour. */
  forecast: { time: string; aqi: number }[]
}

const HOUR = 3600

/**
 * The two OpenWeather calls behind a reading. The forecast starts at the
 * current hour and runs about four days; the history is the day before it,
 * which the US index needs for its 8- and 24-hour averages.
 */
export function requestUrls(
  lat: number,
  lng: number,
  apiKey: string,
  nowMs: number,
): { forecast: string; history: string } {
  const hour = Math.floor(nowMs / 1000 / HOUR) * HOUR
  const base = 'https://api.openweathermap.org/data/2.5/air_pollution'
  const position = { lat: lat.toFixed(4), lon: lng.toFixed(4), appid: apiKey }
  const history = new URLSearchParams({
    ...position,
    start: String(hour - 24 * HOUR),
    end: String(hour),
  })
  return {
    forecast: `${base}/forecast?${new URLSearchParams(position)}`,
    history: `${base}/history?${history}`,
  }
}

/** One hour of concentrations, in μg/m³. */
interface Sample {
  /** Unix seconds, on the hour. */
  dt: number
  c: Record<Key, number | null>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** OpenWeather puts the reason for a failure in `message`. */
export function reasonOf(body: unknown): string {
  return isRecord(body) && typeof body.message === 'string'
    ? `: ${body.message}`
    : ''
}

/**
 * What comes back off the wire is unknown, so it is narrowed rather than
 * asserted. An error body such as {"cod":401,"message":"..."} has no list.
 */
function samplesFrom(body: unknown): Sample[] {
  if (!isRecord(body) || !Array.isArray(body.list)) {
    throw new Error(`OpenWeather returned no air quality data${reasonOf(body)}`)
  }
  const samples: Sample[] = []
  for (const entry of body.list as unknown[]) {
    if (!isRecord(entry) || !isRecord(entry.components)) continue
    const dt = numberOrNull(entry.dt)
    if (dt === null) continue
    const components = entry.components
    const c = Object.fromEntries(
      POLLUTANTS.map((p) => [p.key, numberOrNull(components[p.key])]),
    ) as Sample['c']
    samples.push({ dt, c })
  }
  return samples
}

/** Every pollutant's sub-index at series[at], whole numbers as published. */
function subIndices(
  series: Sample[],
  at: number,
  scale: Scale,
): Record<Key, number | null> {
  const now = series[at]!.dt
  // The mean of the hours in (now - hours, now] that have a value.
  const window: Window = (key, hours) => {
    let sum = 0
    let count = 0
    for (let i = at; i >= 0 && series[i]!.dt > now - hours * HOUR; i--) {
      const value = series[i]!.c[key]
      if (value === null) continue
      sum += value
      count++
    }
    return count ? sum / count : null
  }
  const of = scale === 'us' ? usIndex : europeanIndex
  return Object.fromEntries(
    POLLUTANTS.map((p) => {
      const value = of(p.key, window)
      return [p.key, value === null ? null : Math.round(value)]
    }),
  ) as Record<Key, number | null>
}

/** The overall index is the worst pollutant's. */
function overall(indices: Record<Key, number | null>): number | null {
  const values = Object.values(indices).filter((v) => v !== null)
  return values.length ? Math.max(...values) : null
}

/**
 * Unix seconds as wall-clock time at the screen: 2026-10-28T19:00. The rest of
 * the app reads hours off this string.
 */
export function localTime(dt: number, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(dt * 1000))
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

/**
 * Turns the forecast (and, when it came back, the history) into a Reading, or
 * throws saying what was wrong. The reading is the forecast's first hour.
 */
export function readingFrom(
  forecastBody: unknown,
  historyBody: unknown,
  scale: Scale,
  timeZone: string,
): Reading {
  const forecast = samplesFrom(forecastBody)
  if (!forecast.length) {
    throw new Error('OpenWeather has no air quality for this position')
  }
  // The history is a nice-to-have: without it the means cover fewer hours.
  let history: Sample[] = []
  try {
    if (historyBody !== null) history = samplesFrom(historyBody)
  } catch {
    history = []
  }

  const byHour = new Map<number, Sample>()
  for (const sample of [...history, ...forecast]) byHour.set(sample.dt, sample)
  const series = [...byHour.values()].sort((a, b) => a.dt - b.dt)
  const now = series.findIndex((sample) => sample.dt === forecast[0]!.dt)

  const indices = subIndices(series, now, scale)
  const aqi = overall(indices)
  if (aqi === null) {
    throw new Error(`OpenWeather has no ${scaleLabel(scale)} for this position`)
  }

  const current = series[now]!
  const pollutants = POLLUTANTS.map((p) => ({
    label: p.label,
    value: current.c[p.key],
    index: indices[p.key],
  }))

  const hourly: Reading['forecast'] = []
  for (let i = now; i < series.length && hourly.length < 24; i++) {
    // A gap in the hours would put the next bar at the wrong time.
    if (i > now && series[i]!.dt !== series[i - 1]!.dt + HOUR) break
    const value = i === now ? aqi : overall(subIndices(series, i, scale))
    if (value === null) break
    hourly.push({ time: localTime(series[i]!.dt, timeZone), aqi: value })
  }

  return {
    time: localTime(current.dt, timeZone),
    aqi,
    pollutants,
    forecast: hourly,
  }
}

/** The pollutant with the highest sub-index — the one driving the reading. */
export function dominant(reading: Reading): Pollutant | null {
  let worst: Pollutant | null = null
  for (const pollutant of reading.pollutants) {
    if (pollutant.index === null) continue
    if (!worst || pollutant.index > worst.index!) worst = pollutant
  }
  return worst
}

/** The hour in a local time string, 0–23. */
export function hourOf(time: string): number {
  return Number(time.slice(11, 13))
}
