import { test, expect } from './fixtures'
import { legacyStart } from './legacy-helper'

test('selection lists show first-team stats and no appearances, retain details and keep mobile actions reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await legacyStart(page, 'd')
  const rowFor = (name: string) =>
    page
      .locator('.player-row')
      .filter({ has: page.getByText(name, { exact: true }) })
  const pitcher = rowFor('橋本 侑樹')
  await expect(pitcher.locator('.player-stats')).toHaveText(
    '一軍45登板防御率 4.584勝4敗',
  )
  const batter = rowFor('石橋 康太')
  await expect(batter.locator('.player-stats')).toHaveText(
    '一軍4試合打率 .0000本0打点',
  )
  await expect(rowFor('田中 幹也').locator('.player-stats')).toContainText(
    '打率 .241',
  )
  await expect(
    page.locator('.player-row').filter({ hasText: '一軍出場なし' }).first(),
  ).toBeVisible()
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    const layout = await page.locator('.roster-list').evaluate((list) => {
      const rows = [...list.querySelectorAll('.player-row')]
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        statsFit: rows.every((row) => {
          const boundary = row
            .querySelector('.player-name')!
            .getBoundingClientRect()
          return [
            ...row.querySelectorAll('.player-stats > span, .player-stats > b'),
          ].every((unit) => {
            const rect = unit.getBoundingClientRect()
            const range = document.createRange()
            range.selectNodeContents(unit)
            return (
              rect.left >= boundary.left - 1 &&
              rect.right <= boundary.right + 1 &&
              range.getClientRects().length === 1
            )
          })
        }),
      }
    })
    expect(layout.overflow, `${width}px overflow`).toBe(false)
    expect(layout.statsFit, `${width}px statistics`).toBe(true)
  }
  await page.setViewportSize({ width: 390, height: 667 })
  await pitcher.getByRole('button', { name: '橋本 侑樹の詳細' }).click()
  await expect(page.getByRole('dialog').locator('.player-stats')).toContainText(
    '2026年 一軍成績',
  )
  await expect(page.getByRole('dialog').locator('.player-stats')).toContainText(
    '防御率 4.58',
  )
  await page.keyboard.press('Escape')
  await batter.getByRole('button', { name: '石橋 康太の詳細' }).click()
  await expect(page.getByRole('dialog').locator('.player-stats')).toContainText(
    '打率 .000',
  )
  await expect(
    page.getByRole('dialog').locator('.player-stats'),
  ).not.toContainText('打率 0.000')
  await page.keyboard.press('Escape')
  await expect(pitcher.getByRole('checkbox')).not.toBeChecked()
  await pitcher.getByRole('checkbox').check()
  await batter.getByRole('checkbox').check()
  await page.getByRole('button', { name: '候補を提出する' }).click()
  await expect(
    page.getByRole('heading', { name: /獲得希望を選ぶ/ }),
  ).toBeVisible()
  await expect(page.locator('.player-stats')).toHaveCount(
    await page.locator('.player-row').count(),
  )
  await page.getByRole('radio').first().check()
  await page.getByRole('button', { name: '投票してドラフトへ' }).click()
  if (
    await page.getByRole('button', { name: '自分の番まで進める' }).isVisible()
  )
    await page.getByRole('button', { name: '自分の番まで進める' }).click()
  await expect(
    page.getByRole('heading', { name: /あなたの指名番です/ }),
  ).toBeVisible()
  await expect(page.locator('.player-stats')).toHaveCount(
    await page.locator('.player-row').count(),
  )
  const submit = page.getByRole('button', {
    name: 'この選手を指名',
    exact: true,
  })
  const bounds = (await submit.boundingBox())!
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(667)
  await page.screenshot({ path: '.cache/player-stats-mobile.png' })
})
