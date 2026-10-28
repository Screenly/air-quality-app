import { describe, expect, test } from 'bun:test'

import { bandFor, dominant, hourOf, readingFrom, requestUrl } from './aqi'

function hours(from: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const day = 28 + Math.floor((from + i) / 24)
    const hour = (from + i) % 24
    return `2026-10-${day}T${String(hour).padStart(2, '0')}:00`
  })
}

const RESPONSE = {
  current: {
    time: '2026-10-28T19:00',
    us_aqi: 54,
    pm2_5: 8,
    pm10: 9.9,
    ozone: 82,
    nitrogen_dioxide: 6.4,
    sulphur_dioxide: 2.1,
    carbon_monoxide: 144,
    us_aqi_pm2_5: 33,
    us_aqi_pm10: 9,
    us_aqi_ozone: 54,
    us_aqi_nitrogen_dioxide: 6,
    us_aqi_sulphur_dioxide: 1,
    us_aqi_carbon_monoxide: 2,
  },
  hourly: {
    time: hours(0, 48),
    us_aqi: Array.from({ length: 48 }, (_, i) => 40 + i),
  },
}

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
  test('takes the current index and pollutants', () => {
    const reading = readingFrom(RESPONSE, 'us')
    expect(reading.aqi).toBe(54)
    expect(reading.time).toBe('2026-10-28T19:00')
    expect(reading.pollutants[0]).toEqual({
      label: 'PM2.5',
      value: 8,
      index: 33,
    })
  })

  test('forecast is 24 hours from the current hour', () => {
    const reading = readingFrom(RESPONSE, 'us')
    expect(reading.forecast).toHaveLength(24)
    expect(reading.forecast[0]).toEqual({ time: '2026-10-28T19:00', aqi: 59 })
    expect(reading.forecast[23]!.time).toBe('2026-10-29T18:00')
  })

  test('forecast stops at the first missing hour', () => {
    const us_aqi = [...RESPONSE.hourly.us_aqi]
    us_aqi[25] = null as unknown as number
    const reading = readingFrom(
      { ...RESPONSE, hourly: { ...RESPONSE.hourly, us_aqi } },
      'us',
    )
    expect(reading.forecast).toHaveLength(6)
  })

  test('a half-hour timezone starts from the slot it falls in', () => {
    const current = { ...RESPONSE.current, time: '2026-10-28T19:30' }
    const reading = readingFrom({ ...RESPONSE, current }, 'us')
    expect(reading.forecast).toHaveLength(24)
    expect(reading.forecast[0]!.time).toBe('2026-10-28T19:00')
  })

  test('an error body is named, not dereferenced', () => {
    expect(() =>
      readingFrom({ error: true, reason: 'Latitude must be in range' }, 'us'),
    ).toThrow('Latitude must be in range')
    expect(() => readingFrom('<html>', 'us')).toThrow('no air quality reading')
  })

  test('a missing index is a failure, not a zero', () => {
    const current = { ...RESPONSE.current, us_aqi: null }
    expect(() => readingFrom({ ...RESPONSE, current }, 'us')).toThrow(
      'no US AQI',
    )
  })

  test('a European reading has no CO sub-index', () => {
    const reading = readingFrom(
      {
        current: {
          time: '2026-10-28T19:00',
          european_aqi: 31,
          carbon_monoxide: 144,
        },
        hourly: { time: [] },
      },
      'european',
    )
    expect(reading.pollutants[5]).toEqual({
      label: 'CO',
      value: 144,
      index: null,
    })
    expect(reading.forecast).toEqual([])
  })
})

test('dominant is the highest sub-index', () => {
  expect(dominant(readingFrom(RESPONSE, 'us'))?.label).toBe('O₃')
})

test('hourOf reads the wall-clock hour', () => {
  expect(hourOf('2026-10-28T07:00')).toBe(7)
})

describe('requestUrl', () => {
  test('free API without a key', () => {
    const url = new URL(requestUrl(37.38612, -122.08394, 'us', ''))
    expect(url.host).toBe('air-quality-api.open-meteo.com')
    expect(url.searchParams.get('apikey')).toBeNull()
    expect(url.searchParams.get('latitude')).toBe('37.3861')
    expect(url.searchParams.get('hourly')).toBe('us_aqi')
    expect(url.searchParams.get('current')).toContain('us_aqi_pm2_5')
  })

  test('customer API with a key', () => {
    const url = new URL(requestUrl(1, 2, 'european', 'k3y'))
    expect(url.host).toBe('customer-air-quality-api.open-meteo.com')
    expect(url.searchParams.get('apikey')).toBe('k3y')
    expect(url.searchParams.get('hourly')).toBe('european_aqi')
    expect(url.searchParams.get('current')).not.toContain(
      'european_aqi_carbon_monoxide',
    )
  })
})
