import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { parse } from 'jsonc-parser'
import { format } from 'prettier'
const operation = process.argv[2]
const path = resolve('wrangler.jsonc')
const errors = []
const configuration = parse(await readFile(path, 'utf8'), errors, {
  allowTrailingComma: true,
})
if (errors.length) throw new Error('wrangler.jsonc の形式を確認してください。')
const cli = resolve('node_modules/wrangler/bin/wrangler.js')
const environment = {
  ...process.env,
  XDG_CONFIG_HOME: resolve('.cache/wrangler-config'),
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_LOG_PATH: resolve('.cache/wrangler-logs'),
}
await mkdir(resolve('.cache/wrangler-config/.wrangler'), {
  recursive: true,
  mode: 0o700,
})
function command(args, input) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    env: environment,
    stdio: input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    ...(input ? { input } : {}),
  })
  if (r.error) throw r.error
  if (r.status !== 0) process.exit(r.status ?? 1)
}
if (operation === 'configure') {
  const id = process.argv[3]
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      id ?? '',
    )
  )
    throw new Error('D1データベースの実際のUUIDを引数に指定してください。')
  configuration.d1_databases[0].database_id = id
  await writeFile(
    path,
    await format(JSON.stringify(configuration), { parser: 'jsonc' }),
  )
  console.log('D1 database binding configured. No credentials were written.')
} else if (operation === 'local-key') {
  try {
    await writeFile(
      '.dev.vars',
      `ANALYTICS_ADMIN_KEY=${randomBytes(32).toString('hex')}\n`,
      { flag: 'wx', mode: 0o600 },
    )
    console.log(
      'Local management key saved to private .dev.vars. Its value is not printed.',
    )
  } catch (error) {
    if (error.code === 'EEXIST') console.log('Existing .dev.vars preserved.')
    else throw error
  }
} else if (operation === 'dev') {
  command(['dev', '--local', '--ip', '127.0.0.1', '--port', '8787'])
} else if (operation === 'migrate-local') {
  command(['d1', 'migrations', 'apply', 'geneki-draft-analytics', '--local'])
} else if (operation === 'check') {
  await mkdir('.cache/cloudflare-dry-run', { recursive: true })
  command(['deploy', '--dry-run', '--outdir', '.cache/cloudflare-dry-run'])
} else if (
  ['create-db', 'deploy', 'migrate', 'admin-key'].includes(operation)
) {
  if (
    operation !== 'create-db' &&
    configuration.d1_databases[0].database_id === 'SET_YOUR_D1_DATABASE_ID'
  )
    throw new Error(
      '先に実際のD1データベースを作成し、npm run cloudflare:configure -- <database-id> を実行してください。',
    )
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN)
    throw new Error(
      'CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN を安全な環境設定で指定してください。',
    )
  if (operation === 'create-db')
    command(['d1', 'create', 'geneki-draft-analytics'])
  if (operation === 'deploy') command(['deploy'])
  if (operation === 'migrate')
    command(['d1', 'migrations', 'apply', 'geneki-draft-analytics', '--remote'])
  if (operation === 'admin-key') {
    // Retain the generated production key privately for the owner; never log it.
    await mkdir('.local-data', { recursive: true, mode: 0o700 })
    const keyPath = '.local-data/cloudflare-admin.key'
    try {
      await writeFile(keyPath, randomBytes(32).toString('hex') + '\n', {
        flag: 'wx',
        mode: 0o600,
      })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    command(['secret', 'put', 'ANALYTICS_ADMIN_KEY'], await readFile(keyPath))
    console.log(
      'Management key uploaded; the local private copy is retained for the owner.',
    )
  }
} else throw new Error('Unknown operation')
