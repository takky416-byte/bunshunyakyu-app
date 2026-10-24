import type { Dataset, PlayerStats } from './data'
import type { EligibilityFacts } from './eligibility'
import { officialDataset } from './officialData'

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 30 &&
  value.every((v) => typeof v === 'string' && v.length <= 600)
const https = (value: unknown) =>
  typeof value === 'string' &&
  value.length <= 2048 &&
  value.startsWith('https://')
function facts(value: unknown): EligibilityFacts {
  if (
    !object(value) ||
    value.salaryYear !== 2026 ||
    !(
      value.salaryManYen === null ||
      (typeof value.salaryManYen === 'number' &&
        Number.isFinite(value.salaryManYen) &&
        value.salaryManYen >= 0)
    ) ||
    !(value.salarySource === null || https(value.salarySource)) ||
    typeof value.checkedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.checkedAt) ||
    !strings(value.holds) ||
    !strings(value.unresolved) ||
    !Array.isArray(value.exclusions) ||
    value.exclusions.length > 30 ||
    !value.exclusions.every(
      (e) =>
        object(e) &&
        typeof e.reason === 'string' &&
        e.reason.length <= 600 &&
        https(e.source),
    )
  )
    throw new Error('保存された選手条件の形式が不正です。')
  return value as unknown as EligibilityFacts
}
function stats(value: unknown): PlayerStats | null | undefined {
  if (value == null) return value as null | undefined
  const numeric = [
    'games',
    'era',
    'wins',
    'losses',
    'saves',
    'plateAppearances',
    'average',
    'homeRuns',
    'rbi',
    'ops',
  ]
  if (
    !object(value) ||
    typeof value.games !== 'number' ||
    !Number.isFinite(value.games) ||
    value.games < 0 ||
    Object.entries(value).some(([key, v]) =>
      key === 'innings'
        ? typeof v !== 'string' || v.length > 30
        : !numeric.includes(key) ||
          !(v === null || (typeof v === 'number' && Number.isFinite(v))),
    )
  )
    throw new Error('保存された成績の形式が不正です。')
  return value as unknown as PlayerStats
}

/** Keep a submitted draft's original conditions when official data is refreshed. */
export function recordedOfficialDataset(raw: unknown): Dataset {
  if (
    !object(raw) ||
    raw.version !== 1 ||
    raw.season !== 2026 ||
    raw.kind !== 'official-roster' ||
    !Array.isArray(raw.players) ||
    raw.players.length !== officialDataset.players.length
  )
    throw new Error('保存された名簿の形式が不正です。')
  const previous = new Map<string, Record<string, unknown>>()
  for (const p of raw.players) {
    if (!object(p) || typeof p.id !== 'string' || previous.has(p.id))
      throw new Error('保存された選手IDが不正です。')
    previous.set(p.id, p)
  }
  return {
    ...officialDataset,
    players: officialDataset.players.map((player) => {
      const recorded = previous.get(player.id)
      if (
        !recorded ||
        recorded.name !== player.name ||
        recorded.team !== player.team ||
        recorded.position !== player.position ||
        recorded.registration !== player.registration
      )
        throw new Error('保存された選手の対応を確認できません。')
      return {
        ...player,
        draftFacts: facts(recorded.draftFacts),
        stats: stats(recorded.stats),
      }
    }),
  }
}
