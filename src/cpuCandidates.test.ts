import { describe, expect, it } from 'vitest'
import { teamIds, referenceDataset, type Player } from './data'
import { officialDataset } from './officialData'
import { eligibilityOf } from './eligibility'
import {
  protectedForCpu,
  variedCandidates,
  protectedForRealisticCpu,
  realisticCandidates,
} from './cpuCandidates'
import { newGame, restoreGame, submitNominations } from './engine'
import legacy from '../e2e/fixtures/legacy-game-v2.json'
import draftHistory from './cpuDraft2026.json'

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
    expect(game.cpuNominationModel).toBe('realistic-v2')
    expect(
      restoreGame(JSON.parse(JSON.stringify(game)), referenceDataset.players),
    ).toEqual(game)
    const old = submitNominations(
      { ...newGame('t', 909), cpuNominationModel: 'varied-v1' },
      ['t-1', 't-2'],
      referenceDataset.players,
    )
    expect(
      restoreGame(JSON.parse(JSON.stringify(old)), referenceDataset.players),
    ).toEqual(old)
    expect(() =>
      restoreGame(
        { ...legacy.game, cpuNominationModel: 'unknown' },
        referenceDataset.players,
      ),
    ).toThrow()
  })
})

describe('realistic CPU nomination model', () => {
  it('protects every recorded rookie and recent high pick, including changed registered names', () => {
    const byId = new Map(officialDataset.players.map((p) => [p.id, p]))
    expect(
      draftHistory.sources.filter((s) => s.url.includes('/draft/')),
    ).toHaveLength(36)
    for (const [id, record] of Object.entries(draftHistory.players)) {
      const player = byId.get(id)!
      expect(player.name).toBe(record.name)
      if (
        record.year === 2025 ||
        (record.year >= 2023 && !record.development && record.round <= 3)
      )
        expect(protectedForRealisticCpu(player), player.name).toBe(true)
    }
    for (const name of [
      '伊原 陵人',
      '下村 海翔',
      '常廣 羽也斗',
      '立石 正広',
      'エドポロ ケイン',
      '山崎 太陽',
      '北斗',
      '大聖',
    ]) {
      const player = officialDataset.players.find((p) => p.name === name)!
      // Strip age and 2026 statistics: draft history must protect them by itself.
      expect(
        protectedForRealisticCpu({
          ...player,
          birthDate: undefined,
          stats: null,
        }),
        name,
      ).toBe(true)
    }
  })
  it('protects active first-team contributors, emerging performers and young players at the boundaries', () => {
    const p: Player = {
      ...referenceDataset.players[0],
      birthDate: '1998-01-01',
      position: '投手',
    }
    for (const stats of [
      { games: 20 },
      { games: 1, innings: '30' },
      { games: 1, wins: 3 },
      { games: 1, saves: 3 },
      { games: 8, innings: '10', era: 3 },
    ])
      expect(protectedForRealisticCpu({ ...p, stats })).toBe(true)
    expect(
      protectedForRealisticCpu({
        ...p,
        stats: { games: 19, innings: '29.2', era: 3.01 },
      }),
    ).toBe(false)
    expect(
      protectedForRealisticCpu({
        ...p,
        stats: { games: 8, innings: '9.2', era: 3 },
      }),
    ).toBe(false)
    for (const stats of [
      { games: 60 },
      { games: 40, plateAppearances: 100 },
      { games: 30, homeRuns: 5 },
      { games: 20, plateAppearances: 40, ops: 0.75 },
    ])
      expect(
        protectedForRealisticCpu({ ...p, position: '内野手', stats }),
      ).toBe(true)
    expect(
      protectedForRealisticCpu({
        ...p,
        position: '捕手',
        stats: { games: 25 },
      }),
    ).toBe(true)
    expect(
      protectedForRealisticCpu({ ...p, birthDate: '2002-01-01', stats: null }),
    ).toBe(true)
    const names = [
      '吉田 輝星',
      '前川 右京',
      '田和 廉',
      '伊藤 優輔',
      '丸山 和郁',
    ]
    for (const name of names)
      expect(
        protectedForRealisticCpu(
          officialDataset.players.find((p) => p.name === name)!,
        ),
        name,
      ).toBe(true)
  })
  it('keeps every club playable and varied without selecting protected players or relaxing eligibility', () => {
    const players = officialDataset.players
    for (const team of teamIds) {
      const pairs = new Set<string>()
      for (let seed = 0; seed < 100; seed++) {
        const ids = realisticCandidates(team, players, seed)
        expect(new Set(ids).size).toBe(2)
        pairs.add([...ids].sort().join(','))
        for (const id of ids) {
          const player = players.find((p) => p.id === id)!
          expect(player.team).toBe(team)
          expect(eligibilityOf(player).allowed).toBe(true)
          expect(eligibilityOf(player).band).toBe('ordinary')
          expect(protectedForRealisticCpu(player)).toBe(false)
        }
      }
      // The strictest clubs have four plausible players: six possible pairs.
      expect(pairs.size, team).toBeGreaterThanOrEqual(6)
      expect(realisticCandidates(team, players, 901)).toEqual(
        realisticCandidates(team, [...players].reverse(), 901),
      )
    }
    const star = {
      ...players[0],
      team: 'd' as const,
      position: '投手' as const,
      stats: { games: 45 },
    }
    expect(() => realisticCandidates('d', [star], 1)).toThrow('不足')
  })
})
