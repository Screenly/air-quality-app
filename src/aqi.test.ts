import { describe, expect, test } from 'bun:test'

import {
  bandFor,
  dominant,
  hourOf,
  localTime,
  readingFrom,
  requestUrls,
} from './aqi'

const HOUR = 3600
/** 2026-10-28 19:00 UTC. */
const NOW = Date.UTC(2026, 9, 28, 19) / 1000

function list(from: number, count: number, o3: number) {
  return Array.from({ length: count }, (_, i) => ({
    dt: from + i * HOUR,
    main: { aqi: 2 },
    components: { co: 200, no2: 10, o3, so2: 2, pm2_5: 4, pm10: 10, nh3: 1 },
  }))
}

const FORECAST = { list: list(NOW, 96, 140) }
const HISTORY = { list: list(NOW - 24 * HOUR, 24, 140) }

describe('bandFor', () => {
  test('US ceilings are inclusive', () => {
    expect(bandFor('us', 0).name).toBe('Good')
    expect(bandFor('us', 50).name).toBe('Good')
    expect(bandFor('us', 51).name).toBe('Moderate')
    expect(bandFor('us', 150).name).toBe('Unhealthy for sensitive groups')
    expect(bandFor('us', 301).name).toBe('Hazardous')
    expect(bandFor('us', 999).name).toBe('Hazardous')
  })

  test('European bands', () => {
    expect(bandFor('european', 20).name).toBe('Good')
    expect(bandFor('european', 21).name).toBe('Fair')
    expect(bandFor('european', 61).name).toBe('Poor')
    expect(bandFor('european', 140).name).toBe('Extremely poor')
  })
})

describe('readingFrom', () => {
  test('the reading is the forecast first hour, in local time', () => {
    const reading = readingFrom(FORECAST, HISTORY, 'us', 'UTC')
    expect(reading.time).toBe('2026-10-28T19:00')
    // 140 μg/m³ of ozone is 71.3 ppb on the 8-hour mean: 104.
    expect(reading.aqi).toBe(104)
    expect(reading.pollutants[2]).toEqual({
      label: 'O₃',
      value: 140,
      index: 104,
    })
  })

  test('forecast is 24 hours from the current hour', () => {
    const reading = readingFrom(FORECAST, HISTORY, 'us', 'UTC')
    expect(reading.forecast).toHaveLength(24)
    expect(reading.forecast[0]).toEqual({ time: '2026-10-28T19:00', aqi: 104 })
    expect(reading.forecast[23]!.time).toBe('2026-10-29T18:00')
  })

  test('forecast stops at a gap in the hours', () => {
    const gappy = { list: FORECAST.list.filter((_, i) => i !== 6) }
    expect(readingFrom(gappy, HISTORY, 'us', 'UTC').forecast).toHaveLength(6)
  })

  test('a missing or broken history still reads', () => {
    expect(readingFrom(FORECAST, null, 'us', 'UTC').aqi).toBe(104)
    expect(readingFrom(FORECAST, { cod: 401 }, 'us', 'UTC').aqi).toBe(104)
  })

  test('the 24-hour PM mean reaches back into the history', () => {
    const dirty = {
      list: list(NOW - 24 * HOUR, 24, 0).map((entry) => ({
        ...entry,
        components: { ...entry.components, pm2_5: 60 },
      })),
    }
    const reading = readingFrom(FORECAST, dirty, 'us', 'UTC')
    // 23 hours at 60 and one at 4: a mean of 57.7 μg/m³, Unhealthy.
    expect(reading.pollutants[0]!.index).toBe(152)
  })

  test('an error body is named, not dereferenced', () => {
    expect(() =>
      readingFrom({ cod: 401, message: 'Invalid API key' }, null, 'us', 'UTC'),
    ).toThrow('Invalid API key')
    expect(() => readingFrom('<html>', null, 'us', 'UTC')).toThrow(
      'no air quality data',
    )
  })

  test('an empty forecast is a failure, not a zero', () => {
    expect(() => readingFrom({ list: [] }, null, 'us', 'UTC')).toThrow(
      'no air quality for this position',
    )
  })

  test('a European reading has no CO sub-index', () => {
    const reading = readingFrom(FORECAST, HISTORY, 'european', 'UTC')
    expect(reading.pollutants[5]).toEqual({
      label: 'CO',
      value: 200,
      index: null,
    })
    expect(reading.aqi).toBe(70)
  })
})

test('localTime keeps a half-hour timezone', () => {
  expect(localTime(NOW, 'Asia/Kolkata')).toBe('2026-10-29T00:30')
  expect(localTime(NOW, 'America/Los_Angeles')).toBe('2026-10-28T12:00')
})

test('dominant is the highest sub-index', () => {
  expect(dominant(readingFrom(FORECAST, HISTORY, 'us', 'UTC'))?.label).toBe(
    'O₃',
  )
})

test('hourOf reads the wall-clock hour', () => {
  expect(hourOf('2026-10-28T07:00')).toBe(7)
})

test('requestUrls asks for the forecast and the day before it', () => {
  const urls = requestUrls(37.38612, -122.08394, 'k3y', NOW * 1000 + 1234)
  const forecast = new URL(urls.forecast)
  const history = new URL(urls.history)
  expect(forecast.pathname).toBe('/data/2.5/air_pollution/forecast')
  expect(forecast.searchParams.get('lat')).toBe('37.3861')
  expect(forecast.searchParams.get('appid')).toBe('k3y')
  expect(history.pathname).toBe('/data/2.5/air_pollution/history')
  expect(history.searchParams.get('end')).toBe(String(NOW))
  expect(history.searchParams.get('start')).toBe(String(NOW - 24 * HOUR))
})
