import { test, expect } from './fixtures'
import { createRoom, roomSnapshot, finishRoom } from './room-helpers'
import { PLAYER_NAME_KEY, ROOM_SESSION_KEY } from '../src/room-contract'

test('two browser sessions join by number, reserve clubs, chat, reconnect and submit secretly', async ({
  page,
  browser,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  const code = await createRoom(page, 'd', '主催GM')
  expect(code).toMatch(/^\d{6}$/)
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  await context.addInitScript(() => {
    sessionStorage.setItem('geneki-draft:welcome:v1', 'seen')
    localStorage.setItem('geneki-draft:presentation:v1', 'off')
  })
  const guest = await context.newPage()
  guest.on('pageerror', (e) => errors.push(e.message))
  await guest.goto('/')
  await guest.getByLabel('プレーヤー名', { exact: true }).fill('仲間GM')
  await guest.getByLabel('ルーム番号', { exact: true }).fill(code)
  await guest.getByRole('button', { name: 'ルームに入る', exact: true }).click()
  await expect(
    guest.getByRole('region', { name: 'ルームの待合室' }),
  ).toBeVisible()
  await expect(guest.getByRole('button', { name: /^中日/ })).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'ドラフトを開始する', exact: true }),
  ).toBeDisabled()
  await guest
    .getByRole('button', { name: '東北楽天ゴールデンイーグルス', exact: true })
    .click()
  await expect(guest.locator('.app-shell')).toHaveAttribute('data-team', 'e')
  await guest.getByRole('button', { name: '準備完了', exact: true }).click()
  await page.getByRole('button', { name: 'チャット', exact: true }).click()
  await page
    .getByLabel('チャットメッセージ')
    .fill('<script>仲間だけの作戦会議</script>')
  await page.getByRole('button', { name: 'メッセージを送信' }).click()
  await expect(page.getByLabel('チャットの履歴')).toContainText(
    '<script>仲間だけの作戦会議</script>',
  )
  await page.getByRole('button', { name: 'チャットを閉じる' }).click()
  await expect(guest.getByRole('button', { name: /チャット/ })).toContainText(
    '1',
  )
  await guest.getByRole('button', { name: /チャット/ }).click()
  await expect(guest.getByLabel('チャットの履歴')).toContainText(
    '仲間だけの作戦会議',
  )
  await guest.getByRole('button', { name: 'いい指名！', exact: true }).click()
  await guest.getByRole('button', { name: 'チャットを閉じる' }).click()
  const identity = await guest.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).memberId,
    ROOM_SESSION_KEY,
  )
  await guest.reload()
  expect(
    await guest.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).memberId,
      ROOM_SESSION_KEY,
    ),
  ).toBe(identity)
  await expect(
    guest.getByRole('button', {
      name: '東北楽天ゴールデンイーグルス',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page
    .getByRole('button', { name: 'ドラフトを開始する', exact: true })
    .click()
  await expect(
    guest.getByRole('heading', { name: /提出候補を選ぶ/ }),
  ).toBeVisible()
  await page.getByRole('button', { name: '一時停止', exact: true }).click()
  await expect(
    guest.getByRole('heading', { name: '進行を一時停止しています' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '進行を再開', exact: true }).click()
  for (const p of [page, guest]) {
    await p.getByRole('checkbox').nth(0).check()
    await p.getByRole('checkbox').nth(1).check()
  }
  await page.getByRole('button', { name: '候補を提出する' }).click()
  await expect(
    page.getByRole('heading', { name: '提出を受け付けました' }),
  ).toBeVisible()
  const secret = await roomSnapshot(guest)
  expect(secret.game!.offers).toEqual({})
  expect(secret.submitted).toHaveLength(11)
  await guest.getByRole('button', { name: '候補を提出する' }).click()
  await expect(
    page.getByRole('heading', { name: /獲得希望を選ぶ/ }),
  ).toBeVisible()
  await page.getByRole('radio').first().check()
  await page.getByRole('button', { name: '投票してドラフトへ' }).click()
  expect((await roomSnapshot(guest)).game!.ballots).toEqual({})
  await guest.getByRole('radio').first().check()
  await guest.getByRole('button', { name: '投票してドラフトへ' }).click()
  await expect
    .poll(async () => (await roomSnapshot(page)).game!.stage)
    .toBe('draft')
  const before = (await roomSnapshot(guest)).game!
  await guest.reload()
  await expect
    .poll(async () => (await roomSnapshot(guest)).game!.stage)
    .toBe('draft')
  expect((await roomSnapshot(guest)).game!.offers).toEqual(before.offers)
  expect(
    await guest.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await guest
    .getByRole('button', { name: 'ルームを退出する', exact: true })
    .click()
  await guest.getByRole('button', { name: '退出してホームに戻る' }).click()
  await expect(
    guest.getByRole('button', { name: 'ルームを作る', exact: true }),
  ).toBeVisible()
  expect(
    await guest.evaluate((key) => localStorage.getItem(key), ROOM_SESSION_KEY),
  ).toBeNull()
  expect(
    await guest.evaluate((key) => localStorage.getItem(key), PLAYER_NAME_KEY),
  ).toBe('仲間GM')
  await finishRoom(page)
  const result = await roomSnapshot(page)
  expect(result.game!.picks.filter((p) => p.round === 1)).toHaveLength(12)
  await page.getByRole('button', { name: 'プレー結果を共有' }).click()
  await expect(
    page.getByRole('textbox', { name: '貼り付け用のプレー結果' }),
  ).toHaveValue(/【12球団の移籍結果】/)
  expect(errors).toEqual([])
  await context.close()
})

test('one player can start immediately, finish both rounds and restore the completed room', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/')
  await createRoom(page, 'g', 'ひとりGM')
  await page
    .getByRole('button', { name: 'ドラフトを開始する', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: /提出候補を選ぶ/ }),
  ).toBeFocused()
  const submit = page.getByRole('button', { name: '候補を提出する' })
  const box = (await submit.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(568)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.setViewportSize({ width: 390, height: 667 })
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: '候補を提出する' }).click()
  await page.getByRole('radio').first().check()
  await page.getByRole('button', { name: '投票してドラフトへ' }).click()
  await finishRoom(page, true, true)
  const result = (await roomSnapshot(page)).game!
  await page.reload()
  await expect(
    page.getByRole('heading', { name: '12球団のドラフト結果' }),
  ).toBeVisible()
  expect((await roomSnapshot(page)).game!.picks).toEqual(result.picks)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})
