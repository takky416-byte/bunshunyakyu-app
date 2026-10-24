import { expect, it } from 'vitest'
import { playerAge, playerCareerYears } from './playerBio'
import { officialDataset } from './officialData'
import { eligibilityOf } from './eligibility'

it('uses a fixed draft-day age and handles birthdays and invalid dates', () => {
  expect(playerAge('2000-12-09')).toBe(26)
  expect(playerAge('2000-12-10')).toBe(25)
  expect(playerAge('2000-02-29')).toBe(26)
  expect(playerAge('2000-12-09', '2025-12-08')).toBe(24)
  for (const value of [
    undefined,
    '2000-2-3',
    '2001-02-29',
    '2026-12-10',
    'bad',
  ])
    expect(playerAge(value)).toBeNull()
  expect(playerAge('2000-12-09', '2026-02-30')).toBeNull()
})
it('includes development-contract seasons and supplies verified years for every selectable player', () => {
  const byName = (name: string) =>
    officialDataset.players.find((p) => p.name === name)!
  expect(playerCareerYears(byName('伊原 陵人'))).toBe(2)
  expect(playerCareerYears(byName('ワォーターズ'))).toBe(3)
  expect(playerCareerYears(byName('リチャード'))).toBe(9)
  for (const player of officialDataset.players) {
    expect(playerAge(player.birthDate)).not.toBeNull()
    if (eligibilityOf(player).allowed) {
      expect(playerCareerYears(player), player.name).not.toBeNull()
      expect(playerCareerYears(player)!).toBeGreaterThan(0)
    }
  }
  const player = byName('ワォーターズ')
  expect(playerCareerYears({ ...player, name: '別の選手' })).toBeNull()
  expect(playerCareerYears({ ...player, birthDate: undefined })).toBeNull()
})
