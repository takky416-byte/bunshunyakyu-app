import { describe, expect, it } from 'vitest'
import {
  parseDataset,
  referenceDataset,
  teamIds,
  type Dataset,
  type Player,
} from './data'
import {
  advanceToUser,
  beginDraft,
  choicesFor,
  makePick,
  newGame,
  npcPick,
  restoreGame,
  startRoundTwo,
  confirmRoundTwo,
  roundTwoChoices,
  submitNominations,
  voteCount,
  type Game,
} from './engine'

const players = referenceDataset.players
function opening(team = teamIds[0], seed = 42): Game {
  const game = submitNominations(
    newGame(team, seed),
    players
      .filter((p) => p.team === team)
      .slice(0, 2)
      .map((p) => p.id),
    players,
  )
  const choice = Object.entries(game.offers).filter(
    ([t]) => t !== team,
  )[0][1]![0]
  return beginDraft(game, choice, players)
}
function completeRound(game: Game, mode: number): Game {
  let next = game
  let count = 0
  while (next.stage === 'draft') {
    expect(++count).toBeLessThanOrEqual(12)
    const choices = choicesFor(next, players)
    expect(choices.length).toBeGreaterThan(0)
    next =
      next.current === next.userTeam
        ? makePick(next, choices[mode % choices.length].id, players)
        : npcPick(next, players)
  }
  return next
}
describe('single-player draft engine', () => {
  it('validates nomination membership, duplicates and stage', () => {
    const game = newGame('t', 123)
    expect(() => submitNominations(game, ['t-1'], players)).toThrow()
    expect(() => submitNominations(game, ['t-1', 't-1'], players)).toThrow()
    expect(() => submitNominations(game, ['t-1', 'g-1'], players)).toThrow()
    const valid = submitNominations(game, ['t-1', 't-2'], players)
    expect(() => submitNominations(valid, ['t-1', 't-2'], players)).toThrow()
    expect(Object.keys(valid.offers)).toHaveLength(12)
    expect(() => beginDraft(valid, 't-1', players)).toThrow()
  })
  it('allocates exactly 12 valid ballots and starts with a highest-voted club', () => {
    const game = opening()
    expect(Object.values(game.ballots)).toHaveLength(12)
    for (const [team, id] of Object.entries(game.ballots)) {
      const player = players.find((p) => p.id === id)!
      expect(player.team).not.toBe(team)
      expect(game.offers[player.team]).toContain(id)
    }
    expect(voteCount(game, game.current!, players)).toBe(
      Math.max(...teamIds.map((t) => voteCount(game, t, players))),
    )
    expect(opening()).toEqual(game)
  })
  it('rejects self-picks, unoffered players, and duplicate picks', () => {
    let game = opening()
    const self = game.offers[game.current!]![0]
    expect(() => makePick(game, self, players)).toThrow()
    expect(() => makePick(game, 'nonexistent', players)).toThrow()
    const id = choicesFor(game, players)[0].id
    game = makePick(game, id, players)
    expect(() => makePick(game, id, players)).toThrow()
  })
  it('finishes both rounds without deadlocks for every user club and 100 seeds', () => {
    for (const team of teamIds)
      for (let seed = 0; seed < 100; seed++) {
        const first = completeRound(opening(team, seed), seed)
        expect(first.stage).toBe('round2')
        expect(first.picks).toHaveLength(12)
        expect(new Set(first.picks.map((p) => p.by)).size).toBe(12)
        expect(new Set(first.picks.map((p) => p.from)).size).toBe(12)
        const pending = startRoundTwo(first, seed % 2 === 0, players)
        expect(restoreGame(pending, players)).toEqual(pending)
        const preferences =
          pending.roundTwo!.intents[team] === 'buy'
            ? roundTwoChoices(pending, players)
                .filter((p) => p.team !== team)
                .map((p) => p.id)
            : []
        const second = confirmRoundTwo(
          pending,
          preferences,
          seed % 3 === 0 ? 'balanced' : 'unconditional',
          players,
        )
        expect(second.stage).toBe('results')
        expect(new Set(second.picks.map((p) => p.playerId)).size).toBe(
          second.picks.length,
        )
        const roundTwo = second.picks.filter((p) => p.round === 2)
        if (roundTwo.length) {
          expect(new Set(roundTwo.map((p) => p.by)).size).toBe(roundTwo.length)
          expect(new Set(roundTwo.map((p) => p.from)).size).toBe(
            roundTwo.length,
          )
        }
        for (const pick of second.picks) expect(pick.by).not.toBe(pick.from)
        expect(
          restoreGame(JSON.parse(JSON.stringify(second)), players),
        ).toEqual(second)
      }
  }, 30000)
  it('stops advancing at the human turn or the end of the round', () => {
    const game = advanceToUser(opening(), players)
    expect(game.current === game.userTeam || game.stage === 'round2').toBe(true)
    if (game.current === game.userTeam)
      expect(() => npcPick(game, players)).toThrow()
  })
  it('replays saves at every stage and rejects illegal saved actions', () => {
    const nomination = newGame('t', 71)
    expect(restoreGame(nomination, players)).toEqual(nomination)
    const vote = submitNominations(nomination, ['t-1', 't-2'], players)
    expect(restoreGame(vote, players)).toEqual(vote)
    const draft = opening('t', 71)
    expect(restoreGame(draft, players)).toEqual(draft)
    const moved = makePick(draft, choicesFor(draft, players)[0].id, players)
    expect(restoreGame(moved, players)).toEqual(moved)
    expect(() =>
      restoreGame(
        { ...moved, picks: [{ ...moved.picks[0], playerId: 'fake' }] },
        players,
      ),
    ).toThrow()
    expect(() => restoreGame({ ...draft, seed: NaN }, players)).toThrow()
    expect(() => restoreGame({ ...draft, stage: 'results' }, players)).toThrow()
  })
})

describe('2026 dataset imports', () => {
  const dataset: Dataset = {
    ...referenceDataset,
    kind: 'imported',
    season: 2026,
    asOf: '2026-10-24',
    label: 'Validation fixture, not actual 2026 data',
  }
  it('accepts a structurally complete 12-club dataset without treating it as verified', () => {
    const result = parseDataset(dataset)
    expect(result.players).toHaveLength(72)
    expect(result.kind).toBe('imported')
  })
  it.each([
    [
      'missing team',
      { ...dataset, players: players.filter((p) => p.team !== 't') },
    ],
    ['duplicate id', { ...dataset, players: [...players, players[0]] }],
    [
      'duplicate normalized name',
      {
        ...dataset,
        players: players.map((p, i) =>
          i === 1 ? { ...p, name: players[0].name.replace(/\s/g, '') } : p,
        ),
      },
    ],
    [
      'invalid team',
      {
        ...dataset,
        players: players.map((p, i) => (i === 0 ? { ...p, team: 'fake' } : p)),
      },
    ],
    [
      'invalid eligibility',
      {
        ...dataset,
        players: players.map((p, i) =>
          i === 0 ? { ...p, eligible: 'true' } : p,
        ),
      },
    ],
    [
      'no eligible candidates',
      { ...dataset, players: players.map((p) => ({ ...p, eligible: false })) },
    ],
    ['invalid date', { ...dataset, asOf: '2026-02-31' }],
    ['wrong year', { ...dataset, season: 2025 }],
    ['unsafe source URL', { ...dataset, sourceUrl: 'javascript:alert(1)' }],
  ])('rejects %s', (_, data) => expect(() => parseDataset(data)).toThrow())
  it('does not allow ineligible players to be submitted', () => {
    const modified: Player[] = players.map((p) =>
      p.id === 't-1' ? { ...p, eligible: false } : p,
    )
    expect(() =>
      submitNominations(newGame('t', 1), ['t-1', 't-2'], modified),
    ).toThrow()
  })
})
