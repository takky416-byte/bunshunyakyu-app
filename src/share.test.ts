import { expect, it } from 'vitest'
import { referenceDataset } from './data'
import { restoreGame } from './engine'
import { APP_URL, SHARE_NOTICE, shareResult } from './share'
import legacy from '../e2e/fixtures/legacy-game-v2.json'

it('shares actual acquisitions, releases, and both rounds without technical or tracking identifiers', () => {
  const game = restoreGame(legacy.game, referenceDataset.players)
  const result = shareResult(game, referenceDataset)
  expect(result.picks).toHaveLength(game.picks.length)
  expect(result.acquired.length).toBeGreaterThanOrEqual(1)
  expect(result.released.length).toBeGreaterThanOrEqual(1)
  for (const p of result.picks) expect(result.text).toContain(p.player)
  expect(result.html.match(/<tr>/g)?.length).toBe(game.picks.length)
  expect(result.text).toContain(SHARE_NOTICE)
  expect(result.html).toContain(APP_URL)
  for (const internal of [
    'playerId',
    'visitorId',
    'trackedPlay',
    'varied-v1',
    'npb-',
  ])
    expect(result.text + result.html).not.toContain(internal)
})
it('escapes imported names in blog HTML and rejects sharing an unfinished game', () => {
  const game = restoreGame(legacy.game, referenceDataset.players)
  const dataset = {
    ...referenceDataset,
    label: '<script>test</script>',
    players: referenceDataset.players.map((p) => ({
      ...p,
      name: `<img src=x onerror="bad"> ${p.name}`,
    })),
  }
  const result = shareResult(game, dataset)
  expect(result.html).not.toContain('<img')
  expect(result.html).not.toContain('<script>')
  expect(result.html).toContain('&lt;img')
  expect(() => shareResult({ ...game, stage: 'vote' }, dataset)).toThrow(
    '終了後',
  )
})
