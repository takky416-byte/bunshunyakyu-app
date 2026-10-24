import { describe, expect, it } from 'vitest'
import { officialDataset } from './officialData'
import { eligibilityOf } from './eligibility'
import { draftSpeech, playerReading } from './draftSpeech'
import { newGame } from './engine'
import { loadSoundOptions } from './draftSound'

describe('announcement speech', () => {
  it('reads the player, then position, then original club', () => {
    const player = officialDataset.players.find((p) => p.name === '渡辺 翔太')!
    expect(player).toBeDefined()
    const game = {
      ...newGame('d', 9),
      picks: [
        {
          by: 'd' as const,
          from: player.team,
          playerId: player.id,
          round: 1 as const,
        },
      ],
    }
    const script = draftSpeech({ kind: 'pick', game }, officialDataset.players)
    expect(script).toEqual([
      '第1巡。ちゅうにち ドラゴンズ。選択希望選手。',
      'わたなべ しょうた。',
      '投手。',
      'とうほく らくてん ゴールデンイーグルス。',
    ])
  })
  it('covers every currently selectable official player without guessing kana', () => {
    const selectable = officialDataset.players.filter(
      (p) => eligibilityOf(p).allowed,
    )
    expect(selectable).toHaveLength(501)
    for (const p of selectable)
      expect(playerReading(p)).toMatch(/^[ぁ-ゖァ-ヺー 　]+$/)
    const original = selectable[0]
    expect(playerReading({ ...original, name: '取り込み選手' })).toBe(
      '取り込み選手',
    )
    expect(playerReading({ ...original, birthDate: '1990-01-01' })).toBe(
      original.name,
    )
  })
  it('announces every second-round pick in order, or a no-pick result', () => {
    const players = officialDataset.players
      .filter((p) => p.team === 'e')
      .slice(0, 2)
    const game = newGame('d', 1)
    expect(draftSpeech({ kind: 'round2', game }, players)).toEqual([
      '第2巡の指名は、ありませんでした。',
    ])
    game.picks = players.map((p) => ({
      by: 'd',
      from: 'e',
      playerId: p.id,
      round: 2,
    }))
    const script = draftSpeech({ kind: 'round2', game }, players)
    expect(script).toHaveLength(8)
    expect(script[1]).toBe(`${playerReading(players[0])}。`)
    expect(script[5]).toBe(`${playerReading(players[1])}。`)
  })
})

describe('sound preferences', () => {
  it('starts silent and accepts only typed, bounded saved settings', () => {
    expect(loadSoundOptions(null).enabled).toBe(false)
    expect(loadSoundOptions('broken').enabled).toBe(false)
    expect(
      loadSoundOptions('{"enabled":"true","volume":999,"bgm":false}'),
    ).toMatchObject({ enabled: false, volume: 1, bgm: false })
    expect(loadSoundOptions('{"volume":-1}').volume).toBe(0)
  })
})
