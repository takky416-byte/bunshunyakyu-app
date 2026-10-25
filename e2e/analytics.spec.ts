import { startRoom, finishRoom } from './room-helpers'
import { expect, test } from './fixtures'
import { readFile } from 'node:fs/promises'
import type { AnalyticsReport } from '../src/analytics-contract'

function headers() {
  return { Authorization: `Bearer ${process.env.TEST_ANALYTICS_ADMIN_KEY!}` }
}

test('real gameplay is recorded once, persists on reload, and appears in the protected dashboard', async ({
  page,
  request,
}) => {
  const summary = async (): Promise<AnalyticsReport> =>
    (
      await request.get('/api/analytics/admin/summary', { headers: headers() })
    ).json()
  const before = await summary()
  await page.goto('/')
  await startRoom(page)
  await expect
    .poll(async () => (await summary()).totals.starts)
    .toBe(before.totals.starts + 1)
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: '候補を提出する' }).click()
  await page.getByRole('radio').first().check()
  await page.getByRole('button', { name: '投票してドラフトへ' }).click()
  await finishRoom(page)
  await expect(
    page.getByRole('heading', { name: '12球団のドラフト結果' }),
  ).toBeVisible()
  await expect
    .poll(async () => (await summary()).totals.completions)
    .toBe(before.totals.completions + 1)
  await page.reload()
  await expect(
    page.getByRole('heading', { name: '12球団のドラフト結果' }),
  ).toBeVisible()
  const after = await summary()
  expect(after.totals.starts).toBe(before.totals.starts + 1)
  expect(after.totals.completions).toBe(before.totals.completions + 1)
  expect(after.totals.players).toBe(before.totals.players + 1)
  expect((await request.get('/api/analytics/admin/summary')).status()).toBe(401)

  await page.goto('/admin')
  await page.getByLabel('管理キー', { exact: true }).fill('invalid-test-key')
  await page.getByRole('button', { name: 'ダッシュボードを開く' }).click()
  await expect(page.getByRole('alert')).toContainText(
    '管理キーを確認してください',
  )
  await page
    .getByLabel('管理キー', { exact: true })
    .fill(process.env.TEST_ANALYTICS_ADMIN_KEY!)
  await page.getByRole('button', { name: 'ダッシュボードを開く' }).click()
  await expect(
    page.getByRole('heading', { name: '日別の利用状況' }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: '開始回数', exact: true }),
  ).toContainText(String(after.totals.starts))
  await page.getByRole('button', { name: '7日', exact: true }).click()
  await expect(page.locator('.admin-daily tbody tr')).toHaveCount(7)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'CSVを保存' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^draft-analytics-.*\.csv$/)
  expect(await readFile((await file.path())!, 'utf8')).toContain(
    'プレー開始人数',
  )
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  expect(
    await page.evaluate(
      (key) => Object.values(localStorage).some((value) => value.includes(key)),
      process.env.TEST_ANALYTICS_ADMIN_KEY!,
    ),
  ).toBe(false)
  await page.getByRole('button', { name: 'ログアウト' }).click()
  await expect(page.getByLabel('管理キー', { exact: true })).toBeVisible()
})

test('opt-out stops new events and gameplay still works', async ({
  page,
  request,
}) => {
  await page.goto('/')
  await page
    .getByRole('button', { name: '利用状況の計測', exact: true })
    .click()
  await page
    .getByRole('checkbox', { name: /利用状況の計測を許可する/ })
    .uncheck()
  await expect(
    page.getByText('このブラウザからの計測を停止しています。'),
  ).toBeVisible()
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  const before = (await (
    await request.get('/api/analytics/admin/summary', { headers: headers() })
  ).json()) as AnalyticsReport
  const posts: string[] = []
  page.on('request', (req) => {
    if (req.url().includes('/api/analytics/events')) posts.push(req.url())
  })
  await startRoom(page)
  expect(await page.getByRole('checkbox').count()).toBeGreaterThan(1)
  await page.reload()
  await expect(
    page.getByRole('heading', { name: /提出候補を選ぶ/ }),
  ).toBeVisible()
  const after = (await (
    await request.get('/api/analytics/admin/summary', { headers: headers() })
  ).json()) as AnalyticsReport
  expect(after.totals.starts).toBe(before.totals.starts)
  expect(posts).toHaveLength(0)
  expect(
    await page.evaluate(() =>
      localStorage.getItem('draft-analytics:visitor:v1'),
    ),
  ).toBeNull()
})

test('browser privacy preference prevents tracking without disabling the game', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'doNotTrack', {
      get: () => '1',
      configurable: true,
    }),
  )
  const events: string[] = []
  page.on('request', (req) => {
    if (req.url().includes('/api/analytics/events')) events.push(req.url())
  })
  await page.goto('/')
  await page
    .getByRole('button', { name: '利用状況の計測', exact: true })
    .click()
  await expect(page.getByRole('checkbox')).toBeDisabled()
  await expect(page.getByRole('checkbox')).not.toBeChecked()
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await startRoom(page)
  await expect(
    page.getByRole('heading', { name: /提出候補を選ぶ/ }),
  ).toBeVisible()
  expect(events).toHaveLength(0)
})

test('opting out during a play removes its stored analytics identity', async ({
  page,
}) => {
  await page.goto('/')
  await startRoom(page)
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem('geneki-draft:room-tracking:v1') ?? 'null',
          )?.tracked?.playId ?? null,
      ),
    )
    .not.toBeNull()
  await page
    .getByRole('button', { name: '利用状況の計測', exact: true })
    .click()
  await page
    .getByRole('checkbox', { name: /利用状況の計測を許可する/ })
    .uncheck()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem('geneki-draft:room-tracking:v1') ?? 'null',
          )?.tracked ?? null,
      ),
    )
    .toBeNull()
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.reload()
  await expect(
    page.getByRole('heading', { name: /提出候補を選ぶ/ }),
  ).toBeVisible()
  expect(
    await page.evaluate(() =>
      localStorage.getItem('draft-analytics:visitor:v1'),
    ),
  ).toBeNull()
})

test('collection outages do not block gameplay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/analytics/events', (route) => route.abort())
  await page.goto('/')
  await startRoom(page)
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: '候補を提出する' }).click()
  await expect(
    page.getByRole('heading', { name: /獲得希望を選ぶ/ }),
  ).toBeVisible()
  expect(errors).toHaveLength(0)
})
