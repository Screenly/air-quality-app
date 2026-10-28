// A fixed Open-Meteo response shared by the screenshot spec and the
// failure-mode harness: a Moderate day driven by ozone, peaking in the evening.
export const CURRENT_TIME = '2026-10-28T14:00'

const times = Array.from({ length: 48 }, (_, i) => {
  const day = 28 + Math.floor(i / 24)
  return `2026-10-${day}T${String(i % 24).padStart(2, '0')}:00`
})

// Climbs through the afternoon into Unhealthy for sensitive groups, then clears overnight.
const shape = [
  30, 28, 26, 25, 25, 27, 32, 40, 48, 55, 60, 64, 66, 68, 72, 80, 92, 108, 112,
  104, 88, 70, 55, 44,
]
const usAqi = [...shape, ...shape.map((v) => Math.round(v * 0.8))]

export const RESPONSE = {
  latitude: 37.4,
  longitude: -122.1,
  timezone: 'America/Los_Angeles',
  current: {
    time: CURRENT_TIME,
    interval: 3600,
    us_aqi: 72,
    european_aqi: 44,
    pm2_5: 11.4,
    pm10: 18.2,
    ozone: 148,
    nitrogen_dioxide: 21.6,
    sulphur_dioxide: 2.1,
    carbon_monoxide: 212,
    us_aqi_pm2_5: 48,
    us_aqi_pm10: 17,
    us_aqi_ozone: 72,
    us_aqi_nitrogen_dioxide: 19,
    us_aqi_sulphur_dioxide: 1,
    us_aqi_carbon_monoxide: 2,
    european_aqi_pm2_5: 38,
    european_aqi_pm10: 18,
    european_aqi_ozone: 44,
    european_aqi_nitrogen_dioxide: 22,
    european_aqi_sulphur_dioxide: 2,
  },
  hourly: {
    time: times,
    us_aqi: usAqi,
    european_aqi: usAqi.map((v) => Math.round(v * 0.6)),
  },
}
