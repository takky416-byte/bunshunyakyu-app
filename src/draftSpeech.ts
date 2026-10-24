import readings from './playerReadings2026.json' with { type: 'json' }
import type { Player, TeamId, Position } from './data'
import type { Announcement } from './announcements'

export interface SpeechClause {
  text: string
  kind: 'body' | 'name'
  rate: number
  pauseAfterMs: number
}
const clubReadings: Record<TeamId, string> = {
  d: 'ちゅうにちドラゴンズ',
  t: 'はんしんタイガース',
  c: 'ひろしまとうようカープ',
  s: 'とうきょうヤクルトスワローズ',
  db: 'よこはまディーエヌエーベイスターズ',
  g: 'よみうりジャイアンツ',
  h: 'ふくおかソフトバンクホークス',
  l: 'さいたませいぶライオンズ',
  f: 'ほっかいどうにっぽんハムファイターズ',
  b: 'オリックスバファローズ',
  m: 'ちばロッテマリーンズ',
  e: 'とうほくらくてんゴールデンイーグルス',
}
export const positionReadings: Record<Position, string> = {
  外野手: 'がいやしゅ',
  内野手: 'ないやしゅ',
  捕手: 'ほしゅ',
  投手: 'とうしゅ',
}
export const speechClause = (
  text: string,
  kind: SpeechClause['kind'] = 'body',
): SpeechClause => ({
  text,
  kind,
  rate: 1,
  pauseAfterMs: kind === 'name' ? 800 : 120,
})
export const speechKey = (clause: SpeechClause) =>
  `${clause.kind}|${clause.text}`
const clubShortReadings: Record<TeamId, string> = {
  d: 'ちゅうにち',
  t: 'はんしん',
  c: 'ひろしま',
  s: 'ヤクルト',
  db: 'ディーエヌエー',
  g: 'きょじん',
  h: 'ソフトバンク',
  l: 'せいぶ',
  f: 'にっぽんハム',
  b: 'オリックス',
  m: 'ロッテ',
  e: 'らくてん',
}
const introduction = (round: 1 | 2, team: TeamId): SpeechClause => ({
  ...speechClause(
    `${round === 1 ? 'だいいちじゅん' : 'だいにじゅん'}獲得希望選手、${clubShortReadings[team]}。`,
  ),
  pauseAfterMs: 1100,
})
const affiliation = (position: Position, team: TeamId) =>
  speechClause(`${positionReadings[position]}、${clubReadings[team]}。`)
const nominations = () =>
  speechClause('じゅうにきゅうだんの候補が、そろいました。')
const noSecondRound = () =>
  speechClause('だいにじゅんは、指名がありませんでした。')
const opening = (team: TeamId) =>
  speechClause(`最初の指名権は、${clubReadings[team]}です。`)
export const nameSpeech = (reading: string): SpeechClause =>
  speechClause(`${reading.trim().replace(/\s+/, '、')}。`, 'name')
export const speechSample = () => [
  introduction(1, 'd'),
  nameSpeech('わたなべ しょうた'),
  affiliation('投手', 'e'),
]

export function playerReading(player: Player): string {
  const entry = (
    readings.players as Record<
      string,
      { name: string; birthDate: string; reading: string }
    >
  )[player.id]
  return entry?.name === player.name && entry.birthDate === player.birthDate
    ? entry.reading
    : player.name
}
export function draftSpeech(
  item: Announcement,
  players: Player[],
): SpeechClause[] {
  const { game } = item
  if (item.kind === 'nominations') return [nominations()]
  if (item.kind === 'order') return [opening(game.order[0])]
  const all = game.picks.filter((p) => p.round === 2)
  const picks =
    item.kind === 'round2'
      ? item.pickIndex === undefined
        ? all
        : all.slice(item.pickIndex, item.pickIndex + 1)
      : game.picks.slice(-1)
  if (!picks.length) return [noSecondRound()]
  return picks.flatMap((pick) => {
    const player = players.find((p) => p.id === pick.playerId)
    return player
      ? [
          introduction(pick.round, pick.by),
          nameSpeech(playerReading(player)),
          affiliation(player.position, pick.from),
        ]
      : []
  })
}

/** Exported for the offline asset builder; all game requests stay on this site. */
export function voiceCatalog(): SpeechClause[] {
  const result: SpeechClause[] = [
    nominations(),
    noSecondRound(),
    ...speechSample(),
  ]
  for (const team of Object.keys(clubReadings) as TeamId[]) {
    result.push(opening(team), introduction(1, team), introduction(2, team))
    for (const position of Object.keys(positionReadings) as Position[])
      result.push(affiliation(position, team))
  }
  for (const p of Object.values(readings.players))
    result.push(nameSpeech(p.reading))
  return [
    ...new Map(result.map((clause) => [speechKey(clause), clause])).values(),
  ]
}
