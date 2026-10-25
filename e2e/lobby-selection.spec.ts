import { test, expect } from './fixtures'
import { createRoom, roomSnapshot } from './room-helpers'
import { teamIds } from '../src/data'
import {
  ROOM_SESSION_KEY,
  type RoomAction,
  type RoomSession,
} from '../src/room-contract'

test('a full room enters unselected and exchanges clubs by releasing them without losing participants', async ({
  page,
  browser,
}) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  const code = await createRoom(page, undefined, '主催GM')
  const me = (await roomSnapshot(page)).members[0]
  expect(me.team).toBeNull()
  await expect(page.locator('.lobby-team[aria-pressed="true"]')).toHaveCount(0)
  await expect(page.getByRole('status', { name: '担当球団' })).toContainText(
    '未選択',
  )
  await expect(
    page.getByRole('button', { name: '準備完了', exact: true }),
  ).toBeDisabled()
  const start = page.getByRole('button', {
    name: 'ドラフトを開始する',
    exact: true,
  })
  await expect(start).toBeDisabled()
  await expect(page.locator('.app-shell')).toHaveAttribute(
    'data-team',
    'unselected',
  )
  const context = await browser.newContext({
    viewport: { width: 320, height: 668 },
  })
  await context.addInitScript(() => {
    sessionStorage.setItem('geneki-draft:welcome:v1', 'seen')
    localStorage.setItem('geneki-draft:presentation:v1', 'off')
  })
  const guest = await context.newPage()
  guest.on('pageerror', (error) => errors.push(error.message))
  try {
    await guest.goto('/')
    await guest.getByLabel('プレーヤー名', { exact: true }).fill('交換相手GM')
    await guest.getByLabel('ルーム番号', { exact: true }).fill(code)
    await guest
      .getByRole('button', { name: 'ルームに入る', exact: true })
      .click()
    await expect(guest.getByRole('status', { name: '担当球団' })).toContainText(
      '未選択',
    )
    await expect(guest.locator('.lobby-team[aria-pressed="true"]')).toHaveCount(
      0,
    )
    await guest.getByRole('button', { name: 'チャット', exact: true }).click()
    await guest
      .getByRole('textbox', { name: 'チャットメッセージ' })
      .fill('球団を交換しましょう')
    await guest.getByRole('button', { name: 'メッセージを送信' }).click()
    await expect(guest.getByLabel('チャットの履歴')).toContainText(
      '球団を交換しましょう',
    )
    await guest.getByRole('button', { name: 'チャットを閉じる' }).click()
    await page
      .getByRole('button', { name: '中日ドラゴンズ', exact: true })
      .click()
    await guest
      .getByRole('button', { name: '読売ジャイアンツ', exact: true })
      .click()
    await guest.getByRole('button', { name: '準備完了', exact: true }).click()
    const sessions: RoomSession[] = []
    for (let i = 0; i < 10; i++) {
      const response = await page.request.post(`/api/rooms/${code}/join`, {
        data: { name: '追加参加者' + i },
      })
      expect(response.status()).toBe(201)
      sessions.push(await response.json())
    }
    await page.evaluate(async (sessions) => {
      const peers = await Promise.all(
        sessions.map(
          (session) =>
            new Promise<WebSocket>((resolve, reject) => {
              const socket = new WebSocket(
                `${location.origin.replace(/^http/, 'ws')}/api/rooms/${session.code}/socket`,
                ['draft-room', 'session.' + session.token],
              )
              socket.onmessage = (event) => {
                if (JSON.parse(event.data).type === 'state') resolve(socket)
              }
              socket.onerror = () => reject(new Error('Peer did not connect'))
            }),
        ),
      )
      Object.assign(window, { __lobbyPeers: peers })
    }, sessions)
    const command = async (
      session: RoomSession,
      action: RoomAction,
      phase = 'lobby',
    ) =>
      page.request.post(`/api/rooms/${code}/actions`, {
        headers: { Authorization: 'Bearer ' + session.token },
        data: { id: crypto.randomUUID(), phase, action },
      })
    const otherClubs = teamIds.filter((team) => team !== 'd' && team !== 'g')
    await Promise.all(
      sessions.map(async (session, i) => {
        expect(
          (await command(session, { type: 'team', team: otherClubs[i] })).ok(),
        ).toBe(true)
        expect(
          (await command(session, { type: 'ready', ready: true })).ok(),
        ).toBe(true)
      }),
    )
    await expect(start).toBeEnabled()
    await guest
      .getByRole('button', { name: '読売ジャイアンツ', exact: true })
      .click()
    await expect(guest.getByRole('status', { name: '担当球団' })).toContainText(
      '未選択',
    )
    await expect(
      guest.getByRole('button', { name: '準備完了', exact: true }),
    ).toBeDisabled()
    await expect(start).toBeDisabled()
    await expect(guest.locator('.app-shell')).toHaveAttribute(
      'data-team',
      'unselected',
    )
    await page.getByRole('button', { name: '選択を解除', exact: true }).click()
    await expect(page.getByRole('status', { name: '担当球団' })).toContainText(
      '未選択',
    )
    await page
      .getByRole('button', { name: '読売ジャイアンツ', exact: true })
      .click()
    await guest
      .getByRole('button', { name: '中日ドラゴンズ', exact: true })
      .click()
    await guest.reload()
    await expect(
      guest.getByRole('button', { name: '中日ドラゴンズ', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      guest.getByRole('button', { name: '準備完了', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false')
    await expect(start).toBeDisabled()
    await guest.getByRole('button', { name: '準備完了', exact: true }).click()
    await expect(start).toBeEnabled()
    for (const current of [page, guest]) {
      expect(
        await current.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
    const footer = (await guest.locator('.lobby-footer').boundingBox())!
    expect(footer.y + footer.height).toBeLessThanOrEqual(668)
    await expect(guest.locator('.room-lobby h1 .text-unit')).toHaveCount(2)
    for (const unit of await guest.locator('.room-lobby h1 .text-unit').all())
      expect(await unit.evaluate((el) => el.getClientRects().length)).toBe(1)
    await guest.screenshot({ path: '.cache/lobby-exchange-mobile.png' })
    await start.click()
    const state = await roomSnapshot(page)
    expect(state.game?.userTeam).toBe('g')
    expect((await roomSnapshot(guest)).game?.userTeam).toBe('d')
    expect(state.members).toHaveLength(12)
    expect(new Set(state.members.map((member) => member.team)).size).toBe(12)
    const hostSession: RoomSession = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      ROOM_SESSION_KEY,
    )
    expect(
      (
        await command(hostSession, { type: 'team', team: null }, state.phase)
      ).status(),
    ).toBe(409)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})
