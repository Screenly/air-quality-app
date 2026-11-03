import { test } from '@playwright/test'
import {
  createMockScreenlyForScreenshots,
  getScreenshotsDir,
  RESOLUTIONS,
  setupClockMock,
  setupScreenlyJsMock,
} from '@screenly/edge-apps/test/screenshots'
import path from 'path'

import { bodyFor } from './fixture.mjs'

const { screenlyJsContent } = createMockScreenlyForScreenshots(
  {
    coordinates: [37.3861, -122.0839],
    location: 'Silicon Valley, USA',
  },
  {
    aqi_scale: 'us',
    display_errors: 'false',
    openweathermap_api_key: 'test-key',
  },
)

for (const { width, height } of RESOLUTIONS) {
  test(`screenshot ${width}x${height}`, async ({ browser }) => {
    const screenshotsDir = getScreenshotsDir()

    const context = await browser.newContext({ viewport: { width, height } })
    const page = await context.newPage()

    await setupClockMock(page)
    await setupScreenlyJsMock(page, screenlyJsContent)

    await page.route('**/air_pollution/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: bodyFor(route.request().url()),
      })
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForFunction(
      () => document.getElementById('aqi')?.textContent === '71',
    )

    await page.screenshot({
      path: path.join(screenshotsDir, `air-quality-app-${width}x${height}.png`),
      fullPage: false,
    })

    await context.close()
  })
}
