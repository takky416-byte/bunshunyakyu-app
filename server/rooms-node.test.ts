import { afterEach, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { on } from 'node:events'
import { WebSocket } from 'ws'
import { nodeRooms } from './rooms-node'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})
async function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'draft-room-api-'))
  const server: Server = createServer((req, res) => {
    void rooms.handler(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404)
        res.end()
      }
    })
  })
  const rooms = nodeRooms(server, join(path, 'rooms.sqlite'))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  const sockets: WebSocket[] = []
  cleanup.push(async () => {
    for (const socket of sockets) socket.terminate()
    rooms.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(path, { recursive: true, force: true })
  })
  return { base, sockets }
}
it('malformed JSON objects and binary frames cannot crash the room server or revoke a valid participant', async () => {
  const f = await fixture()
  for (const value of [null, [], true, 'text']) {
    const response = await fetch(f.base + '/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    })
    expect(response.status).toBe(400)
  }
  const created = await fetch(f.base + '/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '検証GM', team: 'd' }),
  })
  expect(created.status).toBe(201)
  const session = await created.json()
  const ws = new WebSocket(
    f.base.replace('http', 'ws') + '/api/rooms/' + session.code + '/socket',
    ['draft-room', 'session.' + session.token],
    { origin: f.base },
  )
  f.sockets.push(ws)
  const messages = on(ws, 'message')
  const next = async (type: string) => {
    for (let i = 0; i < 20; i++) {
      const { value } = await messages.next()
      const data = JSON.parse(String(value![0]))
      if (data.type === type) return data
    }
    throw new Error('Expected WebSocket message: ' + type)
  }
  await next('state')
  for (const value of [
    'null',
    '[]',
    '"text"',
    Buffer.from('{"type":"ping"}'),
  ]) {
    ws.send(value)
    expect((await next('error')).error).toBe('送信内容が不正です。')
    expect(ws.readyState).toBe(WebSocket.OPEN)
  }
  const response = await fetch(f.base + '/api/rooms/' + session.code, {
    headers: { Authorization: 'Bearer ' + session.token },
  })
  expect(response.status).toBe(200)
  expect((await response.json()).me).toBe(session.memberId)
  const id = crypto.randomUUID()
  ws.send(
    JSON.stringify({
      id,
      phase: 'lobby',
      action: { type: 'chat', text: '接続は有効です' },
    }),
  )
  expect((await next('ack')).id).toBe(id)
  await messages.return?.()
})
