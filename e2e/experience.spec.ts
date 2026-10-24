import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { referenceDataset } from '../src/data'
const legacy = JSON.parse(
  readFileSync(
    new URL('./fixtures/legacy-game-v2.json', import.meta.url),
    'utf8',
  ),
)

async function loadResult(page: import('@playwright/test').Page) {
  await page.addInitScript(
    ({ game, dataset }) => {
      sessionStorage.setItem('geneki-draft:welcome:v1', 'seen')
      localStorage.setItem(
        'geneki-draft-room:v2',
        JSON.stringify({ game, dataset, chosenTeam: 't' }),
      )
    },
    { game: legacy.game, dataset: referenceDataset },
  )
  await page.goto('/')
  await page.getByRole('button', { name: 'プレー結果を共有' }).click()
}

test('welcome explains the concept, fits a phone, and appears once per session without losing a game', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 667 })
  await page.goto('/')
  const welcome = page.getByRole('dialog', { name: '現役ドラフトルーム' })
  await expect(welcome).toContainText('11球団のCPU')
  const enter = welcome.getByRole('button', { name: '球団を選んではじめる' })
  await expect(enter).toBeFocused()
  const bounds = await enter.boundingBox()
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(667)
  await page.screenshot({ path: '.cache/welcome-mobile.png' })
  await enter.click()
  await expect(
    page.getByRole('heading', { name: 'どの球団の未来を、つくりますか。' }),
  ).toBeFocused()
  await page.getByRole('button', { name: 'この球団ではじめる' }).click()
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem('geneki-draft-room:v2')!).game,
  )
  await page.reload()
  await expect(welcome).toHaveCount(0)
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('geneki-draft-room:v2')!).game,
    ),
  ).toEqual(before)
  await page.evaluate(() =>
    sessionStorage.removeItem('geneki-draft:welcome:v1'),
  )
  await page.reload()
  await welcome.getByRole('button', { name: '前回のドラフトを続ける' }).click()
  await expect(
    page.getByRole('heading', { name: /提出候補を選ぶ/ }),
  ).toBeFocused()
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('geneki-draft-room:v2')!).game,
    ),
  ).toEqual(before)
})

test('compact selection follows league order, previews club colors, and guides the next action', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() =>
    sessionStorage.setItem('geneki-draft:welcome:v1', 'seen'),
  )
  await page.goto('/')
  const central = page.getByRole('region', { name: 'セ・リーグ', exact: true })
  const pacific = page.getByRole('region', { name: 'パ・リーグ', exact: true })
  expect(
    await central
      .getByRole('button')
      .evaluateAll((buttons) =>
        buttons.map((b) => b.getAttribute('aria-label')),
      ),
  ).toEqual([
    '中日ドラゴンズ',
    '阪神タイガース',
    '広島東洋カープ',
    '東京ヤクルトスワローズ',
    '横浜DeNAベイスターズ',
    '読売ジャイアンツ',
  ])
  expect(
    await pacific
      .getByRole('button')
      .evaluateAll((buttons) =>
        buttons.map((b) => b.getAttribute('aria-label')),
      ),
  ).toEqual([
    '福岡ソフトバンクホークス',
    '埼玉西武ライオンズ',
    '北海道日本ハムファイターズ',
    'オリックス・バファローズ',
    '千葉ロッテマリーンズ',
    '東北楽天ゴールデンイーグルス',
  ])
  expect(
    (await page.locator('.concept-intro').boundingBox())!.height,
  ).toBeLessThan(200)
  expect(
    (await page.locator('.team-selection').boundingBox())!.height,
  ).toBeLessThan(650)
  expect(
    (await pacific
      .getByRole('button', { name: '福岡ソフトバンクホークス' })
      .locator('strong')
      .boundingBox())!.height,
  ).toBeLessThan(26)
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  }
  await central.getByRole('button', { name: '広島東洋カープ' }).click()
  await expect(page.locator('.app-shell')).toHaveAttribute('data-team', 'c')
  await expect
    .poll(() =>
      page
        .getByRole('button', { name: 'この球団ではじめる' })
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    )
    .toBe('rgb(200, 33, 39)')
  await central.getByRole('button', { name: '中日ドラゴンズ' }).click()
  await expect
    .poll(() =>
      page
        .getByRole('button', { name: 'この球団ではじめる' })
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    )
    .toBe('rgb(0, 91, 172)')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: '.cache/selection-mobile-blue.png',
    fullPage: true,
  })
  await page.getByRole('button', { name: 'この球団ではじめる' }).click()
  await expect(
    page
      .getByRole('navigation', { name: 'プレーの流れ' })
      .locator('[aria-current="step"]'),
  ).toHaveText('1候補提出')
  await expect(page.locator('.app-shell')).not.toContainText('NPC')
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: '候補を提出する' }).click()
  await page
    .getByRole('button', { name: '演出をスキップ', exact: true })
    .click()
  await expect(
    page
      .getByRole('navigation', { name: 'プレーの流れ' })
      .locator('[aria-current="step"]'),
  ).toHaveText('2希望投票')
  await page.screenshot({ path: '.cache/vote-mobile-blue.png' })
})

test('blog copy writes a formatted table and plain-text fallback to the real clipboard', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await loadResult(page)
  await expect(
    page.getByRole('button', { name: '結果を保存', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'ブログにコピー' }).click()
  await expect(page.getByRole('status')).toContainText('表付きでコピーしました')
  const copied = await page.evaluate(async () => {
    const item = (await navigator.clipboard.read())[0]
    return {
      html: await (await item.getType('text/html')).text(),
      text: await (await item.getType('text/plain')).text(),
    }
  })
  expect(copied.html).toContain('<table')
  expect(copied.text).toContain('【12球団の移籍結果】')
  expect(copied.text).toContain('非公式のシミュレーション結果')
  expect(copied.text).not.toContain('playerId')
  expect(copied.text).not.toContain('visitorId')
})

test('blocked clipboard offers selectable text instead of claiming success', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        async write() {
          throw new DOMException('blocked', 'NotAllowedError')
        },
        async writeText() {
          throw new DOMException('blocked', 'NotAllowedError')
        },
      },
    }),
  )
  await loadResult(page)
  await page.getByRole('button', { name: 'ブログにコピー' }).click()
  await expect(page.getByRole('status')).toContainText(
    '下の文章を選択してコピー',
  )
  const field = page.getByRole('textbox', { name: '貼り付け用のプレー結果' })
  await expect(field).toBeFocused()
  expect(
    await field.evaluate(
      (el) =>
        (el as HTMLTextAreaElement).selectionEnd -
        (el as HTMLTextAreaElement).selectionStart,
    ),
  ).toBeGreaterThan(100)
})
