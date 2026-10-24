import careerSnapshot from './playerCareer2026.json' with { type: 'json' }
import type { Player } from './data'

export const PLAYER_AGE_DATE = '2026-12-09'
export const PLAYER_CAREER_SEASON = 2026

/** Calendar age on the simulated draft day, independent of browser time zone. */
export function playerAge(
  birthDate: string | undefined,
  on = PLAYER_AGE_DATE,
): number | null {
  if (
    !birthDate ||
    !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(on)
  )
    return null
  const birth = new Date(`${birthDate}T00:00:00Z`)
  const reference = new Date(`${on}T00:00:00Z`)
  if (
    !Number.isFinite(birth.getTime()) ||
    !Number.isFinite(reference.getTime()) ||
    birth.toISOString().slice(0, 10) !== birthDate ||
    reference.toISOString().slice(0, 10) !== on ||
    birthDate > on
  )
    return null
  return (
    reference.getUTCFullYear() -
    birth.getUTCFullYear() -
    Number(on.slice(5) < birthDate.slice(5))
  )
}

export function playerCareerYears(player: Player): number | null {
  const entry = (
    careerSnapshot.players as Record<
      string,
      { name: string; birthDate: string; firstNpbSeason: number | null }
    >
  )[player.id]
  if (
    !entry ||
    entry.name !== player.name ||
    entry.birthDate !== player.birthDate ||
    entry.firstNpbSeason == null
  )
    return null
  return PLAYER_CAREER_SEASON - entry.firstNpbSeason + 1
}
