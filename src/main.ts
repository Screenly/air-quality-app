import './style.css'
import {
  getSettingWithDefault,
  readEdgeAppCache,
  reportError,
  setupErrorHandling,
  setupSentry,
  signalReady,
  writeEdgeAppCache,
} from '@screenly/edge-apps'
import tzlookup from '@photostructure/tz-lookup'

import {
  bandFor,
  dominant,
  hourOf,
  readingFrom,
  reasonOf,
  requestUrls,
  scaleLabel,
  type Reading,
  type Scale,
} from './aqi'
import { placeLabel, resolveLocale, resolvePosition } from './place'
import stateTiles from './states.json'
import worldSvg from './world.svg?raw'

/** The last good reading, and the position and index it was taken for. */
interface Cached {
  lat: number
  lng: number
  scale: Scale
  reading: Reading
}

const CACHE_NAMESPACE = 'air-quality-app'
const CACHE_KEY = 'reading'

const RADIANS = Math.PI / 180
const KM_PER_DEGREE = 111

/** How much of the region around the screen the map shows, edge to edge. */
const VIEW_KM = 700

// Looked up in start(), not here. This file is bundled as a classic script and
// inlined into <head>, so module scope runs before <body> exists — resolving
// these eagerly would leave them null.
let stage!: HTMLElement
let map!: HTMLElement
let world!: SVGSVGElement

/** Where the screen itself is. The map is centred on it. */
let screenLat = NaN
let screenLng = NaN

/** How numbers and hours are written. Labels stay in English. */
let locale = 'en'

/** The screen's own timezone. OpenWeather times are UTC. */
let timeZone = 'UTC'

let apiKey = ''

let scale: Scale = 'us'

let west = 0
let east = 0
let north = 0
let south = 0

function say(id: string, text: string): void {
  document.getElementById(id)!.textContent = text
}

/** The screen's height over its width — the map window is fitted to it. */
function shape(): number {
  return map.clientHeight / map.clientWidth
}

/**
 * Where "you" sit in the view, as a fraction across and down. On a landscape
 * screen the readout takes the right half, so you sit left of it; on a portrait
 * one it takes the top, so you sit below it.
 */
function youAt(): { across: number; down: number } {
  return shape() < 1
    ? { across: 0.27, down: 0.45 }
    : { across: 0.5, down: 0.72 }
}

function frame(): void {
  const { across, down } = youAt()
  // 1/cos(latitude) runs to infinity at the poles; the world is only 360° round.
  const wide = Math.min(
    VIEW_KM / KM_PER_DEGREE / Math.cos(screenLat * RADIANS),
    360,
  )
  const high = (VIEW_KM / KM_PER_DEGREE) * shape()
  west = screenLng - wide * across
  east = west + wide
  north = screenLat + high * down
  south = north - high
  world.setAttribute('viewBox', `${west} ${-north} ${wide} ${high}`)
}

function graticule(): void {
  let step = 0.2
  for (const choice of [20, 10, 5, 2, 1, 0.5]) {
    if (choice <= (north - south) / 6) step = Math.max(step, choice)
  }
  let d = ''
  for (let lng = Math.ceil(west / step) * step; lng < east; lng += step) {
    d += `M${lng} ${-north}V${-south}`
  }
  for (let lat = Math.ceil(south / step) * step; lat < north; lat += step) {
    d += `M${west} ${-lat}H${east}`
  }
  document.getElementById('graticule')!.setAttribute('d', d)
}

/**
 * State and province boundaries, from the 10° tiles under the window only, so
 * an inland view (Delhi, Madrid, Denver) is not a blank sheet of land. A view
 * stretched wide near a pole gets none — at that scale they are noise. Tiles
 * past the antimeridian are not wrapped, so a view across it loses the far
 * side's.
 */
function states(): void {
  const tile = 10
  const widest = 60
  const tiles = stateTiles as Record<string, string>
  let d = ''
  if (east - west <= widest) {
    for (let lng = Math.floor(west / tile) * tile; lng < east; lng += tile) {
      for (
        let lat = Math.floor(south / tile) * tile;
        lat < north;
        lat += tile
      ) {
        d += tiles[`${lng},${lat}`] ?? ''
      }
    }
  }
  document.getElementById('states')!.setAttribute('d', d)
}

function drawMap(): void {
  frame()
  graticule()
  states()
  const you = document.getElementById('you')!
  you.style.left = `${((screenLng - west) / (east - west)) * 100}%`
  you.style.top = `${((north - screenLat) / (north - south)) * 100}%`
}

function formatNumber(value: number, digits: number): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

/**
 * A local time, already in the screen's own timezone, written as an
 * hour. Formatted as UTC so the player's clock zone cannot shift it again.
 */
function formatHour(time: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, 0, 1, hourOf(time))))
}

function degrees(value: number, positive: string, negative: string): string {
  return `${formatNumber(Math.abs(value), 3)}° ${value < 0 ? negative : positive}`
}

/** Element with a class and, optionally, text — the readout is built from these. */
function el(className: string, text = ''): HTMLDivElement {
  const div = document.createElement('div')
  div.className = className
  div.textContent = text
  return div
}

function drawPollutants(reading: Reading): void {
  const main = dominant(reading)
  const cells = reading.pollutants.map((pollutant) => {
    const cell = el(pollutant === main ? 'pollutant main' : 'pollutant')
    const label = el('label', pollutant.label)
    if (pollutant.index !== null) {
      label.style.setProperty('--tone', bandFor(scale, pollutant.index).color)
    }
    const value =
      pollutant.value === null
        ? '—'
        : formatNumber(pollutant.value, pollutant.value < 10 ? 1 : 0)
    const amount = el('v', value)
    amount.append(el('u', 'μg/m³'))
    cell.append(label, amount)
    return cell
  })
  document.getElementById('pollutants')!.replaceChildren(...cells)
}

function drawForecast(reading: Reading): void {
  const forecast = document.getElementById('forecast')!
  forecast.hidden = reading.forecast.length < 2
  if (forecast.hidden) return

  const values = reading.forecast.map((hour) => hour.aqi)
  // The bars are drawn against the top of the Moderate band at least, so a run
  // of Good hours reads as low rather than filling the chart.
  const ceiling = Math.max(...values, bandFor(scale, 0).max * 2)
  const bars = reading.forecast.map((hour) => {
    const bar = el('bar')
    bar.style.height = `${Math.max((hour.aqi / ceiling) * 100, 3)}%`
    bar.style.background = bandFor(scale, hour.aqi).color
    return bar
  })
  document.getElementById('bars')!.replaceChildren(...bars)

  const hours = reading.forecast.map((hour, i) =>
    el('hour', i === 0 ? 'Now' : i % 6 === 0 ? formatHour(hour.time) : ''),
  )
  document.getElementById('hours')!.replaceChildren(...hours)

  const peak = reading.forecast.reduce((a, b) => (b.aqi > a.aqi ? b : a))
  say(
    'peak',
    peak === reading.forecast[0]
      ? ''
      : ` · peak ${formatNumber(peak.aqi, 0)} at ${formatHour(peak.time)}`,
  )
}

function show(reading: Reading): void {
  stage.className = ''
  const band = bandFor(scale, reading.aqi)
  stage.style.setProperty('--band', band.color)

  say('asof', `as of ${formatHour(reading.time)}`)
  say('scale', scaleLabel(scale))
  say('aqi', formatNumber(reading.aqi, 0))
  say('category', band.name)
  say('advice', band.advice)
  drawPollutants(reading)
  drawForecast(reading)
  drawMap()
}

/**
 * The diagram's Abort terminal. `screenly.signalAbort()` does not exist yet
 * (Phorge T10903), so until it does we say what happened and let the ready
 * signal through — an app that never signals stalls the playlist for 60s and
 * is then dropped with PlaybackReason::LoadTimeout.
 */
function abort(): void {
  stage.className = 'unavailable'
  say('lede', 'Air quality')
  say('where', 'Unavailable')
  say('coord', 'OpenWeather could not be reached and nothing is cached')
}

/** Fetches JSON, and throws with OpenWeather's own reason on a non-2xx. */
async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  // OpenWeather puts the reason for a 401 or 429 in the body, so it is read either way.
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`OpenWeather returned ${response.status}${reasonOf(body)}`)
  }
  return body
}

/**
 * Where the reading comes from, and nothing else. The try covers the fetch and
 * the parse only: a fault in the drawing is not a fetch failure and must not
 * be answered by falling back to cache.
 */
async function current(): Promise<Reading | null> {
  // The screenshotter gives the page 10s to go quiet and then up to 10s more
  // for the ready signal. Time the request out well inside that, so a hanging
  // API still leaves room to fall back to cache, draw, and signal.
  const fetchTimeoutMs = 8000
  let reading: Reading
  try {
    const urls = requestUrls(screenLat, screenLng, apiKey, Date.now())
    // OpenWeather sends Access-Control-Allow-Origin: *, so no CORS proxy. The
    // history only sharpens the averages, so its failure is not the reading's.
    const [forecast, history] = await Promise.all([
      getJson(urls.forecast, fetchTimeoutMs),
      getJson(urls.history, fetchTimeoutMs).catch(() => null),
    ])
    reading = readingFrom(forecast, history, scale, timeZone)
  } catch (thrown) {
    const error = thrown instanceof Error ? thrown : new Error(String(thrown))
    reportError(error, { source: 'openweather' })
    if (getSettingWithDefault<boolean>('display_errors', false)) throw error
    // A reading only means something for the place and index it was taken for.
    const cached = readEdgeAppCache<Cached>(CACHE_NAMESPACE, CACHE_KEY)
    if (
      cached?.lat === screenLat &&
      cached?.lng === screenLng &&
      cached?.scale === scale
    ) {
      return cached.reading
    }
    return null
  }
  // Outside the catch on purpose. writeEdgeAppCache swallows its own failures,
  // so this cannot throw, and if that ever changes a cache fault should surface
  // rather than send a good reading back through the failure path.
  const cached: Cached = { lat: screenLat, lng: screenLng, scale, reading }
  writeEdgeAppCache(CACHE_NAMESPACE, CACHE_KEY, cached)
  return reading
}

/**
 * The approved failure-mode algorithm. A missing key is caught in start(),
 * before any fetch; a rejected one is just another failed fetch.
 *
 *   fetch -> ok        : cache it, show it
 *         -> failed    : display_errors ? show the error
 *                                       : cached ? show that : abort
 */
async function load(): Promise<void> {
  const reading = await current()
  if (reading) show(reading)
  else abort()
}

async function start(): Promise<void> {
  // The manifest offers a sentry_dsn setting; without this call it does
  // nothing. No DSN set means setupSentry returns immediately.
  setupSentry('air-quality-app')
  setupErrorHandling()

  stage = document.getElementById('stage') as HTMLElement
  map = document.getElementById('map') as HTMLElement
  map.insertAdjacentHTML('afterbegin', worldSvg)
  world = document.querySelector<SVGSVGElement>('#world')!

  locale = resolveLocale()
  scale =
    getSettingWithDefault<string>('aqi_scale', 'us') === 'european'
      ? 'european'
      : 'us'

  // The bridge hands coordinates over as strings; `+` on a string silently
  // poisons every sum downstream, so they are converted on the way in.
  const position = resolvePosition()
  if (!position) {
    stage.className = 'unlocated'
    say('lede', 'This screen')
    say('where', 'No location set')
    say('coord', 'Add one in Screenly and the reading will follow')
    signalReady()
    return
  }

  screenLat = position.lat
  screenLng = position.lng
  try {
    timeZone = tzlookup(screenLat, screenLng)
  } catch {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  }

  say('where', await placeLabel(position))
  say(
    'coord',
    `${degrees(screenLat, 'N', 'S')}, ${degrees(screenLng, 'E', 'W')}`,
  )
  window.addEventListener('resize', () => {
    if (!stage.className) drawMap()
  })

  // Without a key there is nothing to ask for. Said on screen, not thrown:
  // it is a setting to fill in, not a fault.
  apiKey = getSettingWithDefault<string>('openweathermap_api_key', '').trim()
  if (!apiKey) {
    stage.className = 'unconfigured'
    say('lede', 'Air quality')
    say('where', 'API key needed')
    say('coord', 'Add an OpenWeather API key in the app settings')
    signalReady()
    return
  }

  await load()
  signalReady()

  // OpenWeather's model updates hourly. Each refresh is two calls, so half an
  // hour is ~2,900 calls a month a screen: a free key (1,000,000) covers ~340.
  const refreshMs = 30 * 60 * 1000
  setInterval(() => void load(), refreshMs)
}

document.addEventListener('DOMContentLoaded', () => void start())
