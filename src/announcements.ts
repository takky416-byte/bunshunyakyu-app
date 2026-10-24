import { npcPick, type Game } from './engine'
import type { Player } from './data'

export interface Announcement {
  kind: 'order' | 'pick' | 'round2'
  game: Game
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
