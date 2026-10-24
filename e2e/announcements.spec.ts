import { test, expect } from '@playwright/test'
import { referenceDataset } from '../src/data'
import {
  beginDraft,
  advanceToUser,
  choicesFor,
  makePick,
  newGame,
  npcPick,
  submitNominations,
  startRoundTwo,
} from '../src/engine'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem('geneki-draft:welcome:v1', 'seen'),
  )
})

function opening() {
  const game = submitNominations(
    newGame('t', 9),
    ['t-1', 't-2'],
    referenceDataset.players,
  )
  return beginDraft(game, game.offers.g![0], referenceDataset.players)
}

async function vote(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'この球団ではじめる' }).click()
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: '候補を提出する' }).click()
  await page.getByRole('radio').first().check()
  await page.getByRole('button', { name: '投票してドラフトへ' }).click()
}

test('opening waits before revealing the first club and preserves a single legal checkpoint', async ({
  page,
}) => {
  await page.clock.install()
  await vote(page)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('指名順位を確認しています')
  await expect(dialog.locator('.announcement-name')).toHaveCount(0)
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('geneki-draft-room:v2')!).game.stage,
    ),
  ).toBe('vote')
  await page.clock.runFor(1000)
  await expect(dialog.locator('.announcement-name')).toHaveCount(0)
  await page.clock.runFor(1000)
  await expect(dialog.locator('.announcement-name')).toBeVisible()
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('geneki-draft-room:v2')!).game,
  )
  expect(saved.stage).toBe('draft')
  expect(saved.picks).toHaveLength(0)
  await page.clock.runFor(800)
  await page.screenshot({ path: '.cache/announcement-desktop.png' })
  await dialog.locator('.button.primary').click()
  await expect(dialog).toHaveCount(0)
  await page.reload()
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('geneki-draft-room:v2')!).game.picks,
    ),
  ).toHaveLength(0)
})

test('NPC announcements reveal one name at a time, survive reload, and skip without duplicate picks', async ({
  page,
}) => {
  const players = referenceDataset.players
  let game = opening()
  if (game.current === game.userTeam)
    game = makePick(game, choicesFor(game, players)[0].id, players)
  const next = npcPick(game, players)
  const name = players.find((p) => p.id === next.picks.at(-1)!.playerId)!.name
  await page.addInitScript(
    ({ game, dataset }) => {
      if (!localStorage.getItem('geneki-draft-room:v2'))
        localStorage.setItem(
          'geneki-draft-room:v2',
          JSON.stringify({ game, dataset, chosenTeam: 't' }),
        )
    },
    { game, dataset: referenceDataset },
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.install()
  await page.goto('/')
  await page.getByRole('button', { name: '自分の番まで進める' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('まもなく、指名を発表します')
  await expect(dialog.locator('.announcement-name')).toHaveCount(0)
  await page.clock.runFor(1900)
  await expect(dialog.locator('.announcement-name')).toHaveText(name)
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('geneki-draft-room:v2')!).game.picks
          .length,
    ),
  ).toBe(game.picks.length + 1)
  await page.clock.runFor(800)
  await page.screenshot({ path: '.cache/announcement-mobile.png' })
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  )
  if (await dialog.getByRole('button', { name: '次の指名発表へ' }).count()) {
    await dialog.getByRole('button', { name: '次の指名発表へ' }).click()
    await expect(dialog.locator('.announcement-name')).toHaveCount(0)
  }
  await page.reload()
  await expect(dialog).toHaveCount(0)
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('geneki-draft-room:v2')!).game.picks,
    ),
  ).toEqual(next.picks)
  if (next.stage === 'draft' && next.current !== next.userTeam) {
    await page.getByRole('button', { name: '自分の番まで進める' }).click()
    await dialog.getByRole('button', { name: /演出をスキップ/ }).click()
    const saved = await page.evaluate(
      () => JSON.parse(localStorage.getItem('geneki-draft-room:v2')!).game,
    )
    expect(new Set(saved.picks.map((p: { by: string }) => p.by)).size).toBe(
      saved.picks.length,
    )
    await page.clock.runFor(5000)
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('geneki-draft-room:v2')!).game.picks,
      ),
    ).toEqual(saved.picks)
  }
})

test('presentation preference persists and reduced-motion users can progress immediately', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'この球団ではじめる' }).click()
  const toggle = page.getByRole('button', { name: '指名発表の演出' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await toggle.click()
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(toggle).toBeDisabled()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: '候補を提出する' }).click()
  await page.getByRole('radio').first().check()
  await page.getByRole('button', { name: '投票してドラフトへ' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('geneki-draft-room:v2')!).game.stage,
    ),
  ).toBe('draft')
})

test('a human pick can be skipped with Escape and is committed exactly once', async ({
  page,
}) => {
  const players = referenceDataset.players
  const game = advanceToUser(opening(), players)
  await page.addInitScript(
    ({ game, dataset }) =>
      localStorage.setItem(
        'geneki-draft-room:v2',
        JSON.stringify({ game, dataset, chosenTeam: 't' }),
      ),
    { game, dataset: referenceDataset },
  )
  await page.goto('/')
  await page.getByRole('radio').first().check()
  const name = await page
    .locator('.player-row.checked .player-name strong')
    .textContent()
  await page.getByRole('button', { name: 'この選手を指名' }).click()
  await expect(page.getByRole('dialog')).toContainText(
    'まもなく、指名を発表します',
  )
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('geneki-draft-room:v2')!).game.picks
          .length,
    ),
  ).toBe(game.picks.length)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('geneki-draft-room:v2')!).game,
  )
  expect(saved.picks).toHaveLength(game.picks.length + 1)
  expect(saved.picks.at(-1).by).toBe('t')
  expect(players.find((p) => p.id === saved.picks.at(-1).playerId)!.name).toBe(
    name,
  )
})

test('second-round results stay pending until announcement and then lead to the final results', async ({
  page,
}) => {
  const players = referenceDataset.players
  let game = opening()
  while (game.stage === 'draft')
    game = makePick(game, choicesFor(game, players)[0].id, players)
  game = startRoundTwo(game, 'out', players)
  await page.addInitScript(
    ({ game, dataset }) =>
      localStorage.setItem(
        'geneki-draft-room:v2',
        JSON.stringify({ game, dataset, chosenTeam: 't' }),
      ),
    { game, dataset: referenceDataset },
  )
  await page.clock.install()
  await page.goto('/')
  await page
    .getByRole('button', { name: '参加・入札を確定して結果を見る' })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('入札の成立を確認しています')
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('geneki-draft-room:v2')!).game.stage,
    ),
  ).toBe('round2confirm')
  await page.clock.runFor(1900)
  await expect(dialog.locator('.announcement-result-label')).toHaveText(
    'SECOND ROUND',
  )
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('geneki-draft-room:v2')!).game.stage,
    ),
  ).toBe('results')
  await dialog.getByRole('button', { name: 'ドラフト結果を見る' }).click()
  await expect(
    page.getByRole('heading', { name: '12球団のドラフト結果' }),
  ).toBeVisible()
})

test('larger type remains readable without page overflow at phone, tablet and desktop widths', async ({
  page,
}) => {
  await page.goto('/')
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `home width ${width}`,
    ).toBe(true)
    expect(
      await page
        .getByRole('button', { name: 'この球団ではじめる' })
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16)
  }
  await page.getByRole('button', { name: 'この球団ではじめる' }).click()
  await expect(page.locator('.transfer-rule-note')).toContainText(
    '他の条件を満たせば対象',
  )
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `roster width ${width}`,
    ).toBe(true)
    expect(
      await page
        .locator('.player-name strong')
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(18)
    expect(
      await page
        .locator('.salary-info')
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(14)
    if ([390, 1280].includes(width))
      await page.screenshot({
        path: `.cache/readability-${width}.png`,
        fullPage: true,
      })
  }
  await page.getByRole('button', { name: 'ルールと遊び方' }).click()
  await expect(page.getByRole('dialog')).toContainText(
    '前年の現役ドラフトで獲得した選手は引き続き対象外',
  )
})
