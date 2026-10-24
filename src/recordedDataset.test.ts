import { expect, it } from 'vitest'
import { officialDataset } from './officialData'
import { recordedOfficialDataset } from './recordedDataset'
import { eligibilityOf } from './eligibility'
import { newGame, restoreGame, submitNominations } from './engine'

it('retains conditions of a submitted draft without changing the current official dataset', () => {
  const previous = structuredClone(officialDataset)
  const departed = previous.players.find(
    (p) => p.team === 'c' && p.name === 'ケムナ 誠',
  )!
  departed.draftFacts!.exclusions = []
  departed.draftFacts!.holds = []
  const other = previous.players.find(
    (p) =>
      p.team === 'c' &&
      p.id !== departed.id &&
      eligibilityOf(p).allowed &&
      eligibilityOf(p).band === 'ordinary',
  )!
  const game = submitNominations(
    newGame('c', 1234),
    [departed.id, other.id],
    previous.players,
  )
  expect(() => restoreGame(game, officialDataset.players)).toThrow()
  const recorded = recordedOfficialDataset(JSON.parse(JSON.stringify(previous)))
  expect(restoreGame(game, recorded.players)).toEqual(game)
  expect(
    eligibilityOf(officialDataset.players.find((p) => p.id === departed.id)!)
      .allowed,
  ).toBe(false)
  expect(() =>
    recordedOfficialDataset({
      ...previous,
      players: previous.players.slice(1),
    }),
  ).toThrow()
  const corrupt = structuredClone(previous)
  corrupt.players[0].draftFacts!.salaryManYen = -1
  expect(() => recordedOfficialDataset(corrupt)).toThrow()
})
