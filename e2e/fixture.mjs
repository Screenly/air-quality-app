// Fixed OpenWeather responses shared by the screenshot spec and the
// failure-mode harness: a Moderate day driven by ozone, which climbs through
// the afternoon and clears overnight. Silicon Valley, so local time is UTC-8.

/** The forecast's first hour: 1 PM local on the screenshot clock's day. */
export const NOW = Date.UTC(2025, 1, 19, 21) / 1000
const HOUR = 3600

/** Ozone in μg/m³ by local hour, peaking in the early evening. */
const OZONE = [
  70, 66, 62, 60, 58, 60, 70, 90, 110, 125, 135, 140, 145, 150, 148, 146, 144,
  140, 130, 115, 100, 90, 82, 76,
]

function sample(dt, day) {
  const local = (((dt / HOUR - 8) % 24) + 24) % 24
  // Tomorrow is a cleaner day.
  const fade = day >= 1 ? 0.8 : 1
  return {
    dt,
    main: { aqi: 2 },
    components: {
      co: 212,
      no: 0.4,
      no2: 21.6,
      o3: Math.round(OZONE[local] * fade),
      so2: 2.1,
      pm2_5: 8,
      pm10: 18.2,
      nh3: 1.2,
    },
  }
}

const coord = { lon: -122.0839, lat: 37.3861 }

export const HISTORY = {
  coord,
  list: Array.from({ length: 24 }, (_, i) => sample(NOW - (24 - i) * HOUR, 0)),
}

export const FORECAST = {
  coord,
  list: Array.from({ length: 96 }, (_, i) =>
    sample(NOW + i * HOUR, Math.floor((i + 13) / 24)),
  ),
}

/** Answers a routed OpenWeather request with the matching fixture. */
export function bodyFor(url) {
  return JSON.stringify(url.includes('/history') ? HISTORY : FORECAST)
}
