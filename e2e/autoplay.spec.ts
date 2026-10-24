import { test, expect, type Page } from '@playwright/test'
import { referenceDataset } from '../src/data'
import { beginDraft, newGame, submitNominations } from '../src/engine'
import { npcAnnouncements } from '../src/announcements'
import { clubThemes } from '../src/presentation'

function scenario() {
  const players = referenceDataset.players
  for (let seed = 1; seed <= 100; seed++) {
    const nominated = submitNominations(
      newGame('t', seed),
      ['t-1', 't-2'],
      players,
    )
    const game = beginDraft(nominated, nominated.offers.g![0], players)
    const sequence = npcAnnouncements(game, players, true)
    if (sequence.length >= 3 && sequence.length <= 8) return { game, sequence }
  }
  throw new Error('Need a scenario with CPU turns before and after the human')
}
const { game, sequence } = scenario()
const saved = (page: Page) =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem('geneki-draft-room:v2')!).game,
  )
const nameAt = (index: number) =>
  referenceDataset.players.find(
    (p) => p.id === sequence[index].game.picks.at(-1)!.playerId,
  )!.name

async function setup(page: Page) {
  await page.addInitScript(
    ({ game, dataset }) => {
      sessionStorage.setItem('geneki-draft:welcome:v1', 'seen')
      // Seed once: reload must use the actual committed checkpoint.
      if (!localStorage.getItem('geneki-draft-room:v2'))
        localStorage.setItem(
          'geneki-draft-room:v2',
          JSON.stringify({ game, dataset, chosenTeam: 't' }),
        )
    },
    { game, dataset: referenceDataset },
  )
  await page.clock.install({ time: new Date('2026-10-24T09:00:00Z') })
  await page.clock.pauseAt(new Date('2026-10-24T09:01:00Z'))
  await page.goto('/')
  if (
    !(await page.evaluate(
      () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    ))
  )
    await expect(page.getByRole('dialog')).toBeVisible()
}

test('default autoplay announces each CPU with its own two colors, stops at the human, and resumes afterwards', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 667 })
  await setup(page)
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('button', { name: '指名発表の自動送り' }),
  ).toHaveAttribute('aria-pressed', 'true')
  for (let index = 0; index < sequence.length; index++) {
    await expect(dialog.locator('.announcement-name')).toHaveCount(0)
    await page.clock.runFor(1900)
    await expect(dialog.locator('.announcement-name')).toHaveText(nameAt(index))
    const club = sequence[index].game.picks.at(-1)!.by
    await expect(dialog).toHaveAttribute('data-team', club)
    await expect(page.locator('.app-shell')).toHaveAttribute('data-team', 't')
    expect(
      await dialog.evaluate((el) =>
        getComputedStyle(el).getPropertyValue('--club-accent').trim(),
      ),
    ).toBe(clubThemes[club].accent)
    expect(
      await dialog.evaluate((el) =>
        getComputedStyle(el).getPropertyValue('--club-secondary').trim(),
      ),
    ).toBe(clubThemes[club].secondary)
    expect((await saved(page)).picks).toEqual(sequence[index].game.picks)
    if (index === 0) {
      for (const viewport of [
        { width: 320, height: 568 },
        { width: 390, height: 667 },
        { width: 1280, height: 720 },
      ]) {
        await page.setViewportSize(viewport)
        const button = (await dialog.locator('.button.primary').boundingBox())!
        expect(button.y).toBeGreaterThanOrEqual(0)
        expect(button.y + button.height).toBeLessThanOrEqual(viewport.height)
        const name = (await dialog.locator('.announcement-name').boundingBox())!
        const stage = (await dialog
          .locator('.announcement-stage')
          .boundingBox())!
        expect(name.y).toBeGreaterThanOrEqual(stage.y)
        expect(name.y + name.height).toBeLessThanOrEqual(stage.y + stage.height)
        expect(
          await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true)
      }
      await page.setViewportSize({ width: 390, height: 667 })
      await page.screenshot({
        path: '.cache/autoplay-club-mobile.png',
        animations: 'disabled',
      })
    }
    await page.clock.runFor(3600)
  }
  await expect(dialog).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: /あなたの指名番です/ }),
  ).toBeVisible()
  const before = await saved(page)
  expect(before.current).toBe('t')
  await page.clock.runFor(15000)
  expect(await saved(page)).toEqual(before)
  await page.getByRole('radio').first().check()
  await page.getByRole('button', { name: 'この選手を指名' }).click()
  await expect(dialog).toHaveAttribute('data-team', 't')
  await expect(dialog).toBeVisible()
  await page.clock.runFor(1900)
  await expect(dialog.locator('.announcement-name')).toBeVisible()
  expect((await saved(page)).picks.length).toBe(before.picks.length + 1)
  await page.clock.runFor(3600)
  await expect(dialog).toHaveAttribute('data-kind', 'pick')
  await expect(dialog.locator('.announcement-name')).toHaveCount(0)
  await page.clock.runFor(1900)
  await expect(dialog.locator('.announcement-name')).toBeVisible()
  expect((await saved(page)).picks.length).toBe(before.picks.length + 2)
})

test('pause keeps the current result, permits manual steps, and survives reload', async ({
  page,
}) => {
  await setup(page)
  const dialog = page.getByRole('dialog')
  await page.clock.runFor(1900)
  await expect(dialog.locator('.announcement-name')).toHaveText(nameAt(0))
  await dialog.getByRole('button', { name: '指名発表の自動送り' }).click()
  await expect(
    dialog.getByRole('button', { name: '指名発表の自動送り' }),
  ).toHaveAttribute('aria-pressed', 'false')
  await page.clock.runFor(12000)
  expect((await saved(page)).picks).toEqual(sequence[0].game.picks)
  await dialog.getByRole('button', { name: '次の指名発表へ' }).click()
  await page.clock.runFor(1900)
  await expect(
    page.getByRole('dialog').locator('.announcement-name'),
  ).toBeVisible()
  expect((await saved(page)).picks).toEqual(sequence[1].game.picks)
  await page.reload()
  await expect(dialog).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '指名発表の自動送り' }),
  ).toHaveAttribute('aria-pressed', 'false')
  expect((await saved(page)).picks).toEqual(sequence[1].game.picks)
  await page.getByRole('button', { name: '指名発表の自動送り' }).click()
  await expect(dialog).toBeVisible()
  await page.clock.runFor(1900)
  await expect(
    page.getByRole('dialog').locator('.announcement-name'),
  ).toBeVisible()
  expect((await saved(page)).picks).toEqual(sequence[2].game.picks)
})

test('a hidden tab pauses the announcement rather than consuming unread picks', async ({
  page,
}) => {
  await setup(page)
  await page.clock.runFor(1900)
  await expect(
    page.getByRole('dialog').locator('.announcement-name'),
  ).toHaveText(nameAt(0))
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.runFor(15000)
  expect((await saved(page)).picks).toEqual(sequence[0].game.picks)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.runFor(3600)
  await expect(
    page.getByRole('dialog').locator('.announcement-name'),
  ).toHaveCount(0)
  expect((await saved(page)).picks).toEqual(sequence[0].game.picks)
  await page.clock.runFor(1900)
  await expect(
    page.getByRole('dialog').locator('.announcement-name'),
  ).toBeVisible()
  expect((await saved(page)).picks).toEqual(sequence[1].game.picks)
})

test('manual next and skip cannot double-advance a pending automatic timer', async ({
  page,
}) => {
  await setup(page)
  const dialog = page.getByRole('dialog')
  await page.clock.runFor(1900)
  await expect(dialog.locator('.announcement-name')).toHaveText(nameAt(0))
  await page.clock.runFor(3400)
  await dialog.getByRole('button', { name: '次の指名発表へ' }).click()
  await page.clock.runFor(200)
  await expect(dialog.locator('.announcement-name')).toHaveCount(0)
  expect((await saved(page)).picks).toEqual(sequence[0].game.picks)
  await page.clock.runFor(1700)
  await expect(dialog.locator('.announcement-name')).toBeVisible()
  expect((await saved(page)).picks).toEqual(sequence[1].game.picks)
  await dialog.getByRole('button', { name: /演出をスキップ/ }).click()
  await page.clock.runFor(15000)
  await expect(dialog).toHaveCount(0)
  expect((await saved(page)).picks).toEqual(sequence.at(-1)!.game.picks)
})

test('autoplay with reduced motion advances CPUs immediately and still stops before a human choice', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await setup(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: /あなたの指名番です/ }),
  ).toBeVisible()
  expect((await saved(page)).picks).toEqual(sequence.at(-1)!.game.picks)
})
