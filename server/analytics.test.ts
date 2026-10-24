import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AnalyticsStore, parseEvent, validateRange } from './store.ts'
import { analyticsHandler } from './api.ts'
import type { AnalyticsEvent } from '../src/analytics-contract.ts'

const now = new Date('2026-10-24T15:30:00.000Z') // Oct 25 00:30 JST
const visitor = randomUUID()
const playId = randomUUID()
const makeEvent = (
  type: AnalyticsEvent['type'],
  who = visitor,
  id = playId,
): AnalyticsEvent => ({
  id: randomUUID(),
  visitorId: who,
  type,
  ...(type === 'page_view' ? {} : { playId: id, team: 't' }),
})
const stores: AnalyticsStore[] = []
const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
      server.closeAllConnections()
    })
  for (const store of stores.splice(0)) store.close()
})
function store() {
  const s = new AnalyticsStore(':memory:')
  stores.push(s)
  return s
}

describe('analytics persistence and aggregation', () => {
  it('deduplicates retries, play events and browser refreshes separately', () => {
    const s = store()
    const visit = makeEvent('page_view')
    s.record([visit, makeEvent('play_start')], now)
    s.record([visit, makeEvent('play_start'), makeEvent('play_complete')], now)
    s.record([makeEvent('play_complete'), makeEvent('page_view')], now)
    const r = s.report('2026-10-25', '2026-10-25', now)
    expect(r.totals).toEqual({
      pageViews: 2,
      visitors: 1,
      players: 1,
      starts: 1,
      completions: 1,
    })
    expect(r.recentPlays).toHaveLength(1)
    expect(r.hourly[0]).toEqual({ hour: 0, starts: 1, players: 1 })
    expect(JSON.stringify(r)).not.toContain(visitor)
  })
  it('counts multiple plays by one browser and different browsers correctly', () => {
    const s = store()
    s.record(
      [
        makeEvent('play_start'),
        makeEvent('play_start', visitor, randomUUID()),
        makeEvent('play_start', randomUUID(), randomUUID()),
      ],
      now,
    )
    expect(s.report('2026-10-25', '2026-10-25', now).totals).toMatchObject({
      visitors: 2,
      players: 2,
      starts: 3,
      completions: 0,
    })
  })
  it('uses Japan midnight for day boundaries and zero-fills missing dates', () => {
    const s = store()
    s.record([makeEvent('page_view')], new Date('2026-10-24T14:59:59Z'))
    s.record([makeEvent('page_view')], new Date('2026-10-24T15:00:00Z'))
    const r = s.report('2026-10-23', '2026-10-25', now)
    expect(r.daily.map((r) => [r.date, r.pageViews])).toEqual([
      ['2026-10-23', 0],
      ['2026-10-24', 1],
      ['2026-10-25', 1],
    ])
    expect(r.totals.visitors).toBe(1)
  })
  it('ignores orphan completions and rolls back mixed-identity batches', () => {
    const s = store()
    s.record([makeEvent('play_complete')], now)
    expect(s.report('2026-10-25', '2026-10-25', now).totals.completions).toBe(0)
    s.record([makeEvent('play_start')], now)
    expect(() =>
      s.record(
        [makeEvent('page_view'), makeEvent('play_complete', randomUUID())],
        now,
      ),
    ).toThrow()
    expect(s.report('2026-10-25', '2026-10-25', now).totals.pageViews).toBe(0)
  })
  it('preserves data across SQLite close/reopen and prunes expired records', () => {
    const directory = mkdtempSync(join(tmpdir(), 'draft-store-test-'))
    try {
      const path = join(directory, 'analytics.sqlite')
      const first = new AnalyticsStore(path)
      first.record([makeEvent('page_view')], now)
      first.close()
      const second = new AnalyticsStore(path)
      expect(
        second.report('2026-10-25', '2026-10-25', now).totals.pageViews,
      ).toBe(1)
      const later = new Date('2027-05-01T00:00:00Z')
      second.prune(later)
      expect(
        second.report('2026-11-03', '2027-05-01', later).totals.pageViews,
      ).toBe(0)
      second.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('validates event shapes, team IDs and range boundaries', () => {
    expect(() =>
      parseEvent({ ...makeEvent('play_start'), team: 'fake' }),
    ).toThrow()
    expect(() =>
      parseEvent({ ...makeEvent('page_view'), visitorId: 'an email or ip' }),
    ).toThrow()
    expect(() => parseEvent({ ...makeEvent('page_view'), playId })).toThrow()
    expect(() => validateRange('2026-02-31', '2026-10-25', now)).toThrow()
    expect(() => validateRange('2026-10-26', '2026-10-25', now)).toThrow()
    expect(() => validateRange('2026-01-01', '2026-10-25', now)).toThrow()
  })
})

describe('analytics HTTP API', () => {
  const key = 'test-fixture-only-not-a-production-key'
  async function api() {
    const s = store()
    const handle = analyticsHandler(s, key, () => now)
    const server = createServer((req, res) => {
      void handle(req, res).then((handled) => {
        if (!handled) {
          res.writeHead(404)
          res.end()
        }
      })
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    return { base: `http://127.0.0.1:${address.port}`, s }
  }
  it('protects summaries and returns valid stats only with the admin key', async () => {
    const { base } = await api()
    expect((await fetch(base + '/api/analytics/admin/summary')).status).toBe(
      401,
    )
    const response = await fetch(base + '/api/analytics/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: [makeEvent('page_view'), makeEvent('play_start')],
      }),
    })
    expect(response.status).toBe(204)
    const summary = await fetch(
      base + '/api/analytics/admin/summary?from=2026-10-25&to=2026-10-25',
      { headers: { Authorization: `Bearer ${key}` } },
    )
    expect(summary.status).toBe(200)
    expect((await summary.json()).totals.starts).toBe(1)
    expect(summary.headers.get('cache-control')).toBe('no-store')
  })
  it('rejects cross-site requests, invalid batches, dates, and content types', async () => {
    const { base } = await api()
    const post = (body: unknown, extra: Record<string, string> = {}) =>
      fetch(base + '/api/analytics/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...extra },
        body: JSON.stringify(body),
      })
    expect(
      (
        await post(
          { events: [makeEvent('page_view')] },
          { Origin: 'https://attacker.example' },
        )
      ).status,
    ).toBe(403)
    expect((await post({ events: [] })).status).toBe(400)
    expect(
      (
        await post({
          events: Array.from({ length: 21 }, () => makeEvent('page_view')),
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await post(
          { events: [makeEvent('page_view')] },
          { 'Content-Type': 'text/plain' },
        )
      ).status,
    ).toBe(415)
    expect(
      (
        await post({
          events: [makeEvent('page_view')],
          padding: 'x'.repeat(17000),
        })
      ).status,
    ).toBe(413)
    expect(
      (
        await fetch(
          base + '/api/analytics/admin/summary?from=bad&to=2026-10-25',
          { headers: { Authorization: `Bearer ${key}` } },
        )
      ).status,
    ).toBe(400)
  })
})
