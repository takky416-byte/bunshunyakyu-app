import type { Player } from './data'

export interface EligibilityFacts {
  salaryYear: 2026
  salaryManYen: number | null
  salarySource: string | null
  checkedAt: string
  exclusions: { reason: string; source: string }[]
  holds: string[]
  unresolved: string[]
  foreignPlayerTreatment?: 'domestic'
  treatmentSource?: string
}
export function eligibilityOf(player: Player) {
  const f = player.draftFacts
  const reasons = [...(f?.exclusions.map((e) => e.reason) ?? [])]
  if (!player.eligible) reasons.push('選択対象外')
  if (player.registration === '育成') reasons.push('育成登録')
  if (f?.salaryManYen != null && f.salaryManYen >= 10000)
    reasons.push('2026年推定年俸1億円以上')
  const salary = f?.salaryManYen
  const holds = f?.holds ?? []
  return {
    allowed: reasons.length === 0 && holds.length === 0,
    reasons: [...new Set([...reasons, ...holds])],
    band:
      salary == null
        ? ('unknown' as const)
        : salary >= 5000
          ? ('exception' as const)
          : ('ordinary' as const),
    label: reasons.length
      ? '対象外'
      : holds.length
        ? '対象外'
        : salary != null && salary >= 5000
          ? '高年俸枠'
          : '対象',
    unresolved: f?.unresolved ?? ['年俸・契約条件未確認'],
  }
}
export function nominationErrors(selected: Player[]): string[] {
  const errors: string[] = []
  if (selected.length < 2) errors.push('候補選手を2名以上選んでください。')
  if (selected.some((p) => !eligibilityOf(p).allowed))
    errors.push('対象外の選手は候補に提出できません。')
  const exceptions = selected.filter(
    (p) => eligibilityOf(p).band === 'exception',
  )
  if (exceptions.length > 1)
    errors.push('5,000万円以上1億円未満の例外枠は1名までです。')
  if (
    exceptions.length &&
    selected.filter((p) => eligibilityOf(p).band === 'ordinary').length < 2
  )
    errors.push(
      '高年俸例外を使う場合、5,000万円未満と確認できる選手を2名以上含め、計3名以上提出してください。',
    )
  return errors
}
