import { expect, it } from 'vitest'
import { npcAnnouncements } from './announcements'
import { referenceDataset, teamIds } from './data'
import {
  advanceToUser,
  beginDraft,
  newGame,
  restoreGame,
  submitNominations,
} from './engine'

it('announces NPC picks in legal individual checkpoints and preserves the skip result', () => {
  const players = referenceDataset.players
  for (const user of teamIds) {
    let game = submitNominations(
      newGame(user, 27),
      players
        .filter((p) => p.team === user)
        .slice(0, 2)
        .map((p) => p.id),
      players,
    )
    const target = players.find(
      (p) => p.team !== user && game.offers[p.team]?.includes(p.id),
    )!
    game = beginDraft(game, target.id, players)
    const before = structuredClone(game)
    const sequence = npcAnnouncements(game, players, true)
    expect(game).toEqual(before)
    sequence.forEach((item, i) => {
      expect(item.game.picks).toHaveLength(game.picks.length + i + 1)
      expect(restoreGame(item.game, players)).toEqual(item.game)
      expect(item.game.picks.at(-1)!.by).not.toBe(user)
    })
    expect(sequence.at(-1)?.game ?? game).toEqual(advanceToUser(game, players))
    expect(npcAnnouncements(game, players, false)).toHaveLength(
      sequence.length ? 1 : 0,
    )
  }
})
