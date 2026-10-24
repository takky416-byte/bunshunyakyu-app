import type { Plugin } from 'vite'
import { loadEnv } from 'vite'
import { AnalyticsStore } from './store.ts'
import { analyticsHandler } from './api.ts'
import { analyticsConfig } from './config.ts'

export function analyticsPlugin(): Plugin {
  return {
    name: 'local-analytics-api',
    configureServer(server) {
      if (server.config.mode === 'test') return
      const env = {
        ...loadEnv(server.config.mode, server.config.root, 'ANALYTICS_'),
        ...process.env,
      }
      const config = analyticsConfig(true, env)
      const store = new AnalyticsStore(config.dbPath)
      store.prune()
      const api = analyticsHandler(store, config.adminKey)
      server.middlewares.use((req, res, next) => {
        void api(req, res)
          .then((handled) => {
            if (!handled) next()
          })
          .catch(next)
      })
      server.httpServer?.once('close', () => store.close())
    },
  }
}
