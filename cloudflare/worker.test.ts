import { afterEach, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { AnalyticsStore } from '../server/store'
import { D1Store, type Database, type Statement } from './d1-store'
import worker from './worker'
import type { AnalyticsEvent } from '../src/analytics-contract'

const connections: DatabaseSync[] = []
afterEach(() => {
  for (const db of connections.splice(0)) db.close()
})
function fixture(): Database {
  const db = new DatabaseSync(':memory:')
  connections.push(db)
  db.exec(
    readFileSync(
      new URL('./migrations/0001_analytics.sql', import.meta.url),
      'utf8',
    ),
  )
  class Prepared implements Statement {
    constructor(
      readonly sql: string,
      readonly values: (string | number | null)[] = [],
    ) {}
    bind(...values: (string | number | null)[]) {
      return new Prepared(this.sql, values)
    }
    async first<T>() {
      return (db.prepare(this.sql).get(...this.values) ?? null) as T | null
    }
    async all<T>() {
      return { results: db.prepare(this.sql).all(...this.values) as T[] }
    }
  }
  return {
    prepare: (sql) => new Prepared(sql),
    async batch(statements) {
      db.exec('BEGIN')
      try {
        const r = statements.map((raw) => {
          const s = raw as Prepared
          return db.prepare(s.sql).run(...s.values)
        })
        db.exec('COMMIT')
        return r
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
}
function event(
  type: AnalyticsEvent['type'],
  visitorId: string,
  playId?: string,
): AnalyticsEvent {
  return {
    id: randomUUID(),
    type,
    visitorId,
    ...(type === 'page_view' ? {} : { playId, team: 't' }),
  }
}
it('D1 yields the same reports as the local SQLite adapter, including retries and Japan midnight', async () => {
  const cloud = new D1Store(fixture()),
    local = new AnalyticsStore(':memory:')
  try {
    const visitor = randomUUID(),
      play = randomUUID(),
      now = new Date('2026-10-24T15:01:00Z')
    const start = [
      event('page_view', visitor),
      event('play_start', visitor, play),
    ]
    const finish = [event('play_complete', visitor, play)]
    for (const batch of [start, start, finish, finish]) {
      await cloud.record(batch, now)
      local.record(batch, now)
    }
    expect(await cloud.report('2026-10-24', '2026-10-25', now)).toEqual(
      local.report('2026-10-24', '2026-10-25', now),
    )
    await expect(
      cloud.record(
        [
          event('page_view', visitor),
          event('play_complete', randomUUID(), play),
        ],
        now,
      ),
    ).rejects.toThrow()
    expect(
      (await cloud.report('2026-10-25', '2026-10-25', now)).totals.pageViews,
    ).toBe(1)
  } finally {
    local.close()
  }
})
it('cloud API protects statistics, rejects cross-origin traffic, and returns 503 on quota/storage failure', async () => {
  const env = {
    DB: fixture(),
    ANALYTICS_ADMIN_KEY: 'test-fixture-only-not-a-production-key',
    ASSETS: {
      async fetch() {
        return new Response('app')
      },
    },
  }
  const request = (path: string, init?: RequestInit) =>
    new Request('https://example.workers.dev' + path, init)
  expect(
    (await worker.fetch(request('/api/analytics/admin/summary'), env)).status,
  ).toBe(401)
  expect(
    (
      await worker.fetch(
        request('/api/analytics/health', {
          headers: { Origin: 'https://attacker.example' },
        }),
        env,
      )
    ).status,
  ).toBe(403)
  const viewer = randomUUID()
  const body = JSON.stringify({ events: [event('page_view', viewer)] })
  expect(
    (
      await worker.fetch(
        request('/api/analytics/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        }),
        env,
      )
    ).status,
  ).toBe(204)
  const report = await worker.fetch(
    request('/api/analytics/admin/summary', {
      headers: { Authorization: 'Bearer ' + env.ANALYTICS_ADMIN_KEY },
    }),
    env,
  )
  expect(report.status).toBe(200)
  expect((await report.json()).totals.pageViews).toBe(1)
  env.DB.batch = async () => {
    throw new Error('quota')
  }
  expect(
    (
      await worker.fetch(
        request('/api/analytics/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        }),
        env,
      )
    ).status,
  ).toBe(503)
  expect((await worker.fetch(request('/api/missing'), env)).status).toBe(404)
})
