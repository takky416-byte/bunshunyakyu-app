export type TeamId =
  'g' | 't' | 'db' | 'c' | 's' | 'd' | 'h' | 'f' | 'm' | 'e' | 'b' | 'l'
export type Position = '投手' | '捕手' | '内野手' | '外野手'
export interface Team {
  id: TeamId
  name: string
  short: string
  city: string
  mark: string
  league: 'セ・リーグ' | 'パ・リーグ'
  color: string
  need: Position
  philosophy: string
}
export const teams: Team[] = [
  {
    id: 't',
    name: '阪神タイガース',
    short: '阪神',
    city: 'HANSHIN',
    mark: 'T',
    league: 'セ・リーグ',
    color: '#c4a447',
    need: '外野手',
    philosophy: '層の厚い投手陣を生かし、外野の選択肢を増やす。',
  },
  {
    id: 'g',
    name: '読売ジャイアンツ',
    short: '巨人',
    city: 'TOKYO',
    mark: 'G',
    league: 'セ・リーグ',
    color: '#c86737',
    need: '内野手',
    philosophy: '次の世代を担う内野手に、新たなチャンスを。',
  },
  {
    id: 'db',
    name: '横浜DeNAベイスターズ',
    short: 'DeNA',
    city: 'YOKOHAMA',
    mark: 'B',
    league: 'セ・リーグ',
    color: '#3976b0',
    need: '投手',
    philosophy: '長いシーズンを支える投手の選択肢を広げる。',
  },
  {
    id: 'c',
    name: '広島東洋カープ',
    short: '広島',
    city: 'HIROSHIMA',
    mark: 'C',
    league: 'セ・リーグ',
    color: '#b74546',
    need: '外野手',
    philosophy: '外野の競争を促し、打線に新しい可能性を。',
  },
  {
    id: 's',
    name: '東京ヤクルトスワローズ',
    short: 'ヤクルト',
    city: 'TOKYO',
    mark: 'S',
    league: 'セ・リーグ',
    color: '#487d68',
    need: '投手',
    philosophy: '投手陣の層を厚くし、安定した戦いにつなげる。',
  },
  {
    id: 'd',
    name: '中日ドラゴンズ',
    short: '中日',
    city: 'NAGOYA',
    mark: 'D',
    league: 'セ・リーグ',
    color: '#3c5e92',
    need: '内野手',
    philosophy: '内野の競争力を高め、攻守の底上げを目指す。',
  },
  {
    id: 'h',
    name: '福岡ソフトバンクホークス',
    short: 'ソフトバンク',
    city: 'FUKUOKA',
    mark: 'H',
    league: 'パ・リーグ',
    color: '#b59132',
    need: '捕手',
    philosophy: '捕手の選手層を厚くし、編成の選択肢を増やす。',
  },
  {
    id: 'f',
    name: '北海道日本ハムファイターズ',
    short: '日本ハム',
    city: 'HOKKAIDO',
    mark: 'F',
    league: 'パ・リーグ',
    color: '#428a96',
    need: '内野手',
    philosophy: '可能性を秘めた内野手を迎え、チーム内競争へ。',
  },
  {
    id: 'm',
    name: '千葉ロッテマリーンズ',
    short: 'ロッテ',
    city: 'CHIBA',
    mark: 'M',
    league: 'パ・リーグ',
    color: '#5c6268',
    need: '投手',
    philosophy: '投手の厚みを加え、シーズンを戦い抜く力に。',
  },
  {
    id: 'e',
    name: '東北楽天ゴールデンイーグルス',
    short: '楽天',
    city: 'TOHOKU',
    mark: 'E',
    league: 'パ・リーグ',
    color: '#964657',
    need: '外野手',
    philosophy: '外野の新たな競争から、打線の活性化を狙う。',
  },
  {
    id: 'b',
    name: 'オリックス・バファローズ',
    short: 'オリックス',
    city: 'OSAKA',
    mark: 'B',
    league: 'パ・リーグ',
    color: '#726a43',
    need: '捕手',
    philosophy: '捕手の層と将来の選択肢を、ともに広げる。',
  },
  {
    id: 'l',
    name: '埼玉西武ライオンズ',
    short: '西武',
    city: 'SAITAMA',
    mark: 'L',
    league: 'パ・リーグ',
    color: '#486a87',
    need: '外野手',
    philosophy: '外野に新しい選択肢を加え、攻撃力を磨く。',
  },
]
export const teamById = Object.fromEntries(
  teams.map((t) => [t.id, t]),
) as Record<TeamId, Team>
export const teamIds = teams.map((t) => t.id)
export const positions: Position[] = ['投手', '捕手', '内野手', '外野手']
export interface PlayerStats {
  games: number
  era?: number | null
  wins?: number | null
  losses?: number | null
  saves?: number | null
  innings?: string
  plateAppearances?: number | null
  average?: number | null
  homeRuns?: number | null
  rbi?: number | null
  ops?: number | null
}
export interface Player {
  draftFacts?: import('./eligibility').EligibilityFacts
  id: string
  team: TeamId
  name: string
  position: Position
  /** Simulator availability, not proof of official draft eligibility. */
  eligible: boolean
  eligibility?: 'unverified' | 'ineligible-development'
  number?: string
  birthDate?: string
  throws?: string
  bats?: string
  registration?: string
  note?: string
  sourceUrl?: string
  statsSourceUrl?: string
  stats?: PlayerStats | null
}
export interface Dataset {
  version: 1
  season: number
  label: string
  sourceUrl: string | null
  kind: 'reference' | 'imported' | 'official-roster'
  asOf: string | null
  players: Player[]
  sources?: { url: string; sha256: string; retrievedAt: string }[]
}

// Historical reference names, entered manually. Not a 2026 roster, not verified
// eligible nominees, and not a statistical database. See docs/DATA.md.
const referenceNames: Record<TeamId, string[]> = {
  t: [
    '浜地 真澄',
    '加治屋 蓮',
    '鈴木 勇斗',
    '榮枝 裕貴',
    '髙寺 望夢',
    '小野寺 暖',
  ],
  g: [
    '直江 大輔',
    '畠 世周',
    '堀田 賢慎',
    '岸田 行倫',
    '増田 大輝',
    '秋広 優人',
  ],
  db: [
    '京山 将弥',
    '上茶谷 大河',
    '濵口 遥大',
    '益子 京右',
    '知野 直人',
    '蝦名 達夫',
  ],
  c: [
    '遠藤 淳志',
    '玉村 昇悟',
    '大道 温貴',
    '中村 奨成',
    '林 晃汰',
    '宇草 孔基',
  ],
  s: [
    '原 樹理',
    '高梨 裕稔',
    '柴田 大地',
    '西田 明央',
    '北村 拓己',
    '丸山 和郁',
  ],
  d: [
    '根尾 昂',
    '梅津 晃大',
    '石森 大誠',
    '石橋 康太',
    '石垣 雅海',
    '鵜飼 航丞',
  ],
  h: [
    '笠谷 俊介',
    '田浦 文丸',
    '大津 亮介',
    '谷川原 健太',
    '野村 勇',
    '正木 智也',
  ],
  f: ['鈴木 健矢', '畔柳 亨丞', '福田 俊', '田宮 裕涼', '阪口 樂', '今川 優馬'],
  m: [
    '二木 康太',
    '本前 郁也',
    '中森 俊介',
    '柿沼 友哉',
    '平沢 大河',
    '山本 大斗',
  ],
  e: [
    '弓削 隼人',
    '津留﨑 大成',
    '内 星龍',
    '堀内 謙伍',
    '黒川 史陽',
    '武藤 敦貴',
  ],
  b: ['吉田 輝星', '本田 仁海', '前 佑囲斗', '福永 奨', '元 謙太', '来田 涼斗'],
  l: [
    '與座 海人',
    '浜屋 将太',
    '渡邉 勇太朗',
    '古賀 悠斗',
    '平沼 翔太',
    '長谷川 信哉',
  ],
}
const referencePositions: Position[] = [
  '投手',
  '投手',
  '投手',
  '捕手',
  '内野手',
  '外野手',
]
export const referenceDataset: Dataset = {
  version: 1,
  season: 2024,
  label: '操作体験用・過去所属の参考選手72名',
  sourceUrl: null,
  kind: 'reference',
  asOf: null,
  players: teams.flatMap((t) =>
    referenceNames[t.id].map((name, i) => ({
      id: `${t.id}-${i + 1}`,
      team: t.id,
      name,
      position: referencePositions[i],
      eligible: true,
    })),
  ),
}

export function parseDataset(value: unknown): Dataset {
  if (!value || typeof value !== 'object')
    throw new Error('データはJSONオブジェクトで指定してください。')
  const d = value as Record<string, unknown>
  if (d.version !== 1 || d.season !== 2026)
    throw new Error('version: 1、season: 2026 のデータを指定してください。')
  if (typeof d.label !== 'string' || !d.label.trim() || d.label.length > 160)
    throw new Error('データ名 label を1〜160文字で指定してください。')
  if (
    typeof d.asOf !== 'string' ||
    !/^2026-\d{2}-\d{2}$/.test(d.asOf) ||
    Number.isNaN(Date.parse(d.asOf)) ||
    new Date(d.asOf).toISOString().slice(0, 10) !== d.asOf
  )
    throw new Error('2026年の基準日 asOf（YYYY-MM-DD）を指定してください。')
  if (
    d.sourceUrl !== null &&
    (typeof d.sourceUrl !== 'string' || !/^https:\/\//.test(d.sourceUrl))
  )
    throw new Error('sourceUrl はhttpsのURLまたはnullにしてください。')
  if (!Array.isArray(d.players) || d.players.length > 1500)
    throw new Error('players は1,500名以内の配列にしてください。')
  const seen = new Set<string>()
  const names = new Set<string>()
  const players: Player[] = d.players.map((raw, index) => {
    if (!raw || typeof raw !== 'object')
      throw new Error(`${index + 1}行目の選手データが不正です。`)
    const p = raw as Record<string, unknown>
    if (
      typeof p.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(p.id) ||
      seen.has(p.id)
    )
      throw new Error(`${index + 1}行目の選手IDが不正または重複しています。`)
    if (
      !teamIds.includes(p.team as TeamId) ||
      typeof p.name !== 'string' ||
      !p.name.trim() ||
      p.name.length > 50 ||
      !positions.includes(p.position as Position) ||
      typeof p.eligible !== 'boolean'
    )
      throw new Error(
        `${index + 1}行目の球団・選手名・守備位置・eligibleを確認してください。`,
      )
    const normalizedName = p.name.normalize('NFKC').replace(/\s/g, '')
    if (names.has(normalizedName))
      throw new Error(
        `選手名「${p.name}」が重複しています。同姓同名は別名で区別してください。`,
      )
    seen.add(p.id)
    names.add(normalizedName)
    return {
      id: p.id,
      team: p.team as TeamId,
      name: p.name.trim(),
      position: p.position as Position,
      eligible: p.eligible,
    }
  })
  for (const t of teams) {
    if (players.filter((p) => p.team === t.id && p.eligible).length < 2)
      throw new Error(
        `${t.name}の eligible: true の選手を2名以上指定してください。`,
      )
  }
  return {
    version: 1,
    season: 2026,
    label: d.label.trim(),
    sourceUrl: d.sourceUrl as string | null,
    kind: 'imported',
    asOf: d.asOf,
    players,
  }
}
