import type { IncomingMessage, ServerResponse, Server } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { dirname, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { WebSocketServer, WebSocket } from 'ws'
import { RoomCore, RoomError, type StoredRoom } from './room-core'
import { socketToken } from '../cloudflare/rooms'

export function nodeRooms(server: Server, path: string, presentationScale = 1) {
  mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(path)
  db.exec(
    'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, state TEXT NOT NULL, expires INTEGER NOT NULL)',
  )
  db.prepare('DELETE FROM rooms WHERE expires < ?').run(Date.now())
  const active = new Map<
    string,
    {
      core: RoomCore
      sockets: Map<WebSocket, string>
      timer?: ReturnType<typeof setTimeout>
    }
  >()
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 8192,
    handleProtocols: (protocols) =>
      protocols.has('draft-room') ? 'draft-room' : false,
  })
  function get(code: string) {
    let room = active.get(code)
    if (room) return room
    room = { core: undefined as unknown as RoomCore, sockets: new Map() }
    const r = room
    r.core = new RoomCore(
      {
        load: async () => {
          const row = db
            .prepare('SELECT state FROM rooms WHERE code=?')
            .get(code) as { state: string } | undefined
          return row ? (JSON.parse(row.state) as StoredRoom) : null
        },
        save: async (state) => {
          db.prepare(
            'INSERT INTO rooms VALUES (?,?,?) ON CONFLICT(code) DO UPDATE SET state=excluded.state, expires=excluded.expires',
          ).run(code, JSON.stringify(state), state.expiresAt)
        },
        delete: async () => {
          db.prepare('DELETE FROM rooms WHERE code=?').run(code)
        },
      },
      {
        online: (id) =>
          [...r.sockets].some(
            ([s, member]) => member === id && s.readyState === WebSocket.OPEN,
          ),
        broadcast: () => {
          for (const [socket, id] of r.sockets)
            void r.core
              .view(id)
              .then((snapshot) => {
                if (socket.readyState === WebSocket.OPEN)
                  socket.send(JSON.stringify({ type: 'state', snapshot }))
              })
              .catch(() => socket.close(4001, '退出しました。'))
        },
        schedule: async (at) => {
          clearTimeout(r.timer)
          r.timer = setTimeout(
            () => {
              void r.core.alarm().catch(() => {})
            },
            Math.max(1, at - Date.now()),
          )
          r.timer.unref()
        },
        expired: () => {
          for (const s of r.sockets.keys())
            s.close(4004, 'ルームの有効期限が終了しました。')
          active.delete(code)
        },
      },
      Date.now,
      presentationScale,
    )
    active.set(code, r)
    return r
  }
  function json(res: ServerResponse, body: unknown, status = 200) {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(JSON.stringify(body))
  }
  function sameOrigin(req: IncomingMessage) {
    return (
      (!req.headers.origin ||
        req.headers.origin === 'http://' + req.headers.host ||
        req.headers.origin === 'https://' + req.headers.host) &&
      req.headers['sec-fetch-site'] !== 'cross-site'
    )
  }
  async function body(req: IncomingMessage) {
    if (!req.headers['content-type']?.startsWith('application/json'))
      throw new RoomError('JSONで送信してください。', 415)
    const buffers: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 8192) throw new RoomError('送信内容が大きすぎます。', 413)
      buffers.push(Buffer.from(chunk))
    }
    try {
      return JSON.parse(Buffer.concat(buffers).toString())
    } catch {
      throw new RoomError('送信内容を読み込めません。')
    }
  }
  const limits = new Map<string, { n: number; until: number }>()
  function limited(address: string) {
    const now = Date.now(),
      old = limits.get(address)
    if (old && old.until > now) return ++old.n > 40
    if (limits.size > 5000)
      for (const [k, v] of limits) if (v.until <= now) limits.delete(k)
    limits.set(address, { n: 1, until: now + 60_000 })
    return false
  }
  const handler = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> => {
    const path = new URL(req.url ?? '/', 'http://local').pathname
    if (!path.startsWith('/api/rooms')) return false
    try {
      if (!sameOrigin(req))
        throw new RoomError('別サイトから接続できません。', 403)
      if (path === '/api/rooms' && req.method === 'POST') {
        if (limited(req.socket.remoteAddress ?? 'local'))
          throw new RoomError('少し待ってからお試しください。', 429)
        const b = await body(req)
        for (let i = 0; i < 10; i++) {
          const code = (
            crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000
          )
            .toString()
            .padStart(6, '0')
          try {
            json(res, await get(code).core.init(code, b.name, b.team), 201)
            return true
          } catch (e) {
            if (!(e instanceof RoomError) || e.status !== 409) throw e
          }
        }
        throw new RoomError(
          '作成できませんでした。もう一度お試しください。',
          503,
        )
      }
      const match = /^\/api\/rooms\/(\d{6})(\/join|\/actions)?$/.exec(path)
      if (!match)
        throw new RoomError('6桁のルーム番号を確認してください。', 404)
      const core = get(match[1]).core,
        token = req.headers.authorization?.replace(/^Bearer /, '') ?? ''
      if (match[2] === '/join' && req.method === 'POST') {
        if (limited(req.socket.remoteAddress ?? 'local'))
          throw new RoomError('少し待ってからお試しください。', 429)
        json(res, await core.join((await body(req)).name), 201)
      } else if (match[2] === '/actions' && req.method === 'POST') {
        await core.command(token, await body(req))
        json(res, { ok: true })
      } else if (!match[2] && req.method === 'GET')
        json(res, await core.read(token))
      else throw new RoomError('該当する操作はありません。', 404)
    } catch (e) {
      json(
        res,
        {
          error:
            e instanceof RoomError
              ? e.message
              : '接続に失敗しました。時間をおいて再試行してください。',
        },
        e instanceof RoomError ? e.status : 503,
      )
    }
    return true
  }
  server.on('upgrade', (req, socket, head) => {
    const match = /^\/api\/rooms\/(\d{6})\/socket$/.exec(
      new URL(req.url ?? '/', 'http://local').pathname,
    )
    if (!match) return
    if (!sameOrigin(req)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    const r = get(match[1])
    void r.core
      .authenticate(socketToken(req.headers['sec-websocket-protocol'] ?? null))
      .then((id) => {
        if (r.sockets.size >= 36)
          throw new RoomError('接続数が多すぎます。', 429)
        wss.handleUpgrade(req, socket, head, (ws) => {
          r.sockets.set(ws, id)
          void r.core
            .presence(id, true)
            .then(() => r.core.view(id))
            .then((snapshot) =>
              ws.send(JSON.stringify({ type: 'state', snapshot })),
            )
          ws.on('message', (raw) => {
            let data: unknown
            try {
              data = JSON.parse(raw.toString())
            } catch {
              ws.send(
                JSON.stringify({
                  type: 'error',
                  error: '送信内容が不正です。',
                }),
              )
              return
            }
            if ((data as { type?: string }).type === 'ping') {
              ws.send(JSON.stringify({ type: 'pong' }))
              return
            }
            const commandId = (data as { id?: string }).id
            void r.core
              .socketCommand(id, data)
              .then(() =>
                ws.send(JSON.stringify({ type: 'ack', id: commandId })),
              )
              .catch((e) =>
                ws.send(
                  JSON.stringify({
                    type: 'error',
                    id: commandId,
                    error:
                      e instanceof RoomError
                        ? e.message
                        : '操作に失敗しました。',
                    status: e instanceof RoomError ? e.status : 400,
                  }),
                ),
              )
          })
          ws.on('error', () => ws.close())
          ws.once('close', () => {
            r.sockets.delete(ws)
            void r.core.presence(id, false).catch(() => {})
          })
        })
      })
      .catch(() =>
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'),
      )
  })
  // Re-arm persisted deadlines after a local server restart.
  for (const row of db.prepare('SELECT code FROM rooms').all() as {
    code: string
  }[])
    void get(row.code)
      .core.alarm()
      .catch(() => {})
  return {
    handler,
    close() {
      for (const r of active.values()) {
        clearTimeout(r.timer)
        for (const socket of r.sockets.keys()) socket.terminate()
      }
      wss.close()
      db.close()
    },
  }
}
