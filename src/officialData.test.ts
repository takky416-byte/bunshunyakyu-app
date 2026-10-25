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
  it('excludes the October 25 departures and the two corrected newspaper name variants', () => {
    for (const [team, names] of [
      ['d', ['川越 誠司', '宇佐見 真吾']],
      [
        'g',
        [
          '湯浅 大',
          '北浦 竜次',
          '鈴木 大和',
          '知念 大成',
          '三塚 琉生',
          '浅野 翔吾',
          '宇都宮 葵星',
        ],
      ],
      ['m', ['愛斗']],
      ['e', ['日當 直喜']],
      ['db', ['濱 将乃介']],
    ] as const) {
      for (const name of names) {
        const player = officialDataset.players.find(
          (p) => p.team === team && p.name === name,
        )!
        expect(player, name).toBeDefined()
        expect(eligibilityOf(player).allowed, name).toBe(false)
        expect(player.draftFacts!.exclusions).toContainEqual({
          reason: '戦力外・退団・引退の報道あり',
          source:
            'https://www.nikkansports.com/baseball/news/202609280000276.html',
        })
      }
    }
  })
  it('corrects domestic treatment by player ID and still excludes released and development players', () => {
    for (const name of ['ワォーターズ', '陽 柏翔', '林 冠臣']) {
      const player = officialDataset.players.find((p) => p.name === name)!
      expect(player.draftFacts?.foreignPlayerTreatment).toBe('domestic')
      expect(player.draftFacts?.treatmentSource).toMatch(
        /^https:\/\/draft.npb.jp\//,
      )
      expect(eligibilityOf(player).allowed).toBe(true)
    }
    for (const name of [
      'ケムナ 誠',
      '山口 アタル',
      '翔聖',
      'シンクレア',
      '松本 竜也',
      '長谷部 銀次',
    ]) {
      expect(
        eligibilityOf(officialDataset.players.find((p) => p.name === name)!)
          .allowed,
        name,
      ).toBe(false)
    }
    const reported = officialDataset.players.filter((p) =>
      p.draftFacts!.exclusions.some((e) => e.reason.includes('戦力外')),
    )
    expect(reported.length).toBeGreaterThanOrEqual(106)
    for (const player of reported)
      expect(eligibilityOf(player).allowed).toBe(false)
  })
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
