import { teamIds } from '../src/data.ts'
import { shiftDate, tokyoDate } from '../src/analytics-contract.ts'
import type { AnalyticsEvent } from '../src/analytics-contract.ts'

export const RETENTION_DAYS = 180
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function validId(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value)
}
export function parseEvent(value: unknown): AnalyticsEvent {
  if (!value || typeof value !== 'object')
    throw new Error('イベントの形式が不正です。')
  const e = value as Record<string, unknown>
  if (!validId(e.id) || !validId(e.visitorId))
    throw new Error('識別IDが不正です。')
  if (!['page_view', 'play_start', 'play_complete'].includes(String(e.type)))
    throw new Error('イベント種別が不正です。')
  if (e.type === 'page_view') {
    if (e.team !== undefined || e.playId !== undefined)
      throw new Error('アクセスイベントにプレー情報は指定できません。')
    return { id: e.id, visitorId: e.visitorId, type: 'page_view' }
  }
  if (!validId(e.playId) || !teamIds.includes(e.team as never))
    throw new Error('プレー情報が不正です。')
  return {
    id: e.id,
    visitorId: e.visitorId,
    type: e.type as AnalyticsEvent['type'],
    playId: e.playId,
    team: e.team as AnalyticsEvent['team'],
  }
}
function validDate(date: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date
  )
}
export function validateRange(
  from: string,
  to: string,
  now = new Date(),
): void {
  const today = tokyoDate(now)
  if (
    !validDate(from) ||
    !validDate(to) ||
    from > to ||
    to > today ||
    from < shiftDate(today, -(RETENTION_DAYS - 1))
  )
    throw new Error('期間は直近180日以内の有効な日付で指定してください。')
}
