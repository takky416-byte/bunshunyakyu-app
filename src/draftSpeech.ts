import readings from './playerReadings2026.json' with { type: 'json' }
import type { Player, TeamId } from './data'
import type { Announcement } from './announcements'

const clubReadings: Record<TeamId, string> = {
  d: 'ちゅうにち ドラゴンズ',
  t: 'はんしん タイガース',
  c: 'ひろしま とうよう カープ',
  s: 'とうきょう ヤクルト スワローズ',
  db: 'よこはま ディーエヌエー ベイスターズ',
  g: 'よみうり ジャイアンツ',
  h: 'ふくおか ソフトバンク ホークス',
  l: 'さいたま せいぶ ライオンズ',
  f: 'ほっかいどう にっぽんハム ファイターズ',
  b: 'オリックス バファローズ',
  m: 'ちば ロッテ マリーンズ',
  e: 'とうほく らくてん ゴールデンイーグルス',
}

export function playerReading(player: Player): string {
  const entry = (
    readings.players as Record<
      string,
      {
        name: string
        birthDate: string
        reading: string
      }
    >
  )[player.id]
  return entry?.name === player.name && entry.birthDate === player.birthDate
    ? entry.reading
    : player.name
}

/** Separate clauses make the pauses explicit without imitating a real voice. */
export function draftSpeech(item: Announcement, players: Player[]): string[] {
  const { game } = item
  if (item.kind === 'nominations') return ['12球団の候補が、揃いました。']
  if (item.kind === 'order')
    return ['最初の指名権は。', `${clubReadings[game.order[0]]}。`]
  const picks =
    item.kind === 'round2'
      ? game.picks.filter((p) => p.round === 2)
      : game.picks.slice(-1)
  if (!picks.length) return ['第2巡の指名は、ありませんでした。']
  return picks.flatMap((pick) => {
    const player = players.find((p) => p.id === pick.playerId)
    if (!player) return []
    return [
      `第${pick.round}巡。${clubReadings[pick.by]}。選択希望選手。`,
      `${playerReading(player)}。`,
      `${player.position}。`,
      `${clubReadings[pick.from]}。`,
    ]
  })
}
