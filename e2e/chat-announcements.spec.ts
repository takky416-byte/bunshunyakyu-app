import { test, expect } from './fixtures'
import type { WebSocketRoute } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  newGame,
  submitNominations,
  beginDraft,
  choicesFor,
  makePick,
  startRoundTwo,
  confirmRoundTwo,
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
import { teamById, teamIds, type Dataset } from '../src/data'

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
let firstRound = second
while (firstRound.stage === 'draft')
  firstRound = makePick(
    firstRound,
    choicesFor(firstRound, players)[0].id,
    players,
  )
const roundTwo = confirmRoundTwo(
  startRoundTwo(firstRound, 'out', players),
  [],
  'unconditional',
  players,
)
const roundTwoPicks = roundTwo.picks.filter((p) => p.round === 2)
const roundTwoNames = roundTwoPicks.map(
  (p) => players.find((player) => player.id === p.playerId)!.name,
)

for (const width of [390, 1280]) {
  for (const shared of [false, true]) {
    test(`automatic room announcements keep a steady dialog between CPU picks (${width}px, ${shared ? 'shared' : 'solo'})`, async ({
      page,
    }) => {
      const human = teamIds.find(
        (t) => t !== first.current && t !== second.current,
      )!
      const friend = teamIds.find(
        (t) => t !== human && t !== first.current && t !== second.current,
      )!
      const session = { code: '012345', token: 'f'.repeat(64), memberId: 'me' }
      await page.setViewportSize({ width, height: 720 })
      await page.clock.install({ time: new Date('2026-10-25T10:00:00Z') })
      await page.clock.pauseAt(new Date('2026-10-25T10:01:00Z'))
      await page.addInitScript(
        ({ key, session }) => {
          localStorage.setItem(key, JSON.stringify(session))
          localStorage.setItem('geneki-draft:presentation:v1', 'on')
          localStorage.setItem('geneki-draft:autoplay:v1', 'on')
        },
        { key: ROOM_SESSION_KEY, session },
      )
      let snapshot: RoomSnapshot = {
        code: session.code,
        revision: 1,
        phase: roomPhase(first),
        me: 'me',
        host: 'me',
        members: [
          {
            id: 'me',
            name: 'GM',
            team: human,
            online: true,
            ready: true,
            cpu: false,
          },
          ...(shared
            ? [
                {
                  id: 'friend',
                  name: '仲間',
                  team: friend,
                  online: true,
                  ready: true,
                  cpu: false,
                },
              ]
            : []),
        ],
        game: { ...first, userTeam: human },
        submitted: [],
        deadline: null,
        serverTime: Date.now(),
        expiresAt: Date.now() + 3600000,
        paused: false,
        presentation: { id: 'first', kind: 'pick', until: Date.now() + 22000 },
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
      const send = async (
        game: Game,
        presentation: RoomSnapshot['presentation'],
      ) => {
        snapshot = {
          ...snapshot,
          revision: snapshot.revision + 1,
          game: { ...game, userTeam: human },
          phase: roomPhase(game),
          presentation,
        }
        socket!.send(JSON.stringify({ type: 'state', snapshot }))
      }
      await page.goto('/')
      const dialog = page.locator('.draft-announcement')
      await expect(dialog).toBeVisible()
      const original = await dialog.elementHandle()
      await dialog.evaluate((el) => {
        Object.assign(window, { announcementCloseCount: 0 })
        el.addEventListener('close', () => {
          const state = window as unknown as { announcementCloseCount: number }
          state.announcementCloseCount++
        })
      })
      const background = await dialog.evaluate(
        (el) => getComputedStyle(el).background,
      )
      const bounds = await dialog.boundingBox()
      await page.clock.runFor(REVEAL_MS)
      await expect(dialog.locator('.announcement-name')).toBeVisible()
      await page.clock.runFor(SILENT_HOLD_MS)
      await expect(dialog).toBeVisible()
      const name = players.find(
        (p) => p.id === first.picks.at(-1)!.playerId,
      )!.name
      await expect(dialog.locator('.announcement-name')).toHaveText(name)
      const notification = shared ? 'playback' : 'presented'
      await expect
        .poll(() => commands.filter((c) => c.action.type === notification))
        .toHaveLength(1)
      await send(first, null)
      await page.clock.runFor(150)
      await expect(dialog).toBeVisible()
      await expect(dialog.locator('.announcement-name')).toHaveText(name)
      await send(second, {
        id: 'second',
        kind: 'pick',
        until: Date.now() + 22000,
      })
      await expect(dialog.locator('.announcement-name')).toHaveCount(0)
      await page.clock.runFor(REVEAL_MS)
      await expect(dialog.locator('.announcement-name')).toHaveText(
        players.find((p) => p.id === second.picks.at(-1)!.playerId)!.name,
      )
      expect(
        await dialog.evaluate((el, original) => el === original, original),
      ).toBe(true)
      expect(
        await dialog.evaluate((el) => getComputedStyle(el).background),
      ).toBe(background)
      expect(await dialog.boundingBox()).toEqual(bounds)
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { announcementCloseCount: number })
              .announcementCloseCount,
        ),
      ).toBe(0)
      await page.clock.runFor(SILENT_HOLD_MS)
      await expect
        .poll(() => commands.filter((c) => c.action.type === notification))
        .toHaveLength(2)
      // A human turn returns to the normal controls without retaining the overlay.
      await send({ ...second, current: human }, null)
      await expect(dialog).toHaveCount(0)
      // Atomic round-two results still reveal sequentially in the same dialog.
      await send(roundTwo, {
        id: 'round2-0',
        kind: 'round2',
        pickIndex: 0,
        until: Date.now() + 22000,
      })
      await expect(dialog).toBeVisible()
      const secondRoundDialog = await dialog.elementHandle()
      await page.clock.runFor(REVEAL_MS)
      await expect(dialog.locator('.announcement-name')).toBeVisible()
      await page.clock.runFor(SILENT_HOLD_MS)
      await expect(dialog.locator('.announcement-name')).toHaveText(
        roundTwoNames[0],
      )
      await send(roundTwo, {
        id: 'round2-1',
        kind: 'round2',
        pickIndex: 1,
        until: Date.now() + 22000,
      })
      await expect(dialog.locator('.announcement-name')).toHaveCount(0)
      await page.clock.runFor(REVEAL_MS)
      await expect(dialog.locator('.announcement-name')).toHaveText(
        roundTwoNames[1],
      )
      expect(
        await dialog.evaluate(
          (el, original) => el === original,
          secondRoundDialog,
        ),
      ).toBe(true)
      await dialog.getByRole('button', { name: 'この発表をスキップ' }).click()
      await expect(dialog).toHaveCount(0)
    })
  }
}

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
    snapshot = {
      ...snapshot,
      revision: snapshot.revision + 1,
      presentation: null,
    }
    socket!.send(JSON.stringify({ type: 'state', snapshot }))
    await expect(page.locator('.draft-announcement')).toBeVisible()
    await page.clock.runFor(100)
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('発表が進んでも入力できます')
    await present(second, 'third')
    await page.clock.runFor(REVEAL_MS + 50)
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
    expect(roundTwoNames.length).toBeGreaterThanOrEqual(2)
    await present(roundTwo, 'round-two-first', 'round2', 0)
    await page.clock.runFor(REVEAL_MS + 50)
    await expect(live).toContainText('第2巡')
    await expect(live).toContainText(roundTwoNames[0])
    await present(roundTwo, 'round-two-second', 'round2', 1)
    await page.clock.runFor(REVEAL_MS + 50)
    await expect(live).toContainText(roundTwoNames[1])
    await expect(chat.getByRole('textbox')).toBeEditable()
    await page.keyboard.press('Escape')
    await page
      .locator('.draft-announcement')
      .getByRole('button', { name: 'サウンド設定', exact: true })
      .click()
    const settings = page.locator('dialog.modal')
    const volume = settings.getByRole('slider')
    await volume.focus()
    await present(roundTwo, 'settings-next', 'round2', 0)
    await expect(volume).toBeFocused()
    const before = await volume.inputValue()
    await volume.press('ArrowRight')
    await expect(volume).not.toHaveValue(before)
    expect(
      await page
        .locator('.draft-announcement')
        .evaluate((el) => el.matches(':modal')),
    ).toBe(false)
    await page.keyboard.press('Escape')
    await expect(settings).toHaveCount(0)
    await page.clock.runFor(REVEAL_MS + 50)
    await expect(
      page.locator('.draft-announcement .announcement-name'),
    ).toHaveText(roundTwoNames[0])
    expect(errors).toEqual([])
  })
}
