import { teamById, teamIds, type Player, type TeamId } from './data'

import { eligibilityOf, nominationErrors } from './eligibility'
import { waiverOrder2026 } from './rules2026'
import { variedCandidates } from './cpuCandidates'
import {
  resolveBids,
  type Participation,
  type BidCondition,
  type RoundTwoState,
} from './roundTwo'

export const ENGINE_VERSION = 2
export type Stage =
  'nominate' | 'vote' | 'draft' | 'round2' | 'round2confirm' | 'results'
export interface Pick {
  round: 1 | 2
  by: TeamId
  from: TeamId
  playerId: string
}
export interface Game {
  version: 2
  cpuNominationModel?: 'varied-v1'
  roundTwo?: RoundTwoState
  seed: number
  userTeam: TeamId
  stage: Stage
  round: 1 | 2
  offers: Partial<Record<TeamId, string[]>>
  ballots: Partial<Record<TeamId, string>>
  order: TeamId[]
  current: TeamId | null
  participants: TeamId[]
  picks: Pick[]
}
export function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}
// Stats inform a deliberately simple game score. This is not a real valuation.
function gameQuality(player: Player): number {
  const s = player.stats
  if (!s) return 38 + (hash(`potential:${player.id}`) % 8)
  if (player.position === '投手')
    return (
      45 + Math.min(24, s.games * 0.6) + Math.max(-10, 12 - (s.era ?? 6) * 2)
    )
  return (
    40 +
    Math.min(26, (s.plateAppearances ?? 0) * 0.065) +
    Math.min(20, (s.ops ?? 0) * 22)
  )
}
export function fit(player: Player, team: TeamId, seed: number): number {
  return Math.max(
    1,
    Math.min(
      98,
      Math.round(
        gameQuality(player) +
          (hash(`${seed}:${team}:${player.id}`) % 9) +
          (teamById[team].need === player.position ? 15 : 0),
      ),
    ),
  )
}
export function newGame(userTeam: TeamId, seed: number): Game {
  if (!teamIds.includes(userTeam) || !Number.isSafeInteger(seed) || seed < 0)
    throw new Error('ゲーム設定が不正です。')
  return {
    version: ENGINE_VERSION,
    cpuNominationModel: 'varied-v1',
    seed,
    userTeam,
    stage: 'nominate',
    round: 1,
    offers: {},
    ballots: {},
    order: [],
    current: null,
    participants: [...teamIds],
    picks: [],
  }
}
export function submitNominations(
  game: Game,
  nominated: string[],
  players: Player[],
): Game {
  if (game.stage !== 'nominate')
    throw new Error('候補提出はすでに完了しています。')
  if (
    new Set(nominated).size !== nominated.length ||
    nominated.length < 2 ||
    nominated.some(
      (id) =>
        !players.some(
          (p) =>
            p.id === id && p.team === game.userTeam && eligibilityOf(p).allowed,
        ),
    )
  )
    throw new Error('自球団の候補対象選手を2名以上選択してください。')
  const errors = nominationErrors(
    nominated.map((id) => players.find((p) => p.id === id)!),
  )
  if (errors.length) throw new Error(errors.join(' '))
  const offers: Game['offers'] = { [game.userTeam]: [...nominated] }
  for (const team of teamIds.filter((t) => t !== game.userTeam)) {
    if (game.cpuNominationModel === 'varied-v1') {
      offers[team] = variedCandidates(team, players, game.seed)
      continue
    }
    const pool = players.filter(
      (p) =>
        p.team === team &&
        eligibilityOf(p).allowed &&
        eligibilityOf(p).band !== 'exception',
    )
    if (pool.length < 2)
      throw new Error(`${teamById[team].short}の候補選手が不足しています。`)
    // NPCs retain players fitting their own needs. Variation is seeded and replayable.
    offers[team] = [...pool]
      .sort(
        (a, b) =>
          fit(a, team, game.seed) - fit(b, team, game.seed) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 2)
      .map((p) => p.id)
  }
  return { ...game, stage: 'vote', offers }
}
export function offeredPlayers(game: Game, players: Player[]): Player[] {
  const ids = new Set(Object.values(game.offers).flat())
  return players.filter((p) => ids.has(p.id))
}
export function beginDraft(
  game: Game,
  votedId: string,
  players: Player[],
): Game {
  if (game.stage !== 'vote') throw new Error('希望投票はすでに終了しています。')
  const offered = offeredPlayers(game, players)
  if (!offered.some((p) => p.id === votedId && p.team !== game.userTeam))
    throw new Error('他球団の候補選手を選択してください。')
  const ballots: Game['ballots'] = { [game.userTeam]: votedId }
  for (const team of teamIds.filter((t) => t !== game.userTeam)) {
    const choices = offered
      .filter((p) => p.team !== team)
      .sort(
        (a, b) =>
          fit(b, team, game.seed) - fit(a, team, game.seed) ||
          a.id.localeCompare(b.id),
      )
    ballots[team] = choices[0].id
  }
  const tally = (team: TeamId) =>
    Object.values(ballots).filter(
      (id) => offered.find((p) => p.id === id)?.team === team,
    ).length
  const order = [...teamIds].sort(
    (a, b) =>
      tally(b) - tally(a) ||
      waiverOrder2026.indexOf(a) - waiverOrder2026.indexOf(b),
  )
  return { ...game, stage: 'draft', ballots, order, current: order[0] }
}
export function voteCount(game: Game, team: TeamId, players: Player[]): number {
  return Object.values(game.ballots).filter(
    (id) => players.find((p) => p.id === id)?.team === team,
  ).length
}
export function choicesFor(game: Game, players: Player[]): Player[] {
  if (game.stage !== 'draft' || !game.current) return []
  const pickedThisRound = game.picks.filter((p) => p.round === game.round)
  const acquired = new Set(pickedThisRound.map((p) => p.by))
  const released = new Set(pickedThisRound.map((p) => p.from))
  const used = new Set(game.picks.map((p) => p.playerId))
  const remaining = game.participants.filter((t) => !acquired.has(t))
  const available = offeredPlayers(game, players).filter(
    (p) =>
      p.team !== game.current &&
      game.participants.includes(p.team) &&
      !released.has(p.team) &&
      !used.has(p.id) &&
      // Prevent closing a chain early when it would strand a single team.
      !(remaining.length === 2 && acquired.has(p.team)),
  )
  const preferred = available.find((p) => p.id === game.ballots[game.current!])
  return game.round === 1 && preferred ? [preferred] : available
}
export function makePick(
  game: Game,
  playerId: string,
  players: Player[],
): Game {
  const selected = choicesFor(game, players).find((p) => p.id === playerId)
  if (!selected || !game.current)
    throw new Error('この選手は現在指名できません。')
  const picks: Pick[] = [
    ...game.picks,
    { round: game.round, by: game.current, from: selected.team, playerId },
  ]
  const acquired = new Set(
    picks.filter((p) => p.round === game.round).map((p) => p.by),
  )
  if (acquired.size === game.participants.length)
    return {
      ...game,
      picks,
      current: null,
      stage: game.round === 1 ? 'round2' : 'results',
    }
  const next = !acquired.has(selected.team)
    ? selected.team
    : game.order.find((t) => game.participants.includes(t) && !acquired.has(t))
  if (!next) throw new Error('次の指名球団を決定できません。')
  return { ...game, picks, current: next }
}
export function npcPick(game: Game, players: Player[]): Game {
  if (game.current === game.userTeam) throw new Error('あなたの指名番です。')
  const current = game.current
  if (!current) throw new Error('指名は終了しています。')
  const choices = choicesFor(game, players).sort(
    (a, b) =>
      fit(b, current, game.seed) - fit(a, current, game.seed) ||
      a.id.localeCompare(b.id),
  )
  if (!choices.length) throw new Error('指名可能な選手がいません。')
  return makePick(game, choices[0].id, players)
}
export function advanceToUser(game: Game, players: Player[]): Game {
  let next = game
  let steps = 0
  while (next.stage === 'draft' && next.current !== next.userTeam) {
    if (++steps > 12) throw new Error('指名の進行に問題があります。')
    next = npcPick(next, players)
  }
  return next
}
export function startRoundTwo(
  game: Game,
  participate: boolean | Participation,
  _players: Player[],
): Game {
  if (game.stage !== 'round2' && game.stage !== 'round2confirm')
    throw new Error('第2巡の参加確認中ではありません。')
  const user =
    typeof participate === 'boolean'
      ? participate
        ? 'buy'
        : 'out'
      : participate
  if (!['buy', 'supply', 'out'].includes(user))
    throw new Error('参加意向が不正です。')
  const intents = Object.fromEntries(
    teamIds.map((t) => [
      t,
      t === game.userTeam
        ? user
        : hash(`${game.seed}:round2:${t}`) % 100 < 55
          ? 'buy'
          : hash(`${game.seed}:supply:${t}`) % 2
            ? 'supply'
            : 'out',
    ]),
  ) as Record<TeamId, Participation>
  const roundTwo: RoundTwoState = {
    intents,
    bids: [],
    userCondition: 'unconditional',
    userPreferences: [],
  }
  return {
    ...game,
    stage: 'round2confirm',
    round: 2,
    current: null,
    participants: teamIds.filter((t) => intents[t] !== 'out'),
    roundTwo,
  }
}
export function roundTwoChoices(game: Game, players: Player[]): Player[] {
  const used = new Set(game.picks.map((p) => p.playerId))
  return offeredPlayers(game, players).filter(
    (p) => !used.has(p.id) && game.roundTwo?.intents[p.team] !== 'out',
  )
}
export function confirmRoundTwo(
  game: Game,
  preferences: string[],
  condition: BidCondition,
  players: Player[],
): Game {
  if (game.stage !== 'round2confirm' || !game.roundTwo)
    throw new Error('第2巡の意向確認が必要です。')
  const supply = roundTwoChoices(game, players)
  const choices = supply.filter((p) => p.team !== game.userTeam)
  const buying = game.roundTwo.intents[game.userTeam] === 'buy'
  if (
    !['unconditional', 'balanced'].includes(condition) ||
    new Set(preferences).size !== preferences.length ||
    preferences.some((id) => !choices.some((p) => p.id === id)) ||
    (buying && !preferences.length && choices.length)
  )
    throw new Error('希望順位付きの獲得候補を1名以上選んでください。')
  if (!buying && preferences.length)
    throw new Error('獲得意思なしの場合は入札できません。')
  const reverseOrder = [...game.picks]
    .filter((p) => p.round === 1)
    .reverse()
    .map((p) => p.by)
  const bids = reverseOrder
    .filter((t) => game.roundTwo!.intents[t] === 'buy')
    .map((t) => ({
      team: t,
      condition:
        t === game.userTeam
          ? condition
          : hash(`${game.seed}:condition:${t}`) % 2
            ? ('balanced' as const)
            : ('unconditional' as const),
      preferences:
        t === game.userTeam
          ? [...preferences]
          : supply
              .filter((p) => p.team !== t)
              .sort(
                (a, b) =>
                  fit(b, t, game.seed) - fit(a, t, game.seed) ||
                  a.id.localeCompare(b.id),
              )
              .map((p) => p.id),
    }))
  const assignments = resolveBids(bids, supply, reverseOrder)
  return {
    ...game,
    stage: 'results',
    picks: [
      ...game.picks,
      ...assignments.map((p) => ({ ...p, round: 2 as const })),
    ],
    roundTwo: {
      ...game.roundTwo,
      bids,
      userPreferences: [...preferences],
      userCondition: condition,
    },
  }
}

// Restore by replaying legal transitions rather than trusting serialized state.
export function restoreGame(raw: unknown, players: Player[]): Game {
  if (!raw || typeof raw !== 'object') throw new Error('保存データが不正です。')
  const g = raw as Game
  if (
    g.version !== 2 ||
    (g.cpuNominationModel !== undefined &&
      g.cpuNominationModel !== 'varied-v1') ||
    !teamIds.includes(g.userTeam) ||
    !Array.isArray(g.picks) ||
    g.picks.length > 24 ||
    !g.offers ||
    !g.ballots
  )
    throw new Error('保存データの形式に対応していません。')
  let restored = newGame(g.userTeam, g.seed)
  if (g.cpuNominationModel === undefined) delete restored.cpuNominationModel
  if (g.stage === 'nominate') return restored
  restored = submitNominations(restored, g.offers[g.userTeam] ?? [], players)
  if (g.stage === 'vote') return restored
  restored = beginDraft(restored, g.ballots[g.userTeam] ?? '', players)
  for (const pick of g.picks.filter((p) => p.round === 1)) {
    if (pick.by !== restored.current)
      throw new Error('保存された指名順が不正です。')
    restored = makePick(restored, pick.playerId, players)
  }
  if (g.round === 2) {
    if (!g.roundTwo) throw new Error('第2巡の保存情報が不足しています。')
    restored = startRoundTwo(restored, g.roundTwo.intents[g.userTeam], players)
    if (g.stage === 'results')
      restored = confirmRoundTwo(
        restored,
        g.roundTwo.userPreferences,
        g.roundTwo.userCondition,
        players,
      )
  }
  if (JSON.stringify(restored.picks) !== JSON.stringify(g.picks))
    throw new Error('保存された指名結果が不正です。')
  if (restored.stage !== g.stage)
    throw new Error('保存された進行状況が不正です。')
  return restored
}
