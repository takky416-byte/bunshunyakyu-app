import { describe, expect, it } from 'vitest'
import { officialDataset } from './officialData'
import { eligibilityOf } from './eligibility'
import {
  draftSpeech,
  playerReading,
  voiceCatalog,
  speechKey,
  nameSpeech,
} from './draftSpeech'
import maleVoice from './maleVoice2026.json' with { type: 'json' }
import { existsSync } from 'node:fs'
import { newGame } from './engine'
import { loadSoundOptions, chooseMaleVoice } from './draftSound'

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
    expect(script.map((c) => c.text)).toEqual([
      'だいいちじゅん獲得希望選手、ちゅうにち。',
      'わたなべ、しょうた。',
      'とうしゅ、とうほくらくてんゴールデンイーグルス。',
    ])
    expect(script.every((clause) => clause.rate === 1)).toBe(true)
    expect(script[1].pauseAfterMs).toBe(800)
    expect(nameSpeech('リチャード').text).toBe('リチャード。')
    expect(script[0].pauseAfterMs).toBe(1100)
    expect(script[0].pauseAfterMs).toBeGreaterThan(script[1].pauseAfterMs)
    expect(script[0].rate).toBe(script[2].rate)
  })
  it('covers every currently selectable official player without guessing kana', () => {
    const selectable = officialDataset.players.filter(
      (p) => eligibilityOf(p).allowed,
    )
    expect(selectable).toHaveLength(492)
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
    expect(draftSpeech({ kind: 'round2', game }, players)[0].text).toBe(
      'だいにじゅんは、指名がありませんでした。',
    )
    game.picks = players.map((p) => ({
      by: 'd',
      from: 'e',
      playerId: p.id,
      round: 2,
    }))
    const script = draftSpeech({ kind: 'round2', game }, players)
    expect(script).toHaveLength(6)
    expect(script[1].text).toBe(nameSpeech(playerReading(players[0])).text)
    expect(script[4].text).toBe(nameSpeech(playerReading(players[1])).text)
    const onlySecond = draftSpeech(
      { kind: 'round2', game, pickIndex: 1 },
      players,
    )
    expect(onlySecond).toHaveLength(3)
    expect(onlySecond[0].text).toMatch(/^だいにじゅん獲得希望選手、/)
    expect(onlySecond[1].text).toBe(nameSpeech(playerReading(players[1])).text)
  })
})

it('provides a male recording for every official phrase and player name', () => {
  expect(maleVoice.gender).toBe('Male')
  expect(maleVoice.pitchSemitones).toBe(0)
  expect(maleVoice.processing).toBe('natural-v4')
  expect(maleVoice.nameRate).toBe(maleVoice.bodyRate)
  expect(maleVoice.nameRate).toBe('+0%')
  const clips = maleVoice.clips as Record<string, string>
  for (const clause of voiceCatalog()) {
    const path = clips[speechKey(clause)]
    expect(path).toBeTruthy()
    expect(existsSync(new URL('../public' + path, import.meta.url))).toBe(true)
  }
})

describe('sound preferences', () => {
  it('never mistakes female metadata or an unknown Japanese voice for a male fallback', () => {
    const voices = [
      'Haruka Japanese Female',
      'Google 日本語',
      'Microsoft Ichiro Japanese Male',
    ].map(
      (name) =>
        ({ name, lang: 'ja-JP', voiceURI: name }) as SpeechSynthesisVoice,
    )
    expect(chooseMaleVoice(voices)).toBe(voices[2])
    expect(chooseMaleVoice(voices.slice(0, 2))).toBeNull()
  })
  it('starts silent and accepts only typed, bounded saved settings', () => {
    expect(loadSoundOptions(null).enabled).toBe(false)
    expect(loadSoundOptions('broken').enabled).toBe(false)
    expect(
      loadSoundOptions('{"enabled":"true","volume":999,"bgm":false}'),
    ).toMatchObject({ enabled: false, volume: 1, bgm: false })
    expect(loadSoundOptions('{"volume":-1}').volume).toBe(0)
  })
})
