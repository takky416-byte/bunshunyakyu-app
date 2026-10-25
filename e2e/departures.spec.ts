import { test, expect } from './fixtures'
import { startRoom } from './room-helpers'
import { readFileSync } from 'node:fs'
import type { Dataset } from '../src/data'
import { eligibilityOf } from '../src/eligibility'
import { newGame, submitNominations } from '../src/engine'
import {
  ROOM_SESSION_KEY,
  roomPhase,
  type RoomCommand,
  type RoomSnapshot,
} from '../src/room-contract'

const dataset = JSON.parse(
  readFileSync(new URL('../src/npb2026.json', import.meta.url), 'utf8'),
) as Dataset
const facts = JSON.parse(
  readFileSync(new URL('../src/eligibility2026.json', import.meta.url), 'utf8'),
)
const players = dataset.players.map((p) => ({
  ...p,
  draftFacts: facts.players[p.id],
}))

test('newly reported Dragons departures cannot be nominated in a new room', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await startRoom(page, 'd')
  const rowFor = (name: string) =>
    page
      .locator('.player-row')
      .filter({ has: page.getByText(name, { exact: true }) })
  for (const name of ['川越 誠司', '宇佐見 真吾'])
    await expect(rowFor(name)).toHaveCount(0)
  await page.locator('.data-disclosure > summary').click()
  await page.getByRole('button', { name: '対象外も表示', exact: true }).click()
  for (const name of ['川越 誠司', '宇佐見 真吾']) {
    await expect(rowFor(name).getByRole('checkbox')).toBeDisabled()
    await rowFor(name)
      .getByRole('button', { name: `${name}の詳細` })
      .click()
    await expect(page.getByRole('dialog')).toContainText(
      '戦力外・退団・引退の報道あり',
    )
    await page.keyboard.press('Escape')
  }
})

test('a report update does not disable a candidate already accepted by an ongoing room', async ({
  page,
}) => {
  const departed = players.find(
    (p) => p.team === 'd' && p.name === '川越 誠司',
  )!
  const previous = players.map((p) =>
    p.id === departed.id
      ? { ...p, draftFacts: { ...p.draftFacts, exclusions: [] } }
      : p,
  )
  const teammate = previous.find(
    (p) =>
      p.team === 'd' &&
      p.id !== departed.id &&
      eligibilityOf(p).allowed &&
      eligibilityOf(p).band === 'ordinary',
  )!
  const saved = submitNominations(
    newGame('d', 9),
    [departed.id, teammate.id],
    previous,
  )
  const game = { ...saved, userTeam: 'g' as const, seed: 0 }
  const snapshot: RoomSnapshot = {
    code: '543210',
    revision: 1,
    phase: roomPhase(game),
    me: 'me',
    host: 'me',
    members: [
      {
        id: 'me',
        name: '更新前からのGM',
        team: 'g',
        online: true,
        ready: true,
        cpu: false,
      },
    ],
    game,
    submitted: [],
    deadline: Date.now() + 180000,
    serverTime: Date.now(),
    expiresAt: Date.now() + 3600000,
    paused: false,
    presentation: null,
    messages: [],
  }
  await page.addInitScript(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          code: '543210',
          token: 'f'.repeat(64),
          memberId: 'me',
        }),
      ),
    ROOM_SESSION_KEY,
  )
  await page.route('**/api/rooms/543210', (route) =>
    route.fulfill({ json: snapshot }),
  )
  const commands: RoomCommand[] = []
  await page.routeWebSocket('**/api/rooms/543210/socket', (socket) => {
    socket.send(JSON.stringify({ type: 'state', snapshot }))
    socket.onMessage((raw) => {
      const command = JSON.parse(String(raw))
      if (command.id) {
        commands.push(command)
        socket.send(JSON.stringify({ type: 'ack', id: command.id }))
      }
    })
  })
  await page.goto('/')
  const row = page
    .locator('.player-row')
    .filter({ has: page.getByText(departed.name, { exact: true }) })
  await expect(row).toContainText('提出済み候補（提出時点の条件で進行）')
  await expect(row.getByRole('radio')).toBeEnabled()
  await row.getByRole('radio').check()
  await page
    .getByRole('button', { name: '事前投票を確定する', exact: true })
    .click()
  expect(
    commands.some(
      (c) => c.action.type === 'vote' && c.action.player === departed.id,
    ),
  ).toBe(true)
})
