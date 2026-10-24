import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { AnalyticsStore, parseEvent } from './store.ts'
import { shiftDate, tokyoDate } from '../src/analytics-contract.ts'

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}
function keyMatches(input: string, expected: string) {
  return timingSafeEqual(
    createHash('sha256').update(input).digest(),
    createHash('sha256').update(expected).digest(),
  )
}
export function analyticsHandler(
  store: AnalyticsStore,
  adminKey: string,
  clock: () => Date = () => new Date(),
) {
  // Transient memory only: neither addresses nor user-agent strings enter SQLite.
  const limits = new Map<string, { count: number; reset: number }>()
  function allowed(key: string, max: number) {
    const time = clock().getTime()
    const bucket = limits.get(key)
    if (!bucket || bucket.reset <= time) {
      if (limits.size >= 5000) {
        for (const [k, b] of limits) if (b.reset <= time) limits.delete(k)
        if (limits.size >= 5000) return false
      }
      limits.set(key, { count: 1, reset: time + 60_000 })
      return true
    }
    return ++bucket.count <= max
  }
  return async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const url = new URL(req.url || '/', 'http://internal')
    if (!url.pathname.startsWith('/api/analytics/')) return false
    const origin = req.headers.origin
    if (
      (origin &&
        (() => {
          try {
            return new URL(origin).host !== req.headers.host
          } catch {
            return true
          }
        })()) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    ) {
      json(res, 403, {
        error: '別サイトからのリクエストは許可されていません。',
      })
      return true
    }
    const address = req.socket.remoteAddress || 'unknown'
    if (url.pathname === '/api/analytics/health' && req.method === 'GET') {
      json(res, 200, { status: 'ok' })
      return true
    }
    if (
      url.pathname === '/api/analytics/admin/summary' &&
      req.method === 'GET'
    ) {
      const authorization = req.headers.authorization || ''
      if (
        !keyMatches(
          authorization.startsWith('Bearer ') ? authorization.slice(7) : '',
          adminKey,
        )
      ) {
        if (!allowed(`auth:${address}`, 10))
          json(res, 429, { error: 'しばらく待ってからログインしてください。' })
        else json(res, 401, { error: '管理キーを確認してください。' })
        return true
      }
      try {
        const now = clock()
        const today = tokyoDate(now)
        const from = url.searchParams.get('from') ?? shiftDate(today, -29)
        const to = url.searchParams.get('to') ?? today
        json(res, 200, store.report(from, to, now))
      } catch (error) {
        json(res, 400, {
          error:
            error instanceof Error
              ? error.message
              : '集計期間を確認してください。',
        })
      }
      return true
    }
    if (url.pathname === '/api/analytics/events' && req.method === 'POST') {
      if (!allowed(`events:${address}`, 300)) {
        json(res, 429, { error: 'リクエストが多すぎます。' })
        return true
      }
      if (
        !String(req.headers['content-type'])
          .toLowerCase()
          .startsWith('application/json')
      ) {
        json(res, 415, { error: 'JSONで送信してください。' })
        return true
      }
      try {
        let size = 0
        const chunks: Buffer[] = []
        for await (const raw of req) {
          const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
          size += chunk.length
          if (size > 16_384) {
            json(res, 413, { error: '送信データが大きすぎます。' })
            req.resume()
            return true
          }
          chunks.push(chunk)
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (
          !Array.isArray(body?.events) ||
          body.events.length < 1 ||
          body.events.length > 20
        )
          throw new Error('イベントは1〜20件で送信してください。')
        const events = body.events.map(parseEvent)
        store.record(events, clock())
        res.writeHead(204, { 'Cache-Control': 'no-store' })
        res.end()
      } catch (error) {
        json(res, 400, {
          error:
            error instanceof Error
              ? error.message
              : 'イベントを読み込めませんでした。',
        })
      }
      return true
    }
    json(res, 404, { error: '該当するAPIはありません。' })
    return true
  }
}
