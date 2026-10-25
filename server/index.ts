import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import { analyticsConfig } from './config.ts'
import { analyticsHandler } from './api.ts'
import { AnalyticsStore } from './store.ts'
import { nodeRooms } from './rooms-node.ts'

const root = resolve('dist')
if (!existsSync(resolve(root, 'index.html')))
  throw new Error('先に npm run build を実行してください。')
const config = analyticsConfig()
const store = new AnalyticsStore(config.dbPath)
store.prune()
const api = analyticsHandler(store, config.adminKey)
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}
const server = createServer(async (req, res) => {
  try {
    if (await rooms.handler(req, res)) return
    if (await api(req, res)) return
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' })
      res.end()
      return
    }
    const pathname = decodeURIComponent(
      new URL(req.url || '/', 'http://internal').pathname,
    )
    let file = resolve(root, '.' + pathname)
    if (pathname === '/' || pathname === '/admin' || pathname === '/admin/')
      file = resolve(root, 'index.html')
    if (!file.startsWith(root + sep)) {
      res.writeHead(404)
      res.end()
      return
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, {
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'Cache-Control': pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    })
    if (req.method === 'HEAD') res.end()
    else
      createReadStream(file)
        .on('error', () => res.destroy())
        .pipe(res)
  } catch {
    if (!res.headersSent) res.writeHead(500)
    res.end('サーバーでエラーが発生しました。')
  }
})
const rooms = nodeRooms(
  server,
  process.env.ROOMS_DB_PATH || '.local-data/rooms.sqlite',
)
const port = Number(process.env.PORT || 3001)
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORTが不正です。')
server.requestTimeout = 15_000
server.headersTimeout = 10_000
server.listen(port, '0.0.0.0', () =>
  console.log(`Application and analytics server listening on port ${port}`),
)
const pruneTimer = setInterval(() => {
  try {
    store.prune()
  } catch {
    console.error(
      'Analytics retention cleanup failed; check persistent storage.',
    )
  }
}, 3_600_000)
pruneTimer.unref()
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    clearInterval(pruneTimer)
    rooms.close()
    server.close(() => {
      store.close()
      process.exit(0)
    })
  })
