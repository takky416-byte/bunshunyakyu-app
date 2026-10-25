import { RoomCore, RoomError, type StoredRoom } from '../server/room-core'

interface RoomSocket extends WebSocket {
  serializeAttachment(value: unknown): void
  deserializeAttachment(): { memberId: string }
}
interface DurableContext {
  storage: {
    get<T>(key: string): Promise<T | undefined>
    put(key: string, value: unknown): Promise<void>
    deleteAll(): Promise<void>
    setAlarm(at: number): Promise<void>
  }
  acceptWebSocket(socket: WebSocket): void
  getWebSockets(): RoomSocket[]
  waitUntil(promise: Promise<unknown>): void
}
interface RoomStub {
  fetch(request: Request): Promise<Response>
}
export interface RoomNamespace {
  idFromName(name: string): unknown
  get(id: unknown): RoomStub
}
declare const WebSocketPair: { new (): { 0: RoomSocket; 1: RoomSocket } }
export const roomJson = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
export const roomFailure = (error: unknown) =>
  roomJson(
    {
      error:
        error instanceof RoomError
          ? error.message
          : 'ルームに接続できません。しばらく待って再試行してください。',
    },
    error instanceof RoomError ? error.status : 503,
  )
export async function roomBody(request: Request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    throw new RoomError('JSONで送信してください。', 415)
  const reader = request.body?.getReader()
  if (!reader) throw new RoomError('本文が必要です。')
  let size = 0
  const chunks: Uint8Array[] = []
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 8192) {
      await reader.cancel()
      throw new RoomError('送信内容が大きすぎます。', 413)
    }
    chunks.push(value)
  }
  try {
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    const value = JSON.parse(new TextDecoder().decode(bytes))
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error()
    return value
  } catch {
    throw new RoomError('送信内容を読み込めません。')
  }
}
export const socketToken = (header: string | null) =>
  header
    ?.split(',')
    .map((x) => x.trim())
    .find((x) => x.startsWith('session.'))
    ?.slice(8) ?? ''

// One SQLite-backed Durable Object per six-digit room. WebSocket hibernation
// keeps idle rooms off the CPU; alarms advance timed stages without a host tab.
export class DraftRoom {
  private core: RoomCore
  constructor(private ctx: DurableContext) {
    this.core = new RoomCore(
      {
        load: async () => (await ctx.storage.get<StoredRoom>('room')) ?? null,
        save: (state) => ctx.storage.put('room', state),
        delete: () => ctx.storage.deleteAll(),
      },
      {
        online: (id) =>
          ctx
            .getWebSockets()
            .some(
              (s) =>
                s.deserializeAttachment()?.memberId === id &&
                s.readyState === 1,
            ),
        broadcast: () => ctx.waitUntil(this.broadcast()),
        schedule: (at) => ctx.storage.setAlarm(at),
        expired: () => {
          for (const s of ctx.getWebSockets())
            s.close(4004, 'ルームの有効期限が終了しました。')
        },
      },
    )
  }
  private async broadcast() {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(
          JSON.stringify({
            type: 'state',
            snapshot: await this.core.view(
              socket.deserializeAttachment().memberId,
            ),
          }),
        )
      } catch (error) {
        const code =
          error instanceof RoomError && error.status === 401
            ? 4001
            : error instanceof RoomError && error.status === 404
              ? 4004
              : 1011
        socket.close(
          code,
          code === 4001
            ? '退出しました。'
            : code === 4004
              ? 'ルームの有効期限が終了しました。'
              : '接続を再確認してください。',
        )
      }
    }
  }
  async fetch(request: Request) {
    try {
      const path = new URL(request.url).pathname
      if (path.endsWith('/init') && request.method === 'POST') {
        const b = await roomBody(request)
        return roomJson(await this.core.init(b.code, b.name, b.team), 201)
      }
      if (path.endsWith('/join') && request.method === 'POST')
        return roomJson(
          await this.core.join((await roomBody(request)).name),
          201,
        )
      if (
        path.endsWith('/socket') &&
        request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
      ) {
        const memberId = await this.core.authenticate(
          socketToken(request.headers.get('Sec-WebSocket-Protocol')),
        )
        if (this.ctx.getWebSockets().length >= 36)
          throw new RoomError(
            '接続数が多すぎます。不要なタブを閉じてください。',
            429,
          )
        const pair = new WebSocketPair(),
          socket = pair[1]
        socket.serializeAttachment({ memberId })
        this.ctx.acceptWebSocket(socket)
        await this.core.presence(memberId, true)
        socket.send(
          JSON.stringify({
            type: 'state',
            snapshot: await this.core.view(memberId),
          }),
        )
        return new Response(null, {
          status: 101,
          webSocket: pair[0],
          headers: { 'Sec-WebSocket-Protocol': 'draft-room' },
        } as ResponseInit)
      }
      const token =
        request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''
      if (path.endsWith('/actions') && request.method === 'POST') {
        await this.core.command(token, await roomBody(request))
        return roomJson({ ok: true })
      }
      if (request.method === 'GET') return roomJson(await this.core.read(token))
      return roomJson({ error: '該当する操作はありません。' }, 404)
    } catch (error) {
      return roomFailure(error)
    }
  }
  async webSocketMessage(socket: RoomSocket, message: string | ArrayBuffer) {
    let id: string | undefined
    try {
      if (typeof message !== 'string' || message.length > 8192)
        throw new RoomError('送信内容が大きすぎます。', 413)
      const data = JSON.parse(message)
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new RoomError('送信内容が不正です。')
      id = typeof data.id === 'string' ? data.id : undefined
      if (data.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }))
        return
      }
      await this.core.socketCommand(
        socket.deserializeAttachment().memberId,
        data,
      )
      socket.send(JSON.stringify({ type: 'ack', id }))
    } catch (error) {
      socket.send(
        JSON.stringify({
          type: 'error',
          id,
          error:
            error instanceof RoomError ? error.message : '操作に失敗しました。',
          status: error instanceof RoomError ? error.status : 400,
        }),
      )
    }
  }
  async webSocketClose(socket: RoomSocket, code: number) {
    socket.close([1005, 1006, 1015].includes(code) || code < 1000 ? 1000 : code)
    try {
      await this.core.presence(socket.deserializeAttachment().memberId, false)
    } catch (error) {
      if (!(error instanceof RoomError) || ![401, 404].includes(error.status))
        throw error
    }
  }
  async webSocketError(socket: RoomSocket) {
    await this.webSocketClose(socket, 1011)
  }
  async alarm() {
    await this.core.alarm()
  }
}

export async function routeRoomRequest(
  request: Request,
  rooms: RoomNamespace,
): Promise<Response> {
  const url = new URL(request.url)
  try {
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const b = await roomBody(request)
      for (let attempt = 0; attempt < 10; attempt++) {
        const code = (crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000)
          .toString()
          .padStart(6, '0')
        const response = await rooms.get(rooms.idFromName(code)).fetch(
          new Request(url.origin + '/init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, name: b.name, team: b.team }),
          }),
        )
        if (response.status !== 409) return response
      }
      return roomJson(
        { error: 'ルームを作成できませんでした。もう一度お試しください。' },
        503,
      )
    }
    const match = /^\/api\/rooms\/(\d{6})(\/join|\/socket|\/actions)?$/.exec(
      url.pathname,
    )
    if (!match)
      return roomJson({ error: '6桁のルーム番号を確認してください。' }, 404)
    return rooms.get(rooms.idFromName(match[1])).fetch(request)
  } catch (error) {
    return roomFailure(error)
  }
}
