import { describe, expect, it } from 'vitest'
import { eligibilityOf } from './eligibility'
import { officialDataset } from './officialData'
import { teamIds } from './data'
import {
  beginDraft,
  choicesFor,
  makePick,
  newGame,
  npcPick,
  restoreGame,
  submitNominations,
} from './engine'

describe('official 2026 snapshot', () => {
  it('records all 36 sources, unique IDs, registration and factual statistics', () => {
    const data = officialDataset
    expect(data.season).toBe(2026)
    expect(data.kind).toBe('official-roster')
    expect(data.sources).toHaveLength(36)
    expect(new Set(data.players.map((p) => p.id)).size).toBe(
      data.players.length,
    )
    for (const source of data.sources!) {
      expect(new URL(source.url).hostname).toBe('npb.jp')
      expect(source.sha256).toMatch(/^[a-f0-9]{64}$/)
    }
    for (const team of teamIds) {
      const roster = data.players.filter((p) => p.team === team)
      expect(roster.length).toBeGreaterThan(40)
      expect(roster.filter((p) => p.eligible).length).toBeLessThanOrEqual(70)
      expect(roster.filter((p) => p.stats).length).toBeGreaterThan(20)
    }
    for (const p of data.players) {
      if (p.registration === '育成') expect(p.eligible).toBe(false)
      else expect(p.eligibility).toBe('unverified')
      expect(p.sourceUrl).toMatch(/^https:\/\/npb.jp\/bis\/teams\/rst_/)
      if (p.stats) expect(p.stats.games).toBeGreaterThanOrEqual(0)
    }
  })
  it('plays and restores a full first round with the real roster for every club', () => {
    const players = officialDataset.players
    for (const team of teamIds) {
      let game = submitNominations(
        newGame(team, 2026),
        players
          .filter(
            (p) =>
              p.team === team &&
              eligibilityOf(p).allowed &&
              eligibilityOf(p).band === 'ordinary',
          )
          .slice(0, 2)
          .map((p) => p.id),
        players,
      )
      const votedId = Object.entries(game.offers).find(
        ([t]) => t !== team,
      )![1]![0]
      game = beginDraft(game, votedId, players)
      for (let i = 0; i < 12; i++)
        game =
          game.current === team
            ? makePick(game, choicesFor(game, players)[0].id, players)
            : npcPick(game, players)
      expect(game.stage).toBe('round2')
      expect(game.picks).toHaveLength(12)
      expect(restoreGame(game, players)).toEqual(game)
    }
  })
})
