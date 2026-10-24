import type { TeamId } from './data'

export type AnalyticsEventType = 'page_view' | 'play_start' | 'play_complete'
export interface AnalyticsEvent {
  id: string
  type: AnalyticsEventType
  visitorId: string
  playId?: string
  team?: TeamId
}
export interface AnalyticsCounts {
  pageViews: number
  visitors: number
  players: number
  starts: number
  completions: number
}
export interface AnalyticsReport {
  from: string
  to: string
  timeZone: 'Asia/Tokyo'
  generatedAt: string
  totals: AnalyticsCounts
  daily: (AnalyticsCounts & { date: string })[]
  hourly: { hour: number; starts: number; players: number }[]
  teams: { team: TeamId; starts: number; completions: number }[]
  recentPlays: {
    startedAt: string
    completedAt: string | null
    team: TeamId
  }[]
}

export function tokyoDate(date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
