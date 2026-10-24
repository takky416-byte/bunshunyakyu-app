import { npcPick, type Game } from './engine'
import type { Player } from './data'

export interface Announcement {
  kind: 'nominations' | 'order' | 'pick' | 'round2'
  game: Game
  /** Second-round assignments are atomic; this index only controls the reveal. */
  pickIndex?: number
}

export function roundTwoAnnouncements(game: Game): Announcement[] {
  const picks = game.picks.filter((p) => p.round === 2)
  return picks.length
    ? picks.map((_, pickIndex) => ({ kind: 'round2', game, pickIndex }))
    : [{ kind: 'round2', game }]
}

// Each announcement carries a legal checkpoint. The UI commits it only when
// revealed; skipping commits the final checkpoint without changing any picks.
export function npcAnnouncements(
  game: Game,
  players: Player[],
  untilUser: boolean,
): Announcement[] {
  const sequence: Announcement[] = []
  let next = game
  while (next.stage === 'draft' && next.current !== next.userTeam) {
    if (sequence.length >= 12) throw new Error('指名の進行を確認してください。')
    next = npcPick(next, players)
    sequence.push({ kind: 'pick', game: next })
    if (!untilUser) break
  }
  return sequence
}
