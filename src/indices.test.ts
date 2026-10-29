import { describe, expect, test } from 'bun:test'

import { europeanIndex, interpolate, usIndex, type Key } from './indices'

/** A window where every trailing mean is the same value. */
function steady(values: Partial<Record<Key, number>>) {
  return (key: Key) => values[key] ?? null
}

describe('interpolate', () => {
  test('hits breakpoints exactly and is linear between', () => {
    expect(interpolate(0, [0, 10, 20], [0, 50, 100])).toBe(0)
    expect(interpolate(10, [0, 10, 20], [0, 50, 100])).toBe(50)
    expect(interpolate(15, [0, 10, 20], [0, 50, 100])).toBe(75)
  })

  test('carries the last slope past the top', () => {
    expect(interpolate(30, [0, 10, 20], [0, 50, 100])).toBe(150)
  })
})

describe('usIndex', () => {
  test('PM2.5 uses the 2024 breakpoints', () => {
    expect(usIndex('pm2_5', steady({ pm2_5: 9 }))).toBe(50)
    expect(usIndex('pm2_5', steady({ pm2_5: 35.4 }))).toBe(100)
    expect(usIndex('pm2_5', steady({ pm2_5: 55.4 }))).toBe(150)
  })

  test('categories are discrete, not blended across a breakpoint', () => {
    expect(usIndex('pm2_5', steady({ pm2_5: 9.1 }))).toBe(51)
    expect(usIndex('pm2_5', steady({ pm2_5: 35.5 }))).toBe(101)
    const o3 = (55 * 48) / 24.45
    expect(usIndex('o3', steady({ o3 }))).toBe(51)
  })

  test('concentrations are truncated to the table precision first', () => {
    // 9.09 truncates to 9.0, still Good; 54.9 μg/m³ of PM10 truncates to 54.
    expect(usIndex('pm2_5', steady({ pm2_5: 9.09 }))).toBe(50)
    expect(usIndex('pm10', steady({ pm10: 54.9 }))).toBe(50)
  })

  test('PM10', () => {
    expect(usIndex('pm10', steady({ pm10: 154 }))).toBe(100)
  })

  test('O₃ converts μg/m³ to ppb on its 8-hour mean', () => {
    // 70 ppb is the top of Moderate: 70 × 48 / 24.45 μg/m³.
    const top = (70 * 48) / 24.45
    expect(usIndex('o3', steady({ o3: top }))).toBeCloseTo(100, 6)
  })

  test('O₃ takes the hourly table when it reads higher', () => {
    // 8-hour mean low, but an hourly spike of 164 ppb is Unhealthy for sensitive groups.
    const spike = (164 * 48) / 24.45
    const window = (key: Key, hours: number) =>
      key === 'o3' ? (hours === 1 ? spike : 50) : null
    expect(usIndex('o3', window)).toBeCloseTo(150, 6)
  })

  test('O₃ above 200 ppb on the 8-hour mean reads the hourly table alone', () => {
    const hour = (125 * 48) / 24.45
    const day = (201 * 48) / 24.45
    const window = (key: Key, hours: number) =>
      key === 'o3' ? (hours === 1 ? hour : day) : null
    expect(usIndex('o3', window)).toBe(101)
  })

  test('NO₂ on its hourly value', () => {
    const top = (100 * 46.01) / 24.45
    expect(usIndex('no2', steady({ no2: top }))).toBeCloseTo(100, 6)
  })

  test('SO₂ above 304 ppb reads its 24-hour mean', () => {
    const high = (500 * 64.07) / 24.45
    const low = (100 * 64.07) / 24.45
    const window = (key: Key, hours: number) =>
      key === 'so2' ? (hours === 1 ? high : low) : null
    expect(usIndex('so2', window)).toBe(200)
  })

  test('CO in ppm on its 8-hour mean', () => {
    const top = (9.4 * 1000 * 28.01) / 24.45
    expect(usIndex('co', steady({ co: top }))).toBeCloseTo(100, 6)
  })

  test('no data is null, not zero', () => {
    expect(usIndex('pm2_5', steady({}))).toBeNull()
  })
})

describe('europeanIndex', () => {
  test('bands are 20 points wide', () => {
    expect(europeanIndex('pm2_5', steady({ pm2_5: 5 }))).toBe(20)
    expect(europeanIndex('o3', steady({ o3: 140 }))).toBe(70)
    expect(europeanIndex('no2', steady({ no2: 150 }))).toBe(100)
  })

  test('has no CO sub-index', () => {
    expect(europeanIndex('co', steady({ co: 500 }))).toBeNull()
  })
})
