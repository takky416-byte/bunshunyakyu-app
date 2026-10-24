import { test, expect } from './fixtures'
import { readFile } from 'node:fs/promises'

test('select a club, nominate, vote, draft, restore, and export results', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: /その選択が、\s*選手の未来を変える。/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('group', { name: '操作する球団' }).getByRole('button'),
  ).toHaveCount(12)
  await page.getByRole('button', { name: 'パ・リーグ', exact: true }).click()
  await expect(
    page.getByRole('group', { name: '操作する球団' }).getByRole('button'),
  ).toHaveCount(6)
  await page.getByRole('button', { name: /北海道日本ハムファイターズ/ }).click()
  await page.getByRole('button', { name: 'この球団ではじめる' }).click()
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
  await page.getByRole('button', { name: '投票してドラフトへ' }).click()
  for (let i = 0; i < 13; i++) {
    if (
      await page
        .getByRole('heading', { name: '第2巡の参加意向を選んでください' })
        .isVisible()
    )
      break
    if (
      await page.getByRole('button', { name: '自分の番まで進める' }).isVisible()
    )
      await page.getByRole('button', { name: '自分の番まで進める' }).click()
    else {
      await page.getByRole('radio').first().check()
      await page.getByRole('button', { name: 'この選手を指名' }).click()
    }
  }
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
  await page
    .getByRole('button', { name: '参加・入札を確定して結果を見る' })
    .click()
  await expect(
    page.getByRole('heading', { name: '12球団のドラフト結果' }),
  ).toBeVisible()
  const rows = page.locator('.result-table tbody tr')
  expect(await rows.count()).toBeGreaterThanOrEqual(12)
  const rowCount = await rows.count()
  await page.reload()
  await expect(page.locator('.result-table tbody tr')).toHaveCount(rowCount)
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '結果を保存', exact: true }).click()
  const resultFile = await downloaded
  expect(resultFile.suggestedFilename()).toMatch(
    /^geneki-draft-2026-\d+\.json$/,
  )
  const result = JSON.parse(await readFile((await resultFile.path())!, 'utf8'))
  expect(result.picks).toHaveLength(rowCount)
  expect(result.dataset.kind).toBe('official-roster')
  expect(result.rules).toBe('2026-salary-proxy-v2')
  expect(errors).toEqual([])
})

test('mobile selection, search, rules dialog, and guarded restart', async ({
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
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'この球団ではじめる' }).click()
  await page
    .getByRole('textbox', { name: '選手名で検索' })
    .fill('存在しない選手')
  await expect(page.getByText('条件に合う選手がいません。')).toBeVisible()
  await page.getByRole('button', { name: '絞り込みを解除' }).click()
  expect(await page.getByRole('checkbox').count()).toBeGreaterThanOrEqual(2)
  await page
    .getByRole('button', { name: '新しいドラフト', exact: true })
    .click()
  await page.getByRole('button', { name: '続ける', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: /提出候補を選ぶ/ }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: '新しいドラフト', exact: true })
    .click()
  await page
    .getByRole('button', { name: '球団選択に戻る', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'どの球団の未来を、つくりますか。' }),
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
  await page.getByRole('button', { name: 'この球団ではじめる' }).click()
  expect(await page.getByRole('checkbox').count()).toBeGreaterThanOrEqual(2)
})

test('reports official provenance, validates imports, and keeps user data across reload', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'データ詳細', exact: true }).click()
  const dialog = page.getByRole('dialog')
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
  await expect(page.locator('.hero-tags')).toContainText(
    '2026年の取り込みデータ',
  )
  await page.reload()
  await expect(page.locator('.data-notice')).toContainText(imported.label)
  await page.getByRole('button', { name: 'この球団ではじめる' }).click()
  await expect(page.getByRole('checkbox')).toHaveCount(2)
})
