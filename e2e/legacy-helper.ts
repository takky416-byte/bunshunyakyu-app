import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { EligibilityFacts } from '../src/eligibility'
const snapshot = JSON.parse(
  readFileSync(new URL('../src/npb2026.json', import.meta.url), 'utf8'),
) as Dataset
const facts = JSON.parse(
  readFileSync(new URL('../src/eligibility2026.json', import.meta.url), 'utf8'),
).players as Record<string, EligibilityFacts>
const officialDataset: Dataset = {
  ...snapshot,
  players: snapshot.players.map((p) => ({ ...p, draftFacts: facts[p.id] })),
}
import { newGame } from '../src/engine'
import type { Dataset, TeamId } from '../src/data'

// Existing local saves remain playable. Presentation/replay regression tests
// start at a saved checkpoint; rooms.spec.ts covers the new network entry.
export async function legacyStart(
  page: Page,
  team: TeamId = 't',
  dataset: Dataset = officialDataset,
) {
  await page.goto('/')
  await page.evaluate(
    ({ dataset, game, team }) => {
      localStorage.removeItem('geneki-draft:room-session:v1')
      localStorage.setItem(
        'geneki-draft-room:v2',
        JSON.stringify({ dataset, game, chosenTeam: team }),
      )
    },
    { dataset, game: newGame(team, 9), team },
  )
  await page.reload()
}
