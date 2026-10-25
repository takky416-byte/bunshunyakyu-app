import { parseEvent, validateRange } from '../server/analytics-core'
import { shiftDate, tokyoDate } from '../src/analytics-contract'
import { D1Store, type Database } from './d1-store'
import { routeRoomRequest, type RoomNamespace } from './rooms'
export { DraftRoom } from './rooms'

interface Env {
  DB: Database
  ASSETS: { fetch(request: Request): Promise<Response> }
  ANALYTICS_ADMIN_KEY?: string
  ROOMS?: RoomNamespace
}
const buckets = new Map<string, { count: number; reset: number }>()
function limited(key: string, max: number) {
  const time = Date.now(),
    old = buckets.get(key)
  if (old && old.reset > time) return ++old.count > max
  if (buckets.size >= 5000) {
    for (const [k, b] of buckets) if (b.reset <= time) buckets.delete(k)
    if (buckets.size >= 5000) return true
  }
  buckets.set(key, { count: 1, reset: time + 60_000 })
  return false
}
function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
async function authorized(header: string | null, key: string) {
  const value = header?.startsWith('Bearer ') ? header.slice(7) : ''
  const digest = async (s: string) =>
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)),
    )
  const [a, b] = await Promise.all([digest(value), digest(key)])
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i]
  return difference === 0
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    const origin = request.headers.get('Origin')
    if (
      (origin && origin !== url.origin) ||
      request.headers.get('Sec-Fetch-Site') === 'cross-site'
    )
      return json(
        { error: '別サイトからのリクエストは許可されていません。' },
        403,
      )
    const store = new D1Store(env.DB)
    const address = request.headers.get('CF-Connecting-IP') || 'local'
    if (url.pathname.startsWith('/api/rooms')) {
      if (limited('rooms:' + address, 180))
        return json({ error: '少し待ってから再接続してください。' }, 429)
      if (
        request.method === 'POST' &&
        !url.pathname.endsWith('/actions') &&
        limited('room-entry:' + address, 30)
      )
        return json(
          { error: 'ルームの作成・参加が多すぎます。少し待ってください。' },
          429,
        )
      if (!env.ROOMS) return json({ error: 'ルーム機能を準備中です。' }, 503)
      return routeRoomRequest(request, env.ROOMS)
    }
    if (url.pathname === '/api/analytics/health' && request.method === 'GET') {
      try {
        await env.DB.prepare('SELECT 1 FROM events LIMIT 1').first()
        return json({ status: 'ok' })
      } catch {
        return json({ error: 'データベースの初期化が必要です。' }, 503)
      }
    }
    if (
      url.pathname === '/api/analytics/admin/summary' &&
      request.method === 'GET'
    ) {
      if (!env.ANALYTICS_ADMIN_KEY || env.ANALYTICS_ADMIN_KEY.length < 24)
        return json({ error: '管理キーをサーバー側に設定してください。' }, 503)
      if (
        !(await authorized(
          request.headers.get('Authorization'),
          env.ANALYTICS_ADMIN_KEY,
        ))
      ) {
        const tooMany = limited('auth:' + address, 10)
        return json(
          {
            error: tooMany
              ? 'しばらく待ってからログインしてください。'
              : '管理キーを確認してください。',
          },
          tooMany ? 429 : 401,
        )
      }
      const today = tokyoDate()
      const from = url.searchParams.get('from') ?? shiftDate(today, -29),
        to = url.searchParams.get('to') ?? today
      try {
        validateRange(from, to)
      } catch {
        return json(
          { error: '期間は直近180日以内の有効な日付で指定してください。' },
          400,
        )
      }
      try {
        return json(await store.report(from, to))
      } catch {
        return json(
          {
            error:
              '集計を取得できません。データベースの初期化と無料枠の使用状況を確認してください。',
          },
          503,
        )
      }
    }
    if (url.pathname === '/api/analytics/events' && request.method === 'POST') {
      if (limited('events:' + address, 300))
        return json({ error: 'リクエストが多すぎます。' }, 429)
      if (
        !request.headers
          .get('Content-Type')
          ?.toLowerCase()
          .startsWith('application/json')
      )
        return json({ error: 'JSONで送信してください。' }, 415)
      try {
        const reader = request.body?.getReader()
        if (!reader) return json({ error: '本文が必要です。' }, 400)
        const chunks: Uint8Array[] = []
        let length = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          length += value.length
          if (length > 16384) {
            await reader.cancel()
            return json({ error: '送信データが大きすぎます。' }, 413)
          }
          chunks.push(value)
        }
        const bytes = new Uint8Array(length)
        let offset = 0
        for (const c of chunks) {
          bytes.set(c, offset)
          offset += c.length
        }
        const body = JSON.parse(new TextDecoder().decode(bytes))
        if (
          !Array.isArray(body?.events) ||
          body.events.length < 1 ||
          body.events.length > 20
        )
          return json({ error: 'イベントは1〜20件で送信してください。' }, 400)
        let events
        try {
          events = body.events.map(parseEvent)
        } catch {
          return json({ error: 'イベントの形式が不正です。' }, 400)
        }
        try {
          await store.record(events)
        } catch {
          return json(
            { error: '記録サービスが利用できません。時間をおいて再送します。' },
            503,
          )
        }
        return new Response(null, {
          status: 204,
          headers: { 'Cache-Control': 'no-store' },
        })
      } catch {
        return json({ error: 'JSONを読み込めませんでした。' }, 400)
      }
    }
    return json({ error: '該当するAPIはありません。' }, 404)
  },
  async scheduled(
    _event: unknown,
    env: Env,
    context: { waitUntil(promise: Promise<unknown>): void },
  ) {
    context.waitUntil(new D1Store(env.DB).prune())
  },
}
