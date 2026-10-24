import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { analyticsPlugin } from './server/vite-analytics'

export default defineConfig({
  plugins: [react(), analyticsPlugin()],
  cacheDir: '.cache/vite',
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/.cache/**', '**/.local-data/**'] },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.endsWith('/npb2026.json')) return 'players-2026'
          if (id.endsWith('/playerCareer2026.json')) return 'player-career-2026'
          if (id.includes('/node_modules/')) return 'vendor'
        },
      },
    },
  },
  test: {
    include: [
      'src/**/*.test.ts',
      'server/**/*.test.ts',
      'cloudflare/**/*.test.ts',
    ],
  },
})
