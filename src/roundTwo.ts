import type { Player, TeamId } from './data'

export type Participation = 'buy' | 'supply' | 'out'
export type BidCondition = 'unconditional' | 'balanced'
export interface RoundTwoBid {
  team: TeamId
  condition: BidCondition
  preferences: string[]
}
export interface RoundTwoState {
  intents: Record<TeamId, Participation>
  bids: RoundTwoBid[]
  userCondition: BidCondition
  userPreferences: string[]
}
export interface Assignment {
  by: TeamId
  from: TeamId
  playerId: string
}

// Deterministic adjudication: unconditional bids precede balanced bids, then
// reverse first-round order. Find the first globally feasible preference result.
// Global feasibility matters: balanced exchanges may require a multi-club cycle.
export function resolveBids(
  bids: RoundTwoBid[],
  supply: Player[],
  reverseOrder: TeamId[],
): Assignment[] {
  const ordered = [...bids].sort(
    (a, b) =>
      Number(a.condition === 'balanced') - Number(b.condition === 'balanced') ||
      reverseOrder.indexOf(a.team) - reverseOrder.indexOf(b.team),
  )
  const index = new Map(reverseOrder.map((t, i) => [t, i]))
  const bit = (t: TeamId) => 1 << index.get(t)!
  const balanced = ordered
    .filter((b) => b.condition === 'balanced')
    .reduce((m, b) => m | bit(b.team), 0)
  const options = ordered.map((b) => {
    const owners = new Set<TeamId>()
    return b.preferences.flatMap((id) => {
      const p = supply.find((p) => p.id === id && p.team !== b.team)
      if (!p || owners.has(p.team)) return []
      owners.add(p.team)
      return [p]
    })
  })
  const seen = new Set<string>()
  function search(
    i: number,
    released: number,
    received: number,
  ): Assignment[] | null {
    if (i === ordered.length)
      return (released & balanced) === received ? [] : null
    const key = `${i}:${released}:${received}`
    if (seen.has(key)) return null
    const futureOwners = options
      .slice(i)
      .flat()
      .reduce((m, p) => m | bit(p.team), 0)
    if ((received & ~released & ~futureOwners) !== 0) return null
    const bidder = ordered[i]
    for (const p of options[i]) {
      if (released & bit(p.team)) continue
      const nextReleased = released | bit(p.team)
      const nextReceived =
        received | (bidder.condition === 'balanced' ? bit(bidder.team) : 0)
      const result = search(i + 1, nextReleased, nextReceived)
      if (result)
        return [{ by: bidder.team, from: p.team, playerId: p.id }, ...result]
    }
    // A balanced team already releasing a player must acquire one as well.
    if (!(bidder.condition === 'balanced' && released & bit(bidder.team))) {
      // Prevent a later bid from releasing a balanced team which passed.
      const own = bit(bidder.team)
      const blocked = bidder.condition === 'balanced' ? own : 0
      const saved = options.slice(i + 1).map((v) => [...v])
      for (let j = i + 1; j < options.length; j++)
        if (blocked)
          options[j] = options[j].filter((p) => p.team !== bidder.team)
      const result = search(i + 1, released, received)
      for (let j = i + 1; j < options.length; j++) options[j] = saved[j - i - 1]
      if (result) return result
    }
    seen.add(key)
    return null
  }
  return search(0, 0, 0) ?? []
}
