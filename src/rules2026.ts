import type { TeamId } from './data'

export const RULESET_ID = '2026-salary-proxy-v2'
// NPB 2026 draft index lists teams in second-round order; corroborated by Sanspo.
// https://draft.npb.jp/draft/2026/draftlist_e.html
export const waiverOrder2026: TeamId[] = [
  'e',
  'd',
  'm',
  's',
  'b',
  'c',
  'f',
  'db',
  'l',
  'g',
  'h',
  't',
]
export const salaryPolicy =
  '2026年推定年俸で仮判定（実際の翌季年俸とは異なる場合があります）'
