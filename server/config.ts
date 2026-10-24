import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export function analyticsConfig(
  development = false,
  env: Record<string, string | undefined> = process.env,
) {
  const dbPath = resolve(
    env.ANALYTICS_DB_PATH ||
      `.local-data/analytics${development ? '-dev' : ''}.sqlite`,
  )
  const keyPath = resolve(
    env.ANALYTICS_ADMIN_KEY_FILE ||
      `.local-data/analytics${development ? '-dev' : ''}.key`,
  )
  let adminKey = env.ANALYTICS_ADMIN_KEY?.trim()
  if (!adminKey) {
    mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 })
    try {
      writeFileSync(keyPath, randomBytes(32).toString('hex') + '\n', {
        flag: 'wx',
        mode: 0o600,
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    adminKey = readFileSync(keyPath, 'utf8').trim()
  }
  if (adminKey.length < 24)
    throw new Error('管理キーは24文字以上で設定してください。')
  return { dbPath, adminKey }
}
