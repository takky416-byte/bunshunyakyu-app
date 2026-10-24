import { describe, expect, it } from 'vitest'
import { teamIds, referenceDataset, type Player } from './data'
import { officialDataset } from './officialData'
import { eligibilityOf } from './eligibility'
import { protectedForCpu, variedCandidates } from './cpuCandidates'
import { newGame, restoreGame, submitNominations } from './engine'
import legacy from '../e2e/fixtures/legacy-game-v2.json'

describe('varied CPU candidate selection', () => {
  it('varies each club’s pair while protecting core players and keeping eligibility restrictions', () => {
    const players = officialDataset.players
    for (const team of teamIds) {
      const combinations = new Set<string>()
      for (let seed = 0; seed < 40; seed++) {
        const ids = variedCandidates(team, players, seed)
        expect(new Set(ids).size).toBe(2)
        combinations.add([...ids].sort().join(','))
        for (const id of ids) {
          const p = players.find((p) => p.id === id)!
          expect(p.team).toBe(team)
          expect(eligibilityOf(p).allowed).toBe(true)
          expect(eligibilityOf(p).band).toBe('ordinary')
          expect(protectedForCpu(p)).toBe(false)
        }
      }
      expect(combinations.size, team).toBeGreaterThan(8)
    }
  })
  it('replays exactly, is independent of array order, and refuses to fill shortages with core players', () => {
    const players = officialDataset.players
    expect(variedCandidates('d', players, 21)).toEqual(
      variedCandidates('d', [...players].reverse(), 21),
    )
    const p = players.find(
      (p) =>
        p.team === 'd' &&
        eligibilityOf(p).allowed &&
        eligibilityOf(p).band === 'ordinary',
    )!
    const star: Player = {
      ...p,
      id: 'test-core',
      position: '内野手',
      stats: { games: 140, plateAppearances: 500 },
    }
    const young: Player = {
      ...p,
      id: 'test-young',
      birthDate: '2007-01-01',
      stats: null,
    }
    expect(protectedForCpu(star)).toBe(true)
    expect(protectedForCpu(young)).toBe(true)
    expect(() => variedCandidates('d', [star, young, p], 1)).toThrow('不足')
  })
  it('restores actual old results without reselecting their CPU nominees', () => {
    expect(restoreGame(legacy.game, referenceDataset.players)).toEqual(
      legacy.game,
    )
    const game = submitNominations(
      newGame('t', 909),
      ['t-1', 't-2'],
      referenceDataset.players,
    )
    expect(game.cpuNominationModel).toBe('varied-v1')
    expect(
      restoreGame(JSON.parse(JSON.stringify(game)), referenceDataset.players),
    ).toEqual(game)
    expect(() =>
      restoreGame(
        { ...legacy.game, cpuNominationModel: 'unknown' },
        referenceDataset.players,
      ),
    ).toThrow()
  })
})
