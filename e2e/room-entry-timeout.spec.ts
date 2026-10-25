import { test, expect } from './fixtures'
import type { Route } from '@playwright/test'

test('an unresponsive room creation times out and can be retried without reloading', async ({
  page,
}) => {
  await page.clock.install()
  let pending: Route | undefined
  await page.route('**/api/rooms', (route) => {
    pending = route
  })
  await page.goto('/')
  await page.getByLabel('プレーヤー名', { exact: true }).fill('再試行GM')
  const create = page.getByRole('button', { name: 'ルームを作る', exact: true })
  await create.click()
  await expect(create).toBeDisabled()
  await page.clock.runFor(10_100)
  await expect(create).toBeEnabled()
  await expect(page.getByRole('alert')).toContainText(
    '接続に時間がかかっています',
  )
  await page.unroute('**/api/rooms')
  await pending?.abort().catch(() => {})
  await create.click()
  await expect(
    page.getByRole('region', { name: 'ルームの待合室' }),
  ).toBeVisible()
})
