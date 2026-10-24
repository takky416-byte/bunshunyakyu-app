import { DatabaseSync } from 'node:sqlite'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { teamIds } from '../src/data.ts'
import { shiftDate, tokyoDate } from '../src/analytics-contract.ts'
import type {
  AnalyticsEvent,
  AnalyticsReport,
  AnalyticsCounts,
} from '../src/analytics-contract.ts'

import { RETENTION_DAYS, validateRange } from './analytics-core.ts'
export {
  RETENTION_DAYS,
  validateRange,
  parseEvent,
  validId,
} from './analytics-core.ts'

export class AnalyticsStore {
  private db: DatabaseSync
  private lastPruned = 0
  constructor(path: string) {
    if (path !== ':memory:')
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    if (path !== ':memory:') chmodSync(path, 0o600)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS plays (
        id TEXT PRIMARY KEY,
        visitor_id TEXT NOT NULL,
        team TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('page_view','play_start','play_complete')),
        visitor_id TEXT NOT NULL,
        play_id TEXT,
        team TEXT,
        occurred_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS unique_play_event ON events(play_id, type) WHERE play_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS event_time ON events(occurred_at);
      CREATE INDEX IF NOT EXISTS play_time ON plays(started_at);
    `)
  }
  close() {
    this.db.close()
  }
  prune(now = new Date()) {
    if (now.getTime() - this.lastPruned < 3_600_000) return
    const cutoff = `${shiftDate(tokyoDate(now), -(RETENTION_DAYS - 1))}T00:00:00+09:00`
    const iso = new Date(cutoff).toISOString()
    this.db.prepare('DELETE FROM events WHERE occurred_at < ?').run(iso)
    this.db
      .prepare(
        'DELETE FROM plays WHERE started_at < ? AND id NOT IN (SELECT play_id FROM events WHERE play_id IS NOT NULL)',
      )
      .run(iso)
    this.lastPruned = now.getTime()
  }
  record(events: AnalyticsEvent[], now = new Date()) {
    this.prune(now)
    const time = now.toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const event of events) {
        if (this.db.prepare('SELECT id FROM events WHERE id = ?').get(event.id))
          continue
        if (event.type !== 'page_view') {
          const play = this.db
            .prepare('SELECT visitor_id, team FROM plays WHERE id = ?')
            .get(event.playId!)
          if (
            play &&
            (play.visitor_id !== event.visitorId || play.team !== event.team)
          )
            throw new Error('プレーの識別情報が一致しません。')
          if (event.type === 'play_start') {
            this.db
              .prepare(
                'INSERT OR IGNORE INTO plays(id,visitor_id,team,started_at) VALUES(?,?,?,?)',
              )
              .run(event.playId!, event.visitorId, event.team!, time)
          } else {
            // A resumed legacy game, discarded queue, or expired start must not
            // create an orphan completion or inflate player counts.
            if (!play) continue
            this.db
              .prepare(
                'UPDATE plays SET completed_at = COALESCE(completed_at, ?) WHERE id = ?',
              )
              .run(time, event.playId!)
          }
        }
        this.db
          .prepare(
            'INSERT OR IGNORE INTO events(id,type,visitor_id,play_id,team,occurred_at) VALUES(?,?,?,?,?,?)',
          )
          .run(
            event.id,
            event.type,
            event.visitorId,
            event.playId ?? null,
            event.team ?? null,
            time,
          )
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  report(from: string, to: string, now = new Date()): AnalyticsReport {
    validateRange(from, to, now)
    this.prune(now)
    const start = new Date(`${from}T00:00:00+09:00`).toISOString()
    const end = new Date(`${shiftDate(to, 1)}T00:00:00+09:00`).toISOString()
    const counts = `COUNT(CASE WHEN type='page_view' THEN 1 END) AS pageViews,
      COUNT(DISTINCT visitor_id) AS visitors,
      COUNT(DISTINCT CASE WHEN type='play_start' THEN visitor_id END) AS players,
      COUNT(CASE WHEN type='play_start' THEN 1 END) AS starts,
      COUNT(CASE WHEN type='play_complete' THEN 1 END) AS completions`
    const totals = this.db
      .prepare(
        `SELECT ${counts} FROM events WHERE occurred_at >= ? AND occurred_at < ?`,
      )
      .get(start, end) as unknown as AnalyticsCounts
    const rows = this.db
      .prepare(
        `SELECT date(occurred_at,'+9 hours') AS date,${counts} FROM events WHERE occurred_at >= ? AND occurred_at < ? GROUP BY date ORDER BY date`,
      )
      .all(start, end) as unknown as AnalyticsReport['daily']
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
    const hourlyRows = this.db
      .prepare(
        `SELECT CAST(strftime('%H',occurred_at,'+9 hours') AS INTEGER) AS hour, COUNT(*) AS starts, COUNT(DISTINCT visitor_id) AS players FROM events WHERE type='play_start' AND date(occurred_at,'+9 hours')=? GROUP BY hour`,
      )
      .all(to) as unknown as AnalyticsReport['hourly']
    const hourly = Array.from(
      { length: 24 },
      (_, hour) =>
        hourlyRows.find((r) => r.hour === hour) ?? {
          hour,
          starts: 0,
          players: 0,
        },
    )
    const teamRows = this.db
      .prepare(
        `SELECT team, COUNT(CASE WHEN type='play_start' THEN 1 END) AS starts, COUNT(CASE WHEN type='play_complete' THEN 1 END) AS completions FROM events WHERE team IS NOT NULL AND occurred_at >= ? AND occurred_at < ? GROUP BY team`,
      )
      .all(start, end) as unknown as AnalyticsReport['teams']
    const teams = teamIds.map(
      (team) =>
        teamRows.find((r) => r.team === team) ?? {
          team,
          starts: 0,
          completions: 0,
        },
    )
    const recentPlays = this.db
      .prepare(
        'SELECT team, started_at AS startedAt, completed_at AS completedAt FROM plays WHERE started_at >= ? AND started_at < ? ORDER BY started_at DESC, id DESC LIMIT 50',
      )
      .all(start, end) as unknown as AnalyticsReport['recentPlays']
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
