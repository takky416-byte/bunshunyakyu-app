import type { Plugin } from 'vite'
import { loadEnv } from 'vite'
import { AnalyticsStore } from './store.ts'
import { analyticsHandler } from './api.ts'
import { analyticsConfig } from './config.ts'
import { nodeRooms } from './rooms-node'

export function analyticsPlugin(): Plugin {
  return {
    name: 'local-analytics-api',
    configureServer(server) {
      if (server.config.mode === 'test') return
      const env = {
        ...loadEnv(server.config.mode, server.config.root, [
          'ANALYTICS_',
          'ROOMS_',
        ]),
        ...process.env,
      }
      const config = analyticsConfig(true, env)
      const store = new AnalyticsStore(config.dbPath)
      store.prune()
      const api = analyticsHandler(store, config.adminKey)
      const rooms = server.httpServer
        ? nodeRooms(
            server.httpServer as import('node:http').Server,
            env.ROOMS_DB_PATH ?? '.local-data/rooms-dev.sqlite',
            env.ROOMS_TEST_FAST_PRESENTATIONS === 'true' ? 0.01 : 1,
          )
        : null
      server.middlewares.use((req, res, next) => {
        void (async () =>
          (await rooms?.handler(req, res)) || (await api(req, res)))()
          .then((handled) => {
            if (!handled) next()
          })
          .catch(next)
      })
      server.httpServer?.once('close', () => {
        rooms?.close()
        store.close()
      })
    },
  }
}
