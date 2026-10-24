import { teamById, type Player, type TeamId } from './data'
import { eligibilityOf } from './eligibility'

// Simulator safeguards, not NPB eligibility rules or a prediction of club lists.
export function isCorePlayer(player: Player): boolean {
  const s = player.stats
  if (!s) return false
  if (player.position !== '投手')
    return (s.plateAppearances ?? 0) >= 250 || (s.homeRuns ?? 0) >= 15
  const innings = Number.parseFloat((s.innings ?? '0').replace(/\s/g, ''))
  return (
    innings >= 80 || (s.wins ?? 0) >= 7 || (s.saves ?? 0) >= 8 || s.games >= 40
  )
}

export function candidateWeight(player: Player, team: TeamId): number {
  let weight = 1
  const s = player.stats
  if (s) {
    const opportunity =
      player.position === '投手' ? s.games : (s.plateAppearances ?? 0)
    if (opportunity > 0) weight *= 2
    if (
      player.position === '投手'
        ? opportunity >= 5 && opportunity <= 30
        : opportunity >= 30 && opportunity <= 180
    )
      weight *= 1.6
  }
  const year = Number(player.birthDate?.slice(0, 4))
  if (year) {
    const age = 2026 - year
    if (age <= 22) weight *= 0.35
    else if (age <= 24) weight *= 0.7
    else if (age <= 30) weight *= 1.5
    else if (age >= 35) weight *= 0.4
  }
  if (teamById[team].need === player.position) weight *= 0.6
  const salary = player.draftFacts?.salaryManYen
  if (salary != null && salary < 800) weight *= 0.65
  return weight
}

export function protectedForCpu(player: Player): boolean {
  const year = Number(player.birthDate?.slice(0, 4))
  return isCorePlayer(player) || Boolean(year && 2026 - year <= 21)
}

function randomValue(seed: number, team: TeamId, id: string): number {
  let x = 2166136261
  for (const c of `${seed}:cpu-nominations-v1:${team}:${id}`)
    x = Math.imul(x ^ c.charCodeAt(0), 16777619)
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d)
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b)
  x ^= x >>> 16
  return ((x >>> 0) + 0.5) / 4294967296
}

export function variedCandidates(
  team: TeamId,
  players: Player[],
  seed: number,
): string[] {
  const pool = players.filter(
    (p) =>
      p.team === team &&
      eligibilityOf(p).allowed &&
      eligibilityOf(p).band !== 'exception' &&
      !protectedForCpu(p),
  )
  if (pool.length < 2)
    throw new Error(
      `${teamById[team].short}のCPU候補が不足しています。主力級を除いた対象選手を2名以上用意してください。`,
    )
  // Exponential weighted sampling without replacement. Sorting by stable ID
  // resolves ties and keeps the result independent of input array order.
  return pool
    .map((p) => ({
      id: p.id,
      key: -Math.log(randomValue(seed, team, p.id)) / candidateWeight(p, team),
    }))
    .sort((a, b) => a.key - b.key || a.id.localeCompare(b.id))
    .slice(0, 2)
    .map((p) => p.id)
}
