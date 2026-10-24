import { teamById, type Dataset } from './data'
import type { Game } from './engine'
import { clubThemes } from './presentation'

export const APP_URL = 'https://geneki-draft-room.takky416.workers.dev'
export const SHARE_NOTICE =
  '※非公式のシミュレーション結果です（2026年推定年俸で仮判定）。'
export interface SharedPick {
  round: number
  by: string
  from: string
  player: string
  position: string
}
export interface SharedResult {
  title: string
  club: string
  dataset: string
  acquired: SharedPick[]
  released: SharedPick[]
  picks: SharedPick[]
  text: string
  html: string
}
const clean = (value: string) => value.replace(/\s+/g, ' ').trim()
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  )
}
export function shareResult(game: Game, dataset: Dataset): SharedResult {
  if (game.stage !== 'results')
    throw new Error('ドラフト終了後に共有できます。')
  const picks = game.picks.map((p) => {
    const player = dataset.players.find((player) => player.id === p.playerId)
    if (!player) throw new Error('結果の選手情報を確認できません。')
    return {
      round: p.round,
      by: teamById[p.by].short,
      from: teamById[p.from].short,
      player: clean(player.name),
      position: player.position,
    }
  })
  const club = teamById[game.userTeam].name
  const acquired = picks.filter((_, i) => game.picks[i].by === game.userTeam)
  const released = picks.filter((_, i) => game.picks[i].from === game.userTeam)
  const title = `2026 現役ドラフトシミュレーション｜${teamById[game.userTeam].short}`
  const describe = (p: SharedPick) =>
    `${p.player}（${p.position}・第${p.round}巡）${p.from} → ${p.by}`
  const text = [
    title,
    `操作球団：${club}`,
    '',
    '【獲得】',
    ...acquired.map(describe),
    '【放出】',
    ...released.map(describe),
    '',
    '【12球団の移籍結果】',
    ...picks.map(
      (p) => `第${p.round}巡 ${p.from} → ${p.by}：${p.player}（${p.position}）`,
    ),
    '',
    SHARE_NOTICE,
    `使用データ：${clean(dataset.label)}`,
    APP_URL,
  ].join('\n')
  const theme = clubThemes[game.userTeam]
  const e = escapeHtml
  const list = (rows: SharedPick[]) =>
    `<ul>${rows.map((p) => `<li>${e(describe(p))}</li>`).join('')}</ul>`
  const html = `<article lang="ja"><h2>${e(title)}</h2><p>操作球団：${e(club)}</p><h3>獲得</h3>${list(acquired)}<h3>放出</h3>${list(released)}<h3>12球団の移籍結果</h3><table style="border-collapse:collapse;width:100%;font-size:16px"><thead><tr style="background:${theme.accent};color:${theme.onAccent}">${['巡', '移籍元', '獲得球団', '選手', '守備位置'].map((h) => `<th style="padding:8px;border:1px solid #d6dcd8;text-align:left">${h}</th>`).join('')}</tr></thead><tbody>${picks.map((p) => `<tr>${[String(p.round), p.from, p.by, p.player, p.position].map((v) => `<td style="padding:8px;border:1px solid #d6dcd8">${e(v)}</td>`).join('')}</tr>`).join('')}</tbody></table><p>${e(SHARE_NOTICE)}</p><p>使用データ：${e(clean(dataset.label))}</p><p><a href="${APP_URL}">現役ドラフトルームでプレーする</a></p></article>`
  return {
    title,
    club,
    acquired,
    released,
    picks,
    dataset: clean(dataset.label),
    text,
    html,
  }
}
