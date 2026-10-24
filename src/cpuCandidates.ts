import { teamById, type Player, type TeamId } from './data'
import { eligibilityOf } from './eligibility'
import draftHistory from './cpuDraft2026.json' with { type: 'json' }

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

/** Conservative CPU roster judgement, distinct from legal nomination eligibility.
 * Keep the v1 functions above frozen so submitted games replay unchanged.
 */
export function protectedForRealisticCpu(player: Player): boolean {
  const drafted = (
    draftHistory.players as Record<
      string,
      { year: number; round: number; development: boolean }
    >
  )[player.id]
  if (
    drafted &&
    (drafted.year === 2025 ||
      (drafted.year >= 2023 && !drafted.development && drafted.round <= 3))
  )
    return true
  const year = Number(player.birthDate?.slice(0, 4))
  if (year && 2026 - year <= 24) return true
  const s = player.stats
  if (!s) return false
  if (player.position !== '投手')
    return (
      s.games >= 60 ||
      (s.plateAppearances ?? 0) >= 100 ||
      (s.homeRuns ?? 0) >= 5 ||
      (player.position === '捕手' && s.games >= 25) ||
      ((s.plateAppearances ?? 0) >= 40 && (s.ops ?? 0) >= 0.75)
    )
  // NPB's .1/.2 are thirds of an inning; '+' means no recorded out.
  const match = /^(\d+)(?:\.([12]))?$/.exec(s.innings ?? '')
  const outs = match ? Number(match[1]) * 3 + Number(match[2] ?? 0) : 0
  return (
    s.games >= 20 ||
    outs >= 90 ||
    (s.wins ?? 0) >= 3 ||
    (s.saves ?? 0) >= 3 ||
    (outs >= 30 && s.era != null && s.era <= 3)
  )
}

export function realisticCandidates(
  team: TeamId,
  players: Player[],
  seed: number,
): string[] {
  const pool = players.filter(
    (p) =>
      p.team === team &&
      eligibilityOf(p).allowed &&
      eligibilityOf(p).band !== 'exception' &&
      !protectedForRealisticCpu(p),
  )
  if (pool.length < 2)
    throw new Error(
      `${teamById[team].short}のCPU候補が不足しています。一軍の戦力・若手を保護した候補が2名以上必要です。`,
    )
  return pool
    .map((p) => {
      const s = p.stats
      const opportunity =
        p.position === '投手' ? (s?.games ?? 0) : (s?.plateAppearances ?? 0)
      // A few appearances suggest a player blocked by depth. Never relax
      // protections to fill a list, and retain variety among plausible nominees.
      const weight = candidateWeight(p, team) * (opportunity === 0 ? 0.7 : 1)
      return {
        id: p.id,
        key:
          -Math.log(randomValue(seed, team, `realistic-v2:${p.id}`)) / weight,
      }
    })
    .sort((a, b) => a.key - b.key || a.id.localeCompare(b.id))
    .slice(0, 2)
    .map((p) => p.id)
}
