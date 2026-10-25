import { test, expect } from './fixtures'
import type { WebSocketRoute } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  newGame,
  submitNominations,
  beginDraft,
  choicesFor,
  makePick,
  type Game,
} from '../src/engine'
import { eligibilityOf } from '../src/eligibility'
import {
  ROOM_SESSION_KEY,
  roomPhase,
  type RoomCommand,
  type RoomSnapshot,
} from '../src/room-contract'
import { REVEAL_MS, SILENT_HOLD_MS } from '../src/draftPacing'
import { teamById, type Dataset } from '../src/data'

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
const nominated = players
  .filter((p) => p.team === 'd' && eligibilityOf(p).band === 'ordinary')
  .slice(0, 2)
const offered = submitNominations(
  newGame('d', 9),
  nominated.map((p) => p.id),
  players,
)
const opening = beginDraft(offered, offered.offers.g![0], players)
const first = makePick(opening, choicesFor(opening, players)[0].id, players)
const second = makePick(first, choicesFor(first, players)[0].id, players)

for (const width of [320, 390, 768, 1280]) {
  test(`chat stays usable and displays successive picks without pausing announcements at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    const height = width === 320 ? 568 : width === 768 ? 480 : 720
    await page.setViewportSize({ width, height })
    await page.clock.install()
    await page.addInitScript((key) => {
      localStorage.setItem('geneki-draft:presentation:v1', 'on')
      localStorage.setItem(
        key,
        JSON.stringify({
          code: '012345',
          token: 'f'.repeat(64),
          memberId: 'me',
        }),
      )
    }, ROOM_SESSION_KEY)
    let snapshot: RoomSnapshot = {
      code: '012345',
      revision: 1,
      phase: 'lobby',
      me: 'me',
      host: 'friend',
      members: [
        {
          id: 'me',
          name: '確認GM',
          team: 'd',
          online: true,
          ready: true,
          cpu: false,
        },
        {
          id: 'friend',
          name: '仲間GM',
          team: 't',
          online: true,
          ready: true,
          cpu: false,
        },
      ],
      game: null,
      submitted: [],
      deadline: null,
      serverTime: Date.now(),
      expiresAt: Date.now() + 3600000,
      paused: false,
      presentation: null,
      messages: [],
    }
    let socket: WebSocketRoute | undefined
    const commands: RoomCommand[] = []
    await page.route('**/api/rooms/012345', (route) =>
      route.fulfill({ json: snapshot }),
    )
    await page.routeWebSocket('**/api/rooms/012345/socket', (route) => {
      socket = route
      route.onMessage((raw) => {
        const command = JSON.parse(String(raw))
        if (command.id) {
          commands.push(command)
          route.send(JSON.stringify({ type: 'ack', id: command.id }))
        }
      })
      route.send(JSON.stringify({ type: 'state', snapshot }))
    })
    const present = async (
      game: Game,
      id: string,
      kind: 'pick' | 'round2' = 'pick',
      pickIndex?: number,
    ) => {
      snapshot = {
        ...snapshot,
        revision: snapshot.revision + 1,
        game,
        phase: roomPhase(game),
        presentation: {
          id,
          kind,
          until: Date.now() + 22000,
          ...(pickIndex === undefined ? {} : { pickIndex }),
        },
      }
      socket!.send(JSON.stringify({ type: 'state', snapshot }))
      await expect(page.locator('.draft-announcement')).toHaveAttribute(
        'data-kind',
        kind,
      )
    }
    await page.goto('/')
    await page.getByRole('button', { name: 'チャット', exact: true }).click()
    const chat = page.locator('.room-chat')
    const input = chat.getByRole('textbox', { name: 'チャットメッセージ' })
    await input.fill('この選手、いいね！')
    await present(first, 'first')
    await page.clock.runFor(REVEAL_MS + 50)
    await expect(page.locator('.announcement-stage')).toHaveAttribute(
      'data-revealed',
      'true',
    )
    await expect(input).toBeFocused()
    await expect(input).toBeEditable()
    const picked = first.picks.at(-1)!
    const name = players.find((p) => p.id === picked.playerId)!.name
    const live = chat.getByRole('status', { name: '現在の指名発表' })
    await expect(live).toContainText(name)
    await expect(live).toContainText(teamById[picked.by].short)
    await expect(live).toContainText(teamById[picked.from].short)
    await page.clock.runFor(SILENT_HOLD_MS + 50)
    expect(
      commands.some(
        (command) =>
          command.action.type === 'playback' &&
          command.action.presentationId === 'first',
      ),
    ).toBe(true)
    await present(second, 'second')
    const next = second.picks.at(-1)!
    const nextName = players.find((p) => p.id === next.playerId)!.name
    await expect(
      page.locator('.draft-announcement .announcement-name'),
    ).toHaveCount(0)
    await page.clock.runFor(REVEAL_MS + 50)
    await expect(live).toContainText(nextName)
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('この選手、いいね！')
    await input.fill('発表が進んでも入力できます')
    const boxes = await live.evaluate((el) => {
      const a = el.getBoundingClientRect(),
        b = el.closest('dialog')!.getBoundingClientRect()
      return (
        a.left >= b.left &&
        a.right <= b.right &&
        a.top >= b.top &&
        a.bottom <= b.bottom
      )
    })
    expect(boxes).toBe(true)
    const inputBox = (await input.boundingBox())!
    expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(height)
    expect(
      await chat.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true)
    if (width >= 1200) {
      const main = (await page.locator('.draft-announcement').boundingBox())!
      const side = (await chat.boundingBox())!
      expect(main.x + main.width).toBeLessThanOrEqual(side.x)
    }
    await page.screenshot({ path: `.cache/chat-picks-${width}.png` })
    await page.keyboard.press('Escape')
    await expect(chat).not.toBeVisible()
    await expect(
      page.locator('.draft-announcement .announcement-name'),
    ).toHaveText(nextName)
    expect(
      await page
        .locator('.draft-announcement')
        .evaluate((el) => el.matches(':modal')),
    ).toBe(true)
    await page
      .locator('.draft-announcement')
      .getByRole('button', { name: 'チャット', exact: true })
      .click()
    await expect(input).toHaveValue('発表が進んでも入力できます')
    // Both round-two assignments are already final; show the announced index,
    // never the last assignment in the complete result.
    const roundTwo = {
      ...second,
      stage: 'results' as const,
      current: null,
      picks: [
        ...second.picks,
        { ...picked, round: 2 as const },
        { ...next, round: 2 as const },
      ],
    }
    await present(roundTwo, 'round-two-first', 'round2', 0)
    await page.clock.runFor(REVEAL_MS + 50)
    await expect(live).toContainText('第2巡')
    await expect(live).toContainText(name)
    await present(roundTwo, 'round-two-second', 'round2', 1)
    await page.clock.runFor(REVEAL_MS + 50)
    await expect(live).toContainText(nextName)
    await expect(chat.getByRole('textbox')).toBeEditable()
    expect(errors).toEqual([])
  })
}
