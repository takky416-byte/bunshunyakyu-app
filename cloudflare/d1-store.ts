import { teamIds } from '../src/data'
import {
  shiftDate,
  tokyoDate,
  type AnalyticsEvent,
  type AnalyticsCounts,
  type AnalyticsReport,
} from '../src/analytics-contract'
import { RETENTION_DAYS, validateRange } from '../server/analytics-core'

export interface Statement {
  bind(...values: (string | number | null)[]): Statement
  first<T>(): Promise<T | null>
  all<T>(): Promise<{ results: T[] }>
}
export interface Database {
  prepare(sql: string): Statement
  batch(statements: Statement[]): Promise<unknown[]>
}
export class D1Store {
  constructor(private db: Database) {}
  async record(events: AnalyticsEvent[], now = new Date()) {
    const time = now.toISOString()
    const commands: Statement[] = []
    for (const e of events) {
      if (e.type === 'play_start')
        commands.push(
          this.db
            .prepare(
              'INSERT OR IGNORE INTO plays(id,visitor_id,team,started_at) VALUES(?,?,?,?)',
            )
            .bind(e.playId!, e.visitorId, e.team!, time),
        )
      if (e.type === 'play_complete')
        commands.push(
          this.db
            .prepare(
              'UPDATE plays SET completed_at=COALESCE(completed_at,?) WHERE id=? AND visitor_id=? AND team=?',
            )
            .bind(time, e.playId!, e.visitorId, e.team!),
        )
      commands.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO events(id,type,visitor_id,play_id,team,occurred_at) SELECT ?,?,?,?,?,? WHERE ?='page_view' OR EXISTS(SELECT 1 FROM plays WHERE id=?)`,
          )
          .bind(
            e.id,
            e.type,
            e.visitorId,
            e.playId ?? null,
            e.team ?? null,
            time,
            e.type,
            e.playId ?? null,
          ),
      )
    }
    // D1 batch is atomic; identity_guard rolls back mixed-identity batches.
    await this.db.batch(commands)
  }
  async prune(now = new Date()) {
    const cutoff = new Date(
      `${shiftDate(tokyoDate(now), -(RETENTION_DAYS - 1))}T00:00:00+09:00`,
    ).toISOString()
    await this.db.batch([
      this.db.prepare('DELETE FROM events WHERE occurred_at < ?').bind(cutoff),
      this.db
        .prepare(
          'DELETE FROM plays WHERE started_at < ? AND id NOT IN (SELECT play_id FROM events WHERE play_id IS NOT NULL)',
        )
        .bind(cutoff),
    ])
  }
  async report(
    from: string,
    to: string,
    now = new Date(),
  ): Promise<AnalyticsReport> {
    validateRange(from, to, now)
    const start = new Date(`${from}T00:00:00+09:00`).toISOString()
    const end = new Date(`${shiftDate(to, 1)}T00:00:00+09:00`).toISOString()
    const counts = `COUNT(CASE WHEN type='page_view' THEN 1 END) AS pageViews, COUNT(DISTINCT visitor_id) AS visitors, COUNT(DISTINCT CASE WHEN type='play_start' THEN visitor_id END) AS players, COUNT(CASE WHEN type='play_start' THEN 1 END) AS starts, COUNT(CASE WHEN type='play_complete' THEN 1 END) AS completions`
    const totals = (await this.db
      .prepare(
        `SELECT ${counts} FROM events WHERE occurred_at >= ? AND occurred_at < ?`,
      )
      .bind(start, end)
      .first<AnalyticsCounts>())!
    const rows = (
      await this.db
        .prepare(
          `SELECT date(occurred_at,'+9 hours') AS date,${counts} FROM events WHERE occurred_at >= ? AND occurred_at < ? GROUP BY date ORDER BY date`,
        )
        .bind(start, end)
        .all<AnalyticsReport['daily'][number]>()
    ).results
    const daily: AnalyticsReport['daily'] = []
    for (let date = from; date <= to; date = shiftDate(date, 1))
      daily.push(
        rows.find((r) => r.date === date) ?? {
          date,
          pageViews: 0,
          visitors: 0,
          players: 0,
          starts: 0,
          completions: 0,
        },
      )
    const hourStart = new Date(`${to}T00:00:00+09:00`).toISOString()
    const hourlyRows = (
      await this.db
        .prepare(
          `SELECT CAST(strftime('%H',occurred_at,'+9 hours') AS INTEGER) AS hour,COUNT(*) AS starts,COUNT(DISTINCT visitor_id) AS players FROM events WHERE type='play_start' AND occurred_at>=? AND occurred_at<? GROUP BY hour`,
        )
        .bind(hourStart, end)
        .all<AnalyticsReport['hourly'][number]>()
    ).results
    const hourly = Array.from(
      { length: 24 },
      (_, hour) =>
        hourlyRows.find((r) => r.hour === hour) ?? {
          hour,
          starts: 0,
          players: 0,
        },
    )
    const teamRows = (
      await this.db
        .prepare(
          `SELECT team,COUNT(CASE WHEN type='play_start' THEN 1 END) AS starts,COUNT(CASE WHEN type='play_complete' THEN 1 END) AS completions FROM events WHERE team IS NOT NULL AND occurred_at>=? AND occurred_at<? GROUP BY team`,
        )
        .bind(start, end)
        .all<AnalyticsReport['teams'][number]>()
    ).results
    const teams = teamIds.map(
      (team) =>
        teamRows.find((r) => r.team === team) ?? {
          team,
          starts: 0,
          completions: 0,
        },
    )
    const recentPlays = (
      await this.db
        .prepare(
          'SELECT team,started_at AS startedAt,completed_at AS completedAt FROM plays WHERE started_at>=? AND started_at<? ORDER BY started_at DESC,id DESC LIMIT 50',
        )
        .bind(start, end)
        .all<AnalyticsReport['recentPlays'][number]>()
    ).results
    return {
      from,
      to,
      timeZone: 'Asia/Tokyo',
      generatedAt: now.toISOString(),
      totals,
      daily,
      hourly,
      teams,
      recentPlays,
    }
  }
}
