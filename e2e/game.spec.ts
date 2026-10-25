import { startRoom, advanceToRoundTwo, finishRoom } from './room-helpers'
import { test, expect } from './fixtures'
import { readFile } from 'node:fs/promises'

test('select a club, nominate, vote, draft, restore, and share results', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: '現役ドラフトのGM体験' }),
  ).toBeVisible()
  await startRoom(page, 'f')
  await page.getByRole('checkbox').nth(0).check()
  await expect(
    page.getByRole('button', { name: '候補を提出する' }),
  ).toBeDisabled()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: '候補を提出する' }).click()
  await page.reload()
  await expect(
    page.getByRole('heading', { name: /獲得希望を選ぶ/ }),
  ).toBeVisible()
  await page.getByRole('radio').first().check()
  await page.getByRole('button', { name: '事前投票を確定する' }).click()
  await advanceToRoundTwo(page)
  await expect(
    page.getByRole('heading', { name: '第2巡の参加意向を選んでください' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '獲得希望で参加する' }).click()
  await expect(
    page.getByRole('heading', { name: '参加状況と入札を確認' }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('heading', { name: '参加状況と入札を確認' }),
  ).toBeVisible()
  if (await page.locator('.second-round-choices input').count()) {
    await page.locator('.second-round-choices input').first().check()
    await page.getByLabel('第2巡の入札条件').selectOption('balanced')
  }
  await page.getByRole('button', { name: '入札を確定する' }).click()
  await finishRoom(page)
  await expect(
    page.getByRole('heading', { name: '12球団のドラフト結果' }),
  ).toBeVisible()
  const rows = page.locator('.result-table tbody tr')
  expect(await rows.count()).toBeGreaterThanOrEqual(12)
  const rowCount = await rows.count()
  await page.reload()
  await expect(page.locator('.result-table tbody tr')).toHaveCount(rowCount)
  await page.getByRole('button', { name: 'プレー結果を共有' }).click()
  await expect(page.getByRole('dialog')).toContainText(
    '獲得・放出と12球団の結果',
  )
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PNG画像を保存' }).click()
  const resultFile = await downloaded
  expect(resultFile.suggestedFilename()).toMatch(/^genneki-draft-2026-f\.png$/)
  const result = await readFile((await resultFile.path())!)
  expect(result.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(result.readUInt32BE(16)).toBe(1200)
  expect(errors).toEqual([])
})

test('mobile selection, position filter, rules dialog, and guarded restart', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.getByRole('button', { name: 'ルールと遊び方' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('link')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await startRoom(page)
  await expect(page.getByRole('textbox', { name: '選手名で検索' })).toHaveCount(
    0,
  )
  const filter = page.getByRole('combobox', { name: '守備位置で絞り込み' })
  await filter.selectOption('内野手')
  const positions = await page
    .locator('.player-row .position-badge')
    .allTextContents()
  expect(positions.length).toBeGreaterThan(0)
  expect(positions.every((p) => p === '内')).toBe(true)
  await filter.selectOption('すべて')
  expect(await page.getByRole('checkbox').count()).toBeGreaterThanOrEqual(2)
  await page
    .getByRole('button', { name: 'ルームを退出する', exact: true })
    .click()
  await page.getByRole('button', { name: '続ける', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: /提出候補を選ぶ/ }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'ルームを退出する', exact: true })
    .click()
  await page
    .getByRole('button', { name: '退出してホームに戻る', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: '現役ドラフトのGM体験' }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})

test('invalid save is reported and the application remains usable', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(() =>
    localStorage.setItem('geneki-draft-room:v2', '{"broken":true}'),
  )
  await page.reload()
  await expect(page.getByRole('alert')).toContainText(
    '前回の保存データを読み込めませんでした',
  )
  await startRoom(page)
  expect(await page.getByRole('checkbox').count()).toBeGreaterThanOrEqual(2)
})

test('validates legacy data imports and uses the common official roster in new rooms', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'データ詳細', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('link')).toHaveCount(0)
  await expect(dialog).toContainText(
    '名簿・打撃・投手の計36ページを取得しました。',
  )
  const input = page.getByLabel('2026年の選手JSONファイル')
  await input.setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":0}'),
  })
  await expect(page.getByRole('status')).toContainText('version: 1')
  const ids = ['t', 'g', 'db', 'c', 's', 'd', 'h', 'f', 'm', 'e', 'b', 'l']
  const imported = {
    version: 1,
    season: 2026,
    asOf: '2026-10-24',
    sourceUrl: null,
    label: 'ブラウザ試験用データ（実選手データではありません）',
    players: ids.flatMap((t) =>
      [1, 2].map((i) => ({
        id: `${t}-test-${i}`,
        team: t,
        name: `試験用選手-${t}-${i}`,
        position: '投手',
        eligible: true,
      })),
    ),
  }
  await input.setInputFiles({
    name: 'fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported)),
  })
  await expect(page.getByRole('status')).toContainText('24名を取り込みました')
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(page.locator('.data-notice')).toContainText(
    '利用者による取り込み',
  )
  await expect(page.locator('.concept-label')).toContainText(
    '2026 現役ドラフトシミュレーション',
  )
  await page.reload()
  await expect(page.locator('.data-notice')).toContainText(imported.label)
  await startRoom(page)
  await expect(page.locator('.data-notice')).not.toContainText(imported.label)
  expect(await page.getByRole('checkbox').count()).toBeGreaterThan(2)
})
