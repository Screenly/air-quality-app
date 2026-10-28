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

/** The pollutants shown, in Open-Meteo's own field names. */
export const POLLUTANTS = [
  { key: 'pm2_5', label: 'PM2.5' },
  { key: 'pm10', label: 'PM10' },
  { key: 'ozone', label: 'O₃' },
  { key: 'nitrogen_dioxide', label: 'NO₂' },
  { key: 'sulphur_dioxide', label: 'SO₂' },
  { key: 'carbon_monoxide', label: 'CO' },
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
  /** Local wall-clock time of the reading, as Open-Meteo writes it: 2026-10-28T19:00. */
  time: string
  aqi: number
  pollutants: Pollutant[]
  /** The next 24 hours of the index, starting at the reading's own hour. */
  forecast: { time: string; aqi: number }[]
}

/** The index field for a scale, and its per-pollutant sub-index fields. */
function indexField(scale: Scale, pollutant?: string): string {
  const base = scale === 'us' ? 'us_aqi' : 'european_aqi'
  return pollutant ? `${base}_${pollutant}` : base
}

/**
 * The European index has no CO sub-index, and Open-Meteo rejects the whole
 * request if one field in it is unknown, so it is never asked for.
 */
function hasSubIndex(scale: Scale, pollutant: string): boolean {
  return scale === 'us' || pollutant !== 'carbon_monoxide'
}

export function requestUrl(
  lat: number,
  lng: number,
  scale: Scale,
  apiKey: string,
): string {
  const current = [
    indexField(scale),
    ...POLLUTANTS.map((p) => p.key),
    ...POLLUTANTS.filter((p) => hasSubIndex(scale, p.key)).map((p) =>
      indexField(scale, p.key),
    ),
  ]
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    current: current.join(','),
    hourly: indexField(scale),
    timezone: 'auto',
    forecast_days: '2',
  })
  // The free API is non-commercial only; a paid key moves to the customer host.
  const host = apiKey
    ? 'customer-air-quality-api.open-meteo.com'
    : 'air-quality-api.open-meteo.com'
  if (apiKey) params.set('apikey', apiKey)
  return `https://${host}/v1/air-quality?${params}`
}

interface Response {
  current: Record<string, unknown> & { time: string }
  hourly: Record<string, unknown> & { time: string[] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * What comes back off the wire is unknown, so it is narrowed rather than
 * asserted. This checks the envelope only — enough to tell a reading from an
 * error body like {"error":true,"reason":"..."}.
 */
function hasEnvelope(value: unknown): value is Response {
  if (!isRecord(value)) return false
  const { current, hourly } = value
  return (
    isRecord(current) &&
    typeof current.time === 'string' &&
    isRecord(hourly) &&
    Array.isArray(hourly.time)
  )
}

/** Turns a response into a Reading, or throws saying what was wrong with it. */
export function readingFrom(response: unknown, scale: Scale): Reading {
  if (!hasEnvelope(response)) {
    const reason =
      isRecord(response) && typeof response.reason === 'string'
        ? `: ${response.reason}`
        : ''
    throw new Error(`Open-Meteo returned no air quality reading${reason}`)
  }
  const { current, hourly } = response

  const aqi = numberOrNull(current[indexField(scale)])
  if (aqi === null) {
    throw new Error(`Open-Meteo has no ${scaleLabel(scale)} for this position`)
  }

  const pollutants = POLLUTANTS.map((p) => ({
    label: p.label,
    value: numberOrNull(current[p.key]),
    index: hasSubIndex(scale, p.key)
      ? numberOrNull(current[indexField(scale, p.key)])
      : null,
  }))

  const hourlyIndex = hourly[indexField(scale)]
  const hourlyValues: unknown[] = Array.isArray(hourlyIndex) ? hourlyIndex : []
  // Hourly slots are on the hour, but in a half-hour timezone such as India's
  // the current reading is stamped :30. Start from the slot it falls in.
  const hour = current.time.slice(0, 13)
  const start = hourly.time.findIndex(
    (time) => typeof time === 'string' && time.slice(0, 13) === hour,
  )
  const forecast: Reading['forecast'] = []
  if (start >= 0) {
    for (let i = start; i < hourly.time.length && forecast.length < 24; i++) {
      const value = numberOrNull(hourlyValues[i])
      const time = hourly.time[i]
      if (value === null || typeof time !== 'string') break
      forecast.push({ time, aqi: value })
    }
  }

  return { time: current.time, aqi, pollutants, forecast }
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

/** The hour in an Open-Meteo local time string, 0–23. */
export function hourOf(time: string): number {
  return Number(time.slice(11, 13))
}
