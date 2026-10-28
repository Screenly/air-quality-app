import { test } from '@playwright/test'
import {
  createMockScreenlyForScreenshots,
  getScreenshotsDir,
  RESOLUTIONS,
  setupClockMock,
  setupScreenlyJsMock,
} from '@screenly/edge-apps/test/screenshots'
import path from 'path'

import { RESPONSE } from './fixture.mjs'

const { screenlyJsContent } = createMockScreenlyForScreenshots(
  {
    coordinates: [37.3861, -122.0839],
    location: 'Silicon Valley, USA',
  },
  {
    aqi_scale: 'us',
    display_errors: 'false',
  },
)

for (const { width, height } of RESOLUTIONS) {
  test(`screenshot ${width}x${height}`, async ({ browser }) => {
    const screenshotsDir = getScreenshotsDir()

    const context = await browser.newContext({ viewport: { width, height } })
    const page = await context.newPage()

    await setupClockMock(page)
    await setupScreenlyJsMock(page, screenlyJsContent)

    await page.route('**/v1/air-quality*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(RESPONSE),
      })
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForFunction(
      () => document.getElementById('aqi')?.textContent === '72',
    )

    await page.screenshot({
      path: path.join(screenshotsDir, `air-quality-app-${width}x${height}.png`),
      fullPage: false,
    })

    await context.close()
  })
}
