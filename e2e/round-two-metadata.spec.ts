import { test, expect } from './fixtures'
import { readFileSync } from 'node:fs'
import type { Dataset, Player } from '../src/data'
import {
  newGame,
  submitNominations,
  beginDraft,
  choicesFor,
  makePick,
  startRoundTwo,
  roundTwoChoices,
} from '../src/engine'
import { eligibilityOf } from '../src/eligibility'

const dataset = JSON.parse(
  readFileSync(new URL('../src/npb2026.json', import.meta.url), 'utf8'),
) as Dataset
const facts = JSON.parse(
  readFileSync(new URL('../src/eligibility2026.json', import.meta.url), 'utf8'),
)
dataset.players = dataset.players.map((p) => ({
  ...p,
  draftFacts: facts.players[p.id],
}))
const players = dataset.players
const nominated = players
  .filter((p) => p.team === 'd' && eligibilityOf(p).band === 'ordinary')
  .slice(0, 2)
let game = submitNominations(
  newGame('d', 9),
  nominated.map((p) => p.id),
  players,
)
game = beginDraft(game, game.offers.g![0], players)
while (game.stage === 'draft') {
  game = makePick(game, choicesFor(game, players)[0].id, players)
}
game = startRoundTwo(game, 'buy', players)
const candidates = roundTwoChoices(game, players).filter((p) => p.team !== 'd')

test('round-two choices and ordered bids show salary, age, career and first-team stats without overlapping mobile actions', async ({
  page,
}) => {
  expect(candidates.length).toBeGreaterThanOrEqual(2)
  await page.addInitScript(
    (save) =>
      localStorage.setItem('geneki-draft-room:v2', JSON.stringify(save)),
    { game, dataset, chosenTeam: 'd' },
  )
  await page.setViewportSize({ width: 320, height: 667 })
  await page.goto('/')
  const choices = page.locator('.second-round-choices > label')
  const factsFor = async (p: Player) => {
    const choice = choices.filter({
      has: page.getByText(p.name, { exact: true }),
    })
    await expect(choice.locator('.salary-info')).toContainText(
      `${p.draftFacts!.salaryManYen!.toLocaleString()}万円`,
    )
    await expect(choice.locator('.player-age')).toHaveText(/^\d+歳$/)
    await expect(choice.locator('.player-career')).toHaveText(/^プロ\d+年目$/)
    const stats = choice.locator('.player-stats')
    if (!p.stats || p.stats.games === 0) {
      await expect(stats).toHaveText('一軍出場なし')
    } else {
      await expect(stats).toContainText(
        `${p.stats.games}${p.position === '投手' ? '登板' : '試合'}`,
      )
      await expect(stats).toContainText(
        p.position === '投手' ? '防御率' : '打率',
      )
    }
    return (await choice.locator('.salary-info').textContent())!
  }
  const expected = new Map<string, string>()
  for (const p of candidates.slice(0, 2)) {
    expected.set(p.name, await factsFor(p))
    await choices
      .filter({ has: page.getByText(p.name, { exact: true }) })
      .getByRole('checkbox')
      .check()
  }
  const preferences = page.locator('.bid-preferences > li')
  await expect(preferences).toHaveCount(2)
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 667 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    for (const p of candidates.slice(0, 2)) {
      await factsFor(p)
      const bid = preferences.filter({
        has: page.getByText(p.name, { exact: true }),
      })
      await expect(bid.locator('.salary-info')).toHaveText(
        expected.get(p.name)!,
      )
      await expect(bid.locator('.player-stats')).toHaveText(
        (await choices
          .filter({ has: page.getByText(p.name, { exact: true }) })
          .locator('.player-stats')
          .textContent())!,
      )
      const fits = await bid.evaluate((el) => {
        const metadata = el
          .querySelector('.salary-info')!
          .getBoundingClientRect()
        const actions = el
          .querySelector('.bid-preference-actions')!
          .getBoundingClientRect()
        const stats = el.querySelector('.player-stats')!.getBoundingClientRect()
        return metadata.right <= actions.left && stats.right <= actions.left
      })
      expect(fits, `bid metadata at ${width}`).toBe(true)
    }
  }
  const [first, second] = candidates
  await page
    .getByRole('button', { name: `${second.name}の希望順位を上げる` })
    .click()
  await expect(preferences.first().locator('strong')).toHaveText(second.name)
  await expect(preferences.first().locator('.salary-info')).toHaveText(
    expected.get(second.name)!,
  )
  await page
    .getByRole('button', { name: `${first.name}を希望から外す` })
    .click()
  await expect(preferences).toHaveCount(1)
  await expect(
    choices
      .filter({ has: page.getByText(first.name, { exact: true }) })
      .getByRole('checkbox'),
  ).not.toBeChecked()
  await page.setViewportSize({ width: 390, height: 667 })
  await page.locator('.second-round-choices').scrollIntoViewIfNeeded()
  await page.screenshot({ path: '.cache/round-two-metadata-mobile.png' })
})
