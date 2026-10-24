import type { TeamId } from './data'

export interface ClubTheme {
  accent: string
  deep: string
  soft: string
  onAccent: string
  link: string
}
export const clubThemes: Record<TeamId, ClubTheme> = {
  d: {
    accent: '#005bac',
    deep: '#102d50',
    soft: '#edf5ff',
    onAccent: '#ffffff',
    link: '#005094',
  },
  t: {
    accent: '#f9ca00',
    deep: '#202326',
    soft: '#fffbea',
    onAccent: '#202326',
    link: '#756000',
  },
  c: {
    accent: '#c82127',
    deep: '#491c23',
    soft: '#fff1f1',
    onAccent: '#ffffff',
    link: '#a41920',
  },
  s: {
    accent: '#087b47',
    deep: '#133a30',
    soft: '#eef9f1',
    onAccent: '#ffffff',
    link: '#07653c',
  },
  db: {
    accent: '#006bb6',
    deep: '#0a304c',
    soft: '#edf7ff',
    onAccent: '#ffffff',
    link: '#005a98',
  },
  g: {
    accent: '#f58220',
    deep: '#30251e',
    soft: '#fff4e9',
    onAccent: '#202326',
    link: '#994600',
  },
  h: {
    accent: '#f4c300',
    deep: '#2d2d24',
    soft: '#fffbe7',
    onAccent: '#202326',
    link: '#716000',
  },
  l: {
    accent: '#003c73',
    deep: '#102d45',
    soft: '#edf5fc',
    onAccent: '#ffffff',
    link: '#003c73',
  },
  f: {
    accent: '#0073b9',
    deep: '#10384d',
    soft: '#edf9ff',
    onAccent: '#ffffff',
    link: '#005f99',
  },
  b: {
    accent: '#182d59',
    deep: '#14233c',
    soft: '#f3f3ed',
    onAccent: '#ffffff',
    link: '#243966',
  },
  m: {
    accent: '#30363b',
    deep: '#1b2228',
    soft: '#f1f3f4',
    onAccent: '#ffffff',
    link: '#30363b',
  },
  e: {
    accent: '#90012c',
    deep: '#3c1c2a',
    soft: '#fff0f5',
    onAccent: '#ffffff',
    link: '#90012c',
  },
}

// Display order is deliberately separate from engine teamIds and replay order.
export const centralSelection: TeamId[] = ['d', 't', 'c', 's', 'db', 'g']
// NPB 2026 standings, checked 2026-10-24. Do not fetch on app startup.
export const pacificSelection: TeamId[] = ['h', 'l', 'f', 'b', 'm', 'e']
export const selectionNames: Record<TeamId, string> = {
  d: '中日',
  t: '阪神',
  c: '広島',
  s: 'ヤクルト',
  db: '横浜DeNA',
  g: '読売',
  h: 'ソフトバンク',
  l: '西武',
  f: '日本ハム',
  b: 'オリックス',
  m: 'ロッテ',
  e: '楽天',
}
export function clubStyle(id: TeamId): Record<string, string> {
  const theme = clubThemes[id]
  return {
    '--club-accent': theme.accent,
    '--club-deep': theme.deep,
    '--club-soft': theme.soft,
    '--club-on-accent': theme.onAccent,
    '--club-link': theme.link,
    '--club-line': `color-mix(in srgb, ${theme.accent} 22%, #dce2df)`,
    '--club-page': `color-mix(in srgb, ${theme.accent} 3%, #fafbf9)`,
    '--green': theme.link,
    '--ink': theme.deep,
  }
}
