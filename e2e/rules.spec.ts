import { startRoom } from './room-helpers'
import { test, expect } from './fixtures'
import { readFileSync } from 'node:fs'
import type { Dataset, Player } from '../src/data'
import { eligibilityOf } from '../src/eligibility'

const snapshot = JSON.parse(
  readFileSync(new URL('../src/npb2026.json', import.meta.url), 'utf8'),
) as Dataset
const facts = JSON.parse(
  readFileSync(new URL('../src/eligibility2026.json', import.meta.url), 'utf8'),
)
const officialDataset = {
  players: snapshot.players.map((p: Player) => ({
    ...p,
    draftFacts: facts.players[p.id],
  })),
}

test('high-salary exception needs two ordinary players and excluded candidates cannot be selected', async ({
  page,
}) => {
  const pool = officialDataset.players.filter(
    (p) => p.team === 'g' && eligibilityOf(p).allowed,
  )
  const exception = pool.find((p) => eligibilityOf(p).band === 'exception')!
  const ordinary = pool
    .filter((p) => eligibilityOf(p).band === 'ordinary')
    .slice(0, 2)
  expect(exception).toBeDefined()
  expect(ordinary).toHaveLength(2)
  await page.goto('/')
  await startRoom(page, 'g')
  const choose = async (name: string) =>
    page
      .locator('.player-row')
      .filter({ has: page.getByText(name, { exact: true }) })
      .getByRole('checkbox')
      .check()
  await choose(exception.name)
  await choose(ordinary[0].name)
  await expect(
    page.getByRole('button', { name: '候補を提出する' }),
  ).toBeDisabled()
  await expect(page.locator('.nomination-error')).toContainText('計3名以上')
  await choose(ordinary[1].name)
  await expect(
    page.getByRole('button', { name: '候補を提出する' }),
  ).toBeEnabled()
  await page.getByRole('button', { name: '対象外も表示' }).click()
  expect(
    await page.locator('.player-row input:disabled').count(),
  ).toBeGreaterThan(0)
  await expect(page.locator('.salary-info').first()).toContainText('万円')
})

test('legacy saves are retained rather than interpreted under new rules', async ({
  page,
}) => {
  await page.goto('/')
  const legacy = '{"legacyMarker":"do-not-delete"}'
  await page.evaluate((value) => {
    localStorage.removeItem('geneki-draft-room:v2')
    localStorage.setItem('geneki-draft-room:v1', value)
  }, legacy)
  await page.reload()
  await expect(page.getByRole('alert')).toContainText(
    '旧版の保存記録はブラウザに保持',
  )
  expect(
    await page.evaluate(() => localStorage.getItem('geneki-draft-room:v1')),
  ).toBe(legacy)
})
