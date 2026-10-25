import { test, expect } from './fixtures'
import type { WebSocketRoute } from '@playwright/test'
import { createRoom, roomSnapshot, startRoom } from './room-helpers'
import { referenceDataset } from '../src/data'
import { ROOM_SESSION_KEY } from '../src/room-contract'

test('a failed exit preserves the participant and an HTTP retry confirms departure', async ({
  page,
}) => {
  await page.goto('/')
  await createRoom(page)
  const before = await page.evaluate(
    (key) => localStorage.getItem(key),
    ROOM_SESSION_KEY,
  )
  await page.route('**/api/rooms/*/actions', (route) => route.abort('failed'))
  await page
    .getByRole('button', { name: 'ルームを退出する', exact: true })
    .click()
  await expect(page.getByRole('dialog')).toContainText('空席に戻ります')
  await page.getByRole('button', { name: '退出してホームに戻る' }).click()
  await expect(page.getByRole('alert')).toContainText(
    '退出を確認できませんでした',
  )
  expect(
    await page.evaluate((key) => localStorage.getItem(key), ROOM_SESSION_KEY),
  ).toBe(before)
  expect((await roomSnapshot(page)).members).toHaveLength(1)
  await expect(
    page.getByRole('region', { name: 'ルームの待合室' }),
  ).toBeVisible()
  await page.unroute('**/api/rooms/*/actions')
  await page
    .getByRole('button', { name: 'ルームを退出する', exact: true })
    .click()
  await page.getByRole('button', { name: '退出してホームに戻る' }).click()
  await expect(
    page.getByRole('button', { name: 'ルームを作る', exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate((key) => localStorage.getItem(key), ROOM_SESSION_KEY),
  ).toBeNull()
})

test('a reconnecting player can leave over HTTP and immediately release their club', async ({
  page,
}) => {
  let socket: WebSocketRoute | undefined,
    reconnecting = false
  await page.routeWebSocket('**/api/rooms/*/socket', (route) => {
    if (reconnecting) {
      route.close({ code: 1011, reason: 'temporary interruption' })
      return
    }
    socket = route
    route.connectToServer()
  })
  await page.goto('/')
  await startRoom(page, 'd')
  const session = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    ROOM_SESSION_KEY,
  )
  reconnecting = true
  socket!.close({ code: 1011, reason: 'temporary interruption' })
  await expect(page.locator('.room-connection')).toHaveText('再接続中…')
  await page
    .getByRole('button', { name: 'ルームを退出する', exact: true })
    .click()
  await page.getByRole('button', { name: '退出してホームに戻る' }).click()
  await expect(
    page.getByRole('button', { name: 'ルームを作る', exact: true }),
  ).toBeVisible()
  const status = await page.evaluate(
    async (session) =>
      (
        await fetch(`/api/rooms/${session.code}`, {
          headers: { Authorization: 'Bearer ' + session.token },
        })
      ).status,
    session,
  )
  expect(status).toBe(401)
})

test('expiry during an announcement closes obsolete overlays and leads to a usable home', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let socket: WebSocketRoute | undefined,
    hold = false
  await page.routeWebSocket('**/api/rooms/*/socket', (route) => {
    socket = route
    const server = route.connectToServer()
    server.onMessage((message) => {
      const data = JSON.parse(String(message))
      if (data.type === 'state' && data.snapshot.presentation) {
        if (!hold) {
          hold = true
          route.send(message)
        }
        return
      }
      if (data.type === 'state' && hold) return
      route.send(message)
    })
  })
  await page.goto('/')
  await startRoom(page, 'd')
  await page.getByRole('button', { name: '指名発表の演出' }).click()
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: '候補を提出する' }).click()
  await expect(page.locator('dialog.draft-announcement')).toBeVisible()
  socket!.close({ code: 4004, reason: 'expired' })
  await expect(page.getByRole('alert')).toContainText('有効期限が終了')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: 'ルームを確認してください' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'ホームに戻る', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'ルームを作る', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'ルームの待合室' }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'データ詳細', exact: true }).click()
  await page.getByLabel('2026年の選手JSONファイル').setInputFiles({
    name: 'reference.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        ...referenceDataset,
        season: 2026,
        asOf: '2026-10-24',
        label: '試験用データ',
      }),
    ),
  })
  await expect(page.getByRole('status')).toContainText('取り込みました')
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '現役ドラフトのGM体験' }),
  ).toBeVisible()
  expect(errors).toEqual([])
})

test('an incompatible saved room reports its error instead of retrying forever', async ({
  page,
}) => {
  await page.goto('/')
  const code = await createRoom(page)
  await page.route(`**/api/rooms/${code}`, (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'ルールが更新されました。新しいルームを作ってください。',
      }),
    }),
  )
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'ルームを確認してください' }),
  ).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('ルールが更新')
  await page.getByRole('button', { name: 'ホームに戻る', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'ルームを作る', exact: true }),
  ).toBeVisible()
})

test('a browser which cannot remember room credentials is warned before it reloads', async ({
  page,
}) => {
  await page.addInitScript((key) => {
    const write = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('quota', 'QuotaExceededError')
      write.call(this, name, value)
    }
  }, ROOM_SESSION_KEY)
  await page.goto('/')
  await page.getByLabel('プレーヤー名', { exact: true }).fill('保存確認GM')
  await page.getByRole('button', { name: 'ルームを作る', exact: true }).click()
  await expect(
    page.getByRole('region', { name: 'ルームの待合室' }),
  ).toBeVisible()
  await expect(page.getByRole('alert')).toContainText(
    '参加情報を保存できません',
  )
  await page
    .getByRole('button', { name: 'ルームを退出する', exact: true })
    .click()
  await page.getByRole('button', { name: '退出してホームに戻る' }).click()
  await expect(
    page.getByRole('button', { name: 'ルームを作る', exact: true }),
  ).toBeVisible()
})
