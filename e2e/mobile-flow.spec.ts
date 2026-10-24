import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

async function expectFlowFocus(page: Page) {
  const target = page.locator('.flow-target')
  await expect(target).toBeFocused()
  const bounds = await target.boundingBox()
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.y).toBeLessThan(page.viewportSize()!.height / 2)
  expect(bounds!.y + bounds!.height).toBeLessThan(page.viewportSize()!.height)
}

async function nominate(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'この球団ではじめる' }).click()
  await expectFlowFocus(page)
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
}

test('domestic-treated players are selectable and reported departures stay excluded', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page
    .getByRole('button', { name: '東北楽天ゴールデンイーグルス', exact: true })
    .click()
  await page.getByRole('button', { name: 'この球団ではじめる' }).click()
  await expect(page.locator('.app-shell')).not.toContainText(
    /仮対象|仮判定|未確認|補強ポイント/,
  )
  await expect(page.getByRole('textbox', { name: '選手名で検索' })).toHaveCount(
    0,
  )
  const rowFor = (name: string) =>
    page
      .locator('.player-row')
      .filter({ has: page.getByText(name, { exact: true }) })
  const waters = rowFor('ワォーターズ')
  await expect(waters.getByRole('checkbox')).toBeEnabled()
  await waters.getByRole('checkbox').check()
  await expect(waters.getByRole('checkbox')).toBeChecked()
  await expect(rowFor('陽 柏翔').getByRole('checkbox')).toBeEnabled()
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    expect((await waters.boundingBox())!.height).toBeLessThan(90)
    expect(
      (await page.locator('.roster-list').boundingBox())!.height,
    ).toBeLessThanOrEqual(363)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  }
  await page
    .getByRole('button', { name: '新しいドラフト', exact: true })
    .click()
  await page
    .getByRole('button', { name: '球団選択に戻る', exact: true })
    .click()
  await page
    .getByRole('button', { name: '広島東洋カープ', exact: true })
    .click()
  await page.getByRole('button', { name: 'この球団ではじめる' }).click()
  await expect(rowFor('ケムナ 誠')).toHaveCount(0)
  await expect(rowFor('松本 竜也')).toHaveCount(0)
  await page.locator('.data-disclosure > summary').click()
  await page.getByRole('button', { name: '対象外も表示' }).click()
  await expect(rowFor('ケムナ 誠').getByRole('checkbox')).toBeDisabled()
  await rowFor('ケムナ 誠')
    .getByRole('button', { name: /の詳細$/ })
    .click()
  await expect(page.getByRole('dialog')).toContainText(
    '戦力外・退団・引退の報道あり',
  )
  await expect(
    page
      .getByRole('dialog')
      .getByRole('link', { name: '戦力外・退団・引退の報道ありの出典' }),
  ).toHaveAttribute(
    'href',
    'https://www.nikkansports.com/baseball/news/202609280000276.html',
  )
})

test('mobile layout keeps large type, folds supporting panels, and opens details without selecting the player', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(
    page.getByRole('group', { name: '操作する球団' }).getByRole('button'),
  ).toHaveCount(12)
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThan(2400)
  await page.getByRole('button', { name: 'この球団ではじめる' }).click()
  await expectFlowFocus(page)
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThan(1500)
  const row = page.locator('.player-row').first()
  expect((await row.boundingBox())!.height).toBeLessThan(90)
  expect(
    await row
      .locator('.player-name strong')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(18)
  expect(
    await row
      .locator('.salary-info')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(14)
  await expect(page.locator('.data-disclosure')).not.toHaveAttribute('open')
  await expect(page.locator('.aside-disclosure')).not.toHaveAttribute('open')
  const detail = row.getByRole('button', { name: /の詳細$/ })
  await detail.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('2026年推定年俸')
  await expect(dialog).not.toContainText(/仮対象|仮判定|未確認|補強ポイント/)
  await expect(dialog.getByRole('link', { name: '年俸出典' })).toBeVisible()
  await expect(page.locator('.roster-list input:checked')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(detail).toBeFocused()
  await expect(row.getByRole('checkbox')).not.toBeChecked()
  const before = await page.evaluate(() => scrollY)
  await row.getByRole('checkbox').check()
  expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThan(
    2,
  )
  await page.locator('.aside-disclosure > summary').click()
  await expect(page.locator('.your-team')).toBeVisible()
  await page.locator('.aside-disclosure > summary').click()
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(page.locator('.your-team')).toBeVisible()
  await expect(page.locator('.data-notice')).toBeVisible()
})

test('every mobile game transition focuses its next action and resets the roster scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 667 })
  await nominate(page)
  await page
    .locator('.roster-list')
    .evaluate((el) => (el.scrollTop = el.scrollHeight))
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
  await page.getByRole('button', { name: '候補を提出する' }).click()
  await expectFlowFocus(page)
  await expect(
    page.getByRole('heading', { name: /獲得希望を選ぶ/ }),
  ).toBeVisible()
  expect(
    await page.locator('.roster-list').evaluate((el) => el.scrollTop),
  ).toBe(0)
  await page.getByRole('radio').first().check()
  await page.getByRole('button', { name: '投票してドラフトへ' }).click()
  await expectFlowFocus(page)
  for (let i = 0; i < 13; i++) {
    const stage = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('geneki-draft-room:v2')!).game.stage,
    )
    if (stage !== 'draft') break
    if (
      await page
        .getByRole('heading', { name: /あなたの指名番です/ })
        .isVisible()
    ) {
      await page.getByRole('radio').first().check()
      await page.getByRole('button', { name: 'この選手を指名' }).click()
    } else
      await page.getByRole('button', { name: '自分の番まで進める' }).click()
    await expectFlowFocus(page)
  }
  await page.getByRole('button', { name: '自球団は参加を見送る' }).click()
  await expectFlowFocus(page)
  await expect(page.locator('.participation-disclosure')).not.toHaveAttribute(
    'open',
  )
  await page
    .getByRole('button', { name: '参加・入札を確定して結果を見る' })
    .click()
  await expectFlowFocus(page)
  await expect(
    page.getByRole('heading', { name: '12球団のドラフト結果' }),
  ).toBeVisible()
  const table = page.locator('.table-scroll')
  expect((await table.boundingBox())!.height).toBeLessThanOrEqual(401)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.getByRole('button', { name: 'もう一度プレー' }).click()
  await page
    .getByRole('button', { name: '球団選択に戻る', exact: true })
    .click()
  await expectFlowFocus(page)
  await expect(
    page.getByRole('heading', { name: 'どの球団の未来を、つくりますか。' }),
  ).toBeFocused()
})

test('announcement waits retain dialog focus and closing it moves to the next action', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 667 })
  await page.clock.install()
  await page.goto('/')
  await page.getByRole('button', { name: 'この球団ではじめる' }).click()
  await page.clock.runFor(50)
  await page.getByRole('button', { name: '指名発表の演出' }).click()
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: '候補を提出する' }).click()
  await page.clock.runFor(2000)
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '獲得希望を選ぶ', exact: true })
    .click()
  await page.clock.runFor(50)
  await page.getByRole('radio').first().check()
  await page.getByRole('button', { name: '投票してドラフトへ' }).click()
  await page.clock.runFor(2000)
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('.announcement-name')).toBeVisible()
  expect(
    (await dialog.locator('.button.primary').boundingBox())!.y +
      (await dialog.locator('.button.primary').boundingBox())!.height,
  ).toBeLessThan(667)
  expect(
    await page.evaluate(() =>
      Boolean(document.activeElement?.closest('dialog')),
    ),
  ).toBe(true)
  await dialog.locator('.button.primary').click()
  await page.clock.runFor(50)
  await expectFlowFocus(page)
})
