import { describe, expect, it } from 'vitest'
import { referenceDataset, type Player } from './data'
import { eligibilityOf, nominationErrors } from './eligibility'
import { resolveBids } from './roundTwo'
import { waiverOrder2026 } from './rules2026'
import { officialDataset } from './officialData'
import { beginDraft, choicesFor, newGame, submitNominations } from './engine'

function p(id: string, salary: number | null = 1000): Player {
  return {
    id,
    team: id[0] as Player['team'],
    name: id,
    position: '投手',
    eligible: true,
    draftFacts: {
      salaryYear: 2026,
      salaryManYen: salary,
      salarySource: 'https://example.com/source',
      checkedAt: '2026-10-24',
      exclusions: [],
      holds: [],
      unresolved: ['複数年未確認'],
    },
  }
}
describe('2026 salary-proxy eligibility', () => {
  it('uses exact 5000 / 10000 boundaries and never invents missing amounts', () => {
    expect(eligibilityOf(p('t1', 4999)).band).toBe('ordinary')
    expect(eligibilityOf(p('t1', 5000)).band).toBe('exception')
    expect(eligibilityOf(p('t1', 9999)).allowed).toBe(true)
    expect(eligibilityOf(p('t1', 10000)).allowed).toBe(false)
    expect(eligibilityOf(p('t1', null)).band).toBe('unknown')
  })
  it('requires two known ordinary salaries when using the one-player exception', () => {
    expect(nominationErrors([p('t1', 5000), p('t2')])).not.toHaveLength(0)
    expect(nominationErrors([p('t1', 5000), p('t2'), p('t3')])).toEqual([])
    expect(
      nominationErrors([p('t1', 5000), p('t2', 6000), p('t3'), p('t4')]),
    ).not.toHaveLength(0)
    expect(
      nominationErrors([p('t1', 5000), p('t2'), p('t3', null)]),
    ).not.toHaveLength(0)
  })
  it('blocks sourced exclusions and verification holds without classifying them as confirmed foreigners', () => {
    const player = p('t1')
    player.draftFacts!.holds = ['外国人区分の照合待ち']
    expect(eligibilityOf(player)).toMatchObject({
      allowed: false,
      label: '要確認・保留',
    })
    player.draftFacts!.holds = []
    player.draftFacts!.exclusions = [
      { reason: 'FA資格', source: 'https://npb.jp/' },
    ]
    expect(eligibilityOf(player).allowed).toBe(false)
  })
  it('attaches source-backed 2026 salary facts without reinterpreting them as 2027 facts', () => {
    const players = officialDataset.players
    expect(
      players.filter((p) => p.draftFacts?.salaryManYen != null).length,
    ).toBeGreaterThan(950)
    for (const player of players) {
      expect(player.draftFacts!.salaryYear).toBe(2026)
      if (player.draftFacts!.salaryManYen != null)
        expect(player.draftFacts!.salarySource).toMatch(/^https:/)
      if (player.draftFacts!.salaryManYen == null)
        expect(eligibilityOf(player).allowed).toBe(false)
      if (player.draftFacts!.exclusions.length)
        expect(eligibilityOf(player).allowed).toBe(false)
    }
  })
  it('binds the first pick to the preliminary preference and uses waiver order for tied votes', () => {
    const ps = referenceDataset.players
    let game = submitNominations(newGame('t', 9), ['t-1', 't-2'], ps)
    game = beginDraft(game, game.offers.g![0], ps)
    const choices = choicesFor(game, ps)
    expect(choices).toHaveLength(1)
    expect(choices[0].id).toBe(game.ballots[game.current!])
    const counts = (t: string) =>
      Object.values(game.ballots).filter(
        (id) => ps.find((p) => p.id === id)?.team === t,
      ).length
    for (let i = 1; i < game.order.length; i++)
      if (counts(game.order[i - 1]) === counts(game.order[i]))
        expect(waiverOrder2026.indexOf(game.order[i - 1])).toBeLessThan(
          waiverOrder2026.indexOf(game.order[i]),
        )
  })
})

describe('second-round conditional bids', () => {
  const order: Player['team'][] = ['t', 'g', 'c', 's']
  const supply = [p('t1'), p('g1'), p('c1'), p('s1')]
  it('permits a one-way acquisition from a supply-only club', () => {
    expect(
      resolveBids(
        [{ team: 't', condition: 'unconditional', preferences: ['g1'] }],
        supply,
        order,
      ),
    ).toEqual([{ by: 't', from: 'g', playerId: 'g1' }])
  })
  it('rejects an unbalanced acquisition for a balanced bidder', () => {
    expect(
      resolveBids(
        [{ team: 't', condition: 'balanced', preferences: ['g1'] }],
        supply,
        order,
      ),
    ).toEqual([])
  })
  it('resolves a balanced three-club cycle', () => {
    const trades = resolveBids(
      [
        { team: 't', condition: 'balanced', preferences: ['g1'] },
        { team: 'g', condition: 'balanced', preferences: ['c1'] },
        { team: 'c', condition: 'balanced', preferences: ['t1'] },
      ],
      supply,
      order,
    )
    expect(trades).toHaveLength(3)
  })
  it('prioritizes unconditional bids over earlier balanced bids', () => {
    const trades = resolveBids(
      [
        { team: 't', condition: 'balanced', preferences: ['c1'] },
        { team: 'g', condition: 'unconditional', preferences: ['c1'] },
      ],
      supply,
      order,
    )
    expect(trades).toEqual([{ by: 'g', from: 'c', playerId: 'c1' }])
  })
  it('uses reverse first-round order, preference order, and never double-releases', () => {
    const trades = resolveBids(
      [
        { team: 'g', condition: 'unconditional', preferences: ['c1', 's1'] },
        { team: 't', condition: 'unconditional', preferences: ['c1'] },
      ],
      supply,
      order,
    )
    expect(trades).toEqual([
      { by: 't', from: 'c', playerId: 'c1' },
      { by: 'g', from: 's', playerId: 's1' },
    ])
  })
  it('does not pick a player outside an offered preference list or from itself', () => {
    expect(
      resolveBids(
        [
          {
            team: 't',
            condition: 'unconditional',
            preferences: ['missing', 't1'],
          },
        ],
        supply,
        order,
      ),
    ).toEqual([])
  })
})
