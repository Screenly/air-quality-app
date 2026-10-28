/* eslint-disable no-undef --
   This file legitimately spans two global scopes and ESLint cannot tell them
   apart: `console`/`process` belong to the Node script, while `document`,
   `window` and `localStorage` only appear inside page.evaluate() callbacks,
   whose bodies are serialised and run in the browser. */
// Exercises every branch of the approved failure-mode diagram against the BUILT
// dist/, with a stub screenly.js standing in for the player bridge.
import { chromium } from 'playwright'
import http from 'http'
import fs from 'fs'
import path from 'path'

import { RESPONSE } from './fixture.mjs'

const DIST = path.join(import.meta.dirname, '..', 'dist')
const API = '**/v1/air-quality*'
const BODY = JSON.stringify(RESPONSE)

const STUB = (settings) => `
window.screenly = {
  metadata: {
    coordinates: window.__COORDS__ || [],
    location: "Silicon Valley, USA",
    hostname: "srly-test", screen_name: "Test", hardware: "x86", tags: []
  },
  settings: ${JSON.stringify(settings)},
  cors_proxy_url: "http://127.0.0.1:8124/cors",
  signalReadyForRendering: function () {
    window.__READY__ = (window.__READY__ || 0) + 1;
  }
};`

let settings = {}

const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0]
  if (p === '/') p = '/index.html'
  if (p === '/screenly.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' })
    return res.end(STUB(settings))
  }
  const f = path.join(DIST, p)
  if (!fs.existsSync(f)) {
    res.writeHead(404)
    return res.end()
  }
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(fs.readFileSync(f))
})

const results = []
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  results.push({ ok, name, actual, expected })
}

async function probe(page) {
  return page.evaluate(() => {
    const t = (id) => document.getElementById(id).textContent
    return {
      ready: window.__READY__ || 0,
      state: document.getElementById('stage').className || '(content)',
      aqi: t('aqi'),
      category: t('category'),
      scale: t('scale'),
      where: t('where'),
      main: document.querySelector('.pollutant.main .label')?.textContent,
      bars: document.querySelectorAll('.bar').length,
      cached: !!localStorage.getItem('air-quality-app:reading'),
      // The overlay also puts a class on <body>, so match the modal itself.
      panic: !!document.querySelector('.panic-overlay__modal'),
      panicText: (
        document.querySelector('.panic-overlay__modal')?.textContent || ''
      ).slice(0, 400),
    }
  })
}

await new Promise((r) => server.listen(8124, r))
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM }
    : {},
)

const LOCATED = ['37.3861', '-122.0839']
async function newPage(ctx, coords = LOCATED) {
  const page = await ctx.newPage()
  await page.addInitScript((c) => {
    window.__COORDS__ = c
    window.__READY__ = 0
  }, coords)
  return page
}

function newContext() {
  return browser.newContext({ viewport: { width: 1920, height: 1080 } })
}

// ── 1. API OK, then 2. API fails with that reading cached ────────────────────
{
  const ctx = await newContext()
  const page = await newPage(ctx)
  await page.route(API, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: BODY }),
  )
  await page.goto('http://127.0.0.1:8124/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const s = await probe(page)
  check('1 API OK -> shows content', s.state, '(content)')
  check(
    '1 API OK -> US AQI',
    [s.scale, s.aqi, s.category],
    ['US AQI', '72', 'Moderate'],
  )
  check('1 API OK -> ozone is the main pollutant', s.main, 'O₃')
  check('1 API OK -> 24 forecast bars', s.bars, 24)
  check('1 API OK -> wrote cache', s.cached, true)
  check('1 API OK -> signalled once', s.ready, 1)

  const page2 = await newPage(ctx)
  await page2.route(API, (r) => r.abort())
  await page2.goto('http://127.0.0.1:8124/', { waitUntil: 'load' })
  await page2.waitForTimeout(900)
  const s2 = await probe(page2)
  check('2 fail+cache -> shows content', s2.state, '(content)')
  check('2 fail+cache -> from last reading', s2.aqi, '72')
  check('2 fail+cache -> signalled once', s2.ready, 1)
  check('2 fail+cache -> no error overlay', s2.panic, false)

  // ── 3. the cache is for another index -> not used ──────────────────────────
  settings = { aqi_scale: 'european' }
  const page3 = await newPage(ctx)
  await page3.route(API, (r) => r.abort())
  await page3.goto('http://127.0.0.1:8124/', { waitUntil: 'load' })
  await page3.waitForTimeout(900)
  const s3 = await probe(page3)
  check('3 cache for other index -> abort state', s3.state, 'unavailable')
  settings = {}
  await ctx.close()
}

// ── 4. API fails, no cache -> abort state ────────────────────────────────────
{
  const ctx = await newContext()
  const page = await newPage(ctx)
  await page.route(API, (r) => r.abort())
  await page.goto('http://127.0.0.1:8124/', { waitUntil: 'load' })
  await page.waitForTimeout(900)
  const s = await probe(page)
  check('4 fail+no cache -> abort state', s.state, 'unavailable')
  check('4 fail+no cache -> says unavailable', s.where, 'Unavailable')
  check('4 fail+no cache -> still signalled once', s.ready, 1)
  await ctx.close()
}

// ── 5. API fails, display_errors ON -> error shown, still signals ────────────
{
  settings = { display_errors: 'true' }
  const ctx = await newContext()
  const page = await newPage(ctx)
  await page.route(API, (r) =>
    r.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: true, reason: 'Cannot initialize' }),
    }),
  )
  await page.goto('http://127.0.0.1:8124/', { waitUntil: 'load' })
  await page.waitForTimeout(1200)
  const s = await probe(page)
  check('5 display_errors -> error overlay shown', s.panic, true)
  check(
    '5 display_errors -> names the reason',
    s.panicText.includes('Cannot initialize'),
    true,
  )
  check('5 display_errors -> still signalled', s.ready >= 1, true)
  await ctx.close()
  settings = {}
}

// ── 6. unlocated screen ──────────────────────────────────────────────────────
{
  const ctx = await newContext()
  const page = await newPage(ctx, [])
  let fetched = false
  await page.route(API, (r) => {
    fetched = true
    r.abort()
  })
  await page.goto('http://127.0.0.1:8124/', { waitUntil: 'load' })
  await page.waitForTimeout(700)
  const s = await probe(page)
  check('6 unlocated -> unlocated state', s.state, 'unlocated')
  check('6 unlocated -> never fetches', fetched, false)
  check('6 unlocated -> signalled once', s.ready, 1)
  await ctx.close()
}

// ── 7. European index ────────────────────────────────────────────────────────
{
  settings = { aqi_scale: 'european' }
  const ctx = await newContext()
  const page = await newPage(ctx)
  let url = ''
  await page.route(API, (r) => {
    url = r.request().url()
    r.fulfill({ status: 200, contentType: 'application/json', body: BODY })
  })
  await page.goto('http://127.0.0.1:8124/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const s = await probe(page)
  check(
    '7 european -> European AQI',
    [s.scale, s.aqi, s.category],
    ['European AQI', '44', 'Moderate'],
  )
  check('7 european -> asks for it', url.includes('hourly=european_aqi'), true)
  check('7 european -> free API', url.includes('//air-quality-api.'), true)
  await ctx.close()
  settings = {}
}

// ── 8. a paid key moves to the customer API ──────────────────────────────────
{
  settings = { open_meteo_api_key: 'k3y' }
  const ctx = await newContext()
  const page = await newPage(ctx)
  let url = ''
  await page.route(API, (r) => {
    url = r.request().url()
    r.fulfill({ status: 200, contentType: 'application/json', body: BODY })
  })
  await page.goto('http://127.0.0.1:8124/', { waitUntil: 'networkidle' })
  const s = await probe(page)
  check(
    '8 api key -> customer host',
    url.includes('//customer-air-quality-api.'),
    true,
  )
  check('8 api key -> sends key', url.includes('apikey=k3y'), true)
  check('8 api key -> shows content', s.state, '(content)')
  await ctx.close()
  settings = {}
}

// ── 9. a hanging API must time out inside the budget ─────────────────────────
{
  const ctx = await newContext()
  const page = await newPage(ctx)
  await page.route(API, () => {
    /* never respond */
  })
  const started = Date.now()
  await page.goto('http://127.0.0.1:8124/', { waitUntil: 'commit' })
  await page.waitForFunction(() => (window.__READY__ || 0) > 0, null, {
    timeout: 15000,
  })
  const elapsed = Date.now() - started
  const s = await probe(page)
  check('9 hang -> signals despite no response', s.ready, 1)
  check('9 hang -> lands in abort state', s.state, 'unavailable')
  check('9 hang -> inside the 10s budget', elapsed < 10000, true)
  console.log(`   signalled after ${elapsed} ms`)
  await ctx.close()
}

// ── 10. 200 OK with no index for this position -> failure, not zero ──────────
{
  const ctx = await newContext()
  const page = await newPage(ctx)
  const empty = {
    ...RESPONSE,
    current: { time: RESPONSE.current.time, us_aqi: null },
  }
  await page.route(API, (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(empty),
    }),
  )
  await page.goto('http://127.0.0.1:8124/', { waitUntil: 'load' })
  await page.waitForTimeout(900)
  const s = await probe(page)
  check('10 no index -> abort state', s.state, 'unavailable')
  check('10 no index -> signalled once', s.ready, 1)
  check('10 no index -> no error overlay', s.panic, false)
  await ctx.close()
}

await browser.close()
server.close()

console.log()
let failed = 0
for (const r of results) {
  if (!r.ok) failed++
  console.log(
    `${r.ok ? '  PASS' : '  FAIL'}  ${r.name}${r.ok ? '' : `  (got ${JSON.stringify(r.actual)}, want ${JSON.stringify(r.expected)})`}`,
  )
}
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
