import { REVEAL_MS, VOICE_TAIL_MS } from '../src/draftPacing'
import { startRoom } from './room-helpers'
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Dataset } from '../src/data'
import { eligibilityOf } from '../src/eligibility'
import { newGame, beginDraft, submitNominations } from '../src/engine'
import { npcAnnouncements } from '../src/announcements'
import { draftSpeech, speechKey } from '../src/draftSpeech'
import maleVoice from '../src/maleVoice2026.json' with { type: 'json' }

const dataset = JSON.parse(
  readFileSync(new URL('../src/npb2026.json', import.meta.url), 'utf8'),
) as Dataset
const facts = JSON.parse(
  readFileSync(new URL('../src/eligibility2026.json', import.meta.url), 'utf8'),
)
dataset.players = dataset.players.map((p) => ({
  ...p,
  draftFacts: facts.players[p.id],
}))
test('sound starts silent, produces real Web Audio after opt-in, saves separate toggles and mutes on hiding', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 667 })
  await page.addInitScript(() => {
    sessionStorage.setItem('geneki-draft:welcome:v1', 'seen')
    const Native = window.AudioContext
    const contexts: { context: AudioContext; meter: AnalyserNode }[] = []
    const durations: number[] = []
    Object.assign(window, { __sourceDurations: durations })
    Object.assign(window, { __audioProbe: contexts })
    window.AudioContext = class extends Native {
      createBufferSource() {
        const source = super.createBufferSource()
        const start = source.start.bind(source)
        source.start = (when = 0, offset = 0) => {
          durations.push(source.buffer?.duration ?? 0)
          start(when, offset)
        }
        return source
      }
      constructor() {
        super()
        const meter = this.createAnalyser()
        meter.connect(this.destination)
        Object.defineProperty(this, 'destination', { get: () => meter })
        contexts.push({ context: this, meter })
      }
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'サウンド設定', exact: true }).click()
  const settings = page.locator('.sound-settings')
  const master = settings
    .getByRole('checkbox', { name: 'サウンド', exact: false })
    .first()
  await expect(master).not.toBeChecked()
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __audioProbe: unknown[] }).__audioProbe.length,
    ),
  ).toBe(0)
  await master.check()
  await page.screenshot({ path: '.cache/sound-settings-mobile.png' })
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { meter } = (
          window as unknown as { __audioProbe: { meter: AnalyserNode }[] }
        ).__audioProbe[0]
        const samples = new Float32Array(meter.fftSize)
        meter.getFloatTimeDomainData(samples)
        return Math.max(...samples.map(Math.abs))
      }),
    )
    .toBeGreaterThan(0.00001)
  await settings.getByRole('checkbox', { name: /^BGM/ }).uncheck()
  await settings.getByRole('button', { name: '効果音を試す' }).click()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { meter } = (
          window as unknown as { __audioProbe: { meter: AnalyserNode }[] }
        ).__audioProbe[0]
        const samples = new Float32Array(meter.fftSize)
        meter.getFloatTimeDomainData(samples)
        return Math.max(...samples.map(Math.abs))
      }),
    )
    .toBeGreaterThan(0.025)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { context, meter } = (
          window as unknown as {
            __audioProbe: { context: AudioContext; meter: AnalyserNode }[]
          }
        ).__audioProbe[0]
        const bins = new Float32Array(meter.frequencyBinCount)
        meter.getFloatFrequencyData(bins)
        let bass = 0,
          high = 0
        for (let i = 0; i < bins.length; i++) {
          const frequency = (i * context.sampleRate) / meter.fftSize
          const power = 10 ** (bins[i] / 10)
          if (frequency < 500) bass += power
          if (frequency > 1500) high += power
        }
        return bass / Math.max(high, 1e-12)
      }),
    )
    .toBeGreaterThan(20)
  await settings.getByRole('button', { name: '読み上げを試す' }).click()
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __sourceDurations: number[] }
        ).__sourceDurations.some((duration) => duration > 1.3),
      ),
    )
    .toBe(true)
  await settings.getByRole('checkbox', { name: /^効果音/ }).uncheck()
  await page.locator('.modal').getByRole('button', { name: '閉じる' }).click()
  await page.reload()
  await page.getByRole('button', { name: 'サウンド設定', exact: true }).click()
  await expect(master).toBeChecked()
  await expect(
    settings.getByRole('checkbox', { name: /^効果音/ }),
  ).not.toBeChecked()
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __audioProbe: { context: AudioContext }[] })
            .__audioProbe[0].context.state,
      ),
    )
    .toBe('suspended')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await master.uncheck()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __audioProbe: { context: AudioContext }[] })
            .__audioProbe[0].context.state,
      ),
    )
    .toBe('suspended')
})

test('natural male speech uses clear pauses without overlapping or advancing early', async ({
  page,
}) => {
  const players = dataset.players
  let game = newGame('t', 1)
  let sequence = npcAnnouncements(game, players, true)
  for (let seed = 1; seed <= 100; seed++) {
    game = submitNominations(
      newGame('t', seed),
      players
        .filter((p) => p.team === 't' && eligibilityOf(p).band === 'ordinary')
        .slice(0, 2)
        .map((p) => p.id),
      players,
    )
    game = beginDraft(game, game.offers.g![0], players)
    sequence = npcAnnouncements(game, players, true)
    if (sequence.length >= 3) break
  }
  expect(sequence.length).toBeGreaterThanOrEqual(3)
  await page.addInitScript(
    (save) => {
      sessionStorage.setItem('geneki-draft:welcome:v1', 'seen')
      localStorage.setItem('geneki-draft-room:v2', JSON.stringify(save))
      localStorage.setItem(
        'geneki-draft:sound:v1',
        JSON.stringify({
          enabled: true,
          bgm: false,
          effects: false,
          narration: true,
        }),
      )
      // Control the audio clock while still fetching each real MP3. Production
      // decode/playback is independently exercised by the real audio test above.
      const Native = window.AudioContext
      type Source = {
        buffer: AudioBuffer | null
        onended: (() => void) | null
        connect: () => void
        disconnect: () => void
        start: () => void
        stop: () => void
      }
      const probe = {
        current: null as Source | null,
        paths: [] as string[],
        played: [] as string[],
        overlaps: 0,
        finish: () => {},
      }
      probe.finish = () => {
        const source = probe.current
        probe.current = null
        source?.onended?.()
      }
      Object.assign(window, { __voiceProbe: probe })
      const originalFetch = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const path = String(input)
        if (path.startsWith('/audio/voice-male-')) probe.paths.push(path)
        return originalFetch(input, init).then((response) => {
          if (path.startsWith('/audio/voice-male-')) {
            const read = response.arrayBuffer.bind(response)
            response.arrayBuffer = async () => {
              const buffer = await read()
              Object.assign(buffer, { clipPath: path })
              return buffer
            }
          }
          return response
        })
      }
      window.AudioContext = class extends Native {
        async decodeAudioData(data: ArrayBuffer) {
          const buffer = this.createBuffer(1, this.sampleRate, this.sampleRate)
          Object.assign(buffer, {
            clipPath: (data as ArrayBuffer & { clipPath?: string }).clipPath,
          })
          return buffer
        }
        createBufferSource() {
          const source: Source = {
            buffer: null,
            onended: null,
            connect: () => {},
            disconnect: () => {},
            start: () => {
              if (probe.current) probe.overlaps++
              probe.current = source
              probe.played.push(
                (source.buffer as AudioBuffer & { clipPath?: string })
                  ?.clipPath ?? '',
              )
            },
            stop: () => {
              if (probe.current === source) probe.current = null
            },
          }
          return source as unknown as AudioBufferSourceNode
        }
      }
      Object.defineProperty(window, 'speechSynthesis', { value: undefined })
    },
    { game, dataset, chosenTeam: 't' },
  )
  await page.clock.install({ time: new Date('2026-10-24T09:00:00Z') })
  await page.clock.pauseAt(new Date('2026-10-24T09:01:00Z'))
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/')
  const dialog = page.locator('.draft-announcement')
  await dialog.getByRole('button', { name: 'サウンドのオン・オフ' }).click()
  await page.clock.runFor(REVEAL_MS)
  const active = () =>
    page.evaluate(() =>
      Boolean(
        (window as unknown as { __voiceProbe: { current: unknown } })
          .__voiceProbe.current,
      ),
    )
  await expect.poll(active).toBe(true)
  await expect(dialog).toContainText('読み上げ中')
  await page.clock.runFor(4000)
  const pick = sequence[0].game.picks.at(-1)!
  await expect(dialog.locator('.announcement-name')).toHaveText(
    players.find((p) => p.id === pick.playerId)!.name,
  )
  const script = draftSpeech(sequence[0], players)
  for (let i = 0; i < script.length; i++) {
    const paths = await page.evaluate(
      () =>
        (window as unknown as { __voiceProbe: { played: string[] } })
          .__voiceProbe.played,
    )
    expect(paths.at(-1)).toBe(
      (maleVoice.clips as Record<string, string>)[speechKey(script[i])],
    )
    await page.evaluate(() =>
      (
        window as unknown as { __voiceProbe: { finish: () => void } }
      ).__voiceProbe.finish(),
    )
    if (i === 0) {
      await page.clock.runFor(700)
      expect(await active()).toBe(false)
      await page.clock.runFor(420)
    } else if (i === 1) {
      await page.clock.runFor(400)
      expect(await active()).toBe(false)
      await page.clock.runFor(420)
    } else await page.clock.runFor(script[i].pauseAfterMs + 20)
    if (i + 1 < script.length) await expect.poll(active).toBe(true)
  }
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __voiceProbe: { overlaps: number } })
          .__voiceProbe.overlaps,
    ),
  ).toBe(0)
  await expect(dialog).not.toContainText('読み上げ中')
  await page.clock.runFor(VOICE_TAIL_MS)
  await expect(dialog.locator('.announcement-name')).toHaveCount(0)
  await page.clock.runFor(REVEAL_MS)
  await expect.poll(active).toBe(true)
  await dialog.getByRole('button', { name: '次の指名発表へ' }).click()
  expect(await active()).toBe(false)
  await page.clock.runFor(REVEAL_MS)
  await expect.poll(active).toBe(true)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(await active()).toBe(false)
  await page.clock.runFor(10000)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(active).toBe(true)
  await dialog.getByRole('button', { name: 'サウンドのオン・オフ' }).click()
  expect(await active()).toBe(false)
  await dialog.getByRole('button', { name: /演出をスキップ/ }).click()
  expect(await active()).toBe(false)
})

test('unsupported audio explains the limitation and keeps gameplay usable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('geneki-draft:welcome:v1', 'seen')
    Object.defineProperty(window, 'AudioContext', { value: undefined })
    Object.defineProperty(window, 'speechSynthesis', { value: undefined })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: undefined,
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'サウンド設定', exact: true }).click()
  await expect(page.locator('.sound-settings')).toContainText(
    'この端末では読み上げ音声を再生できません',
  )
  await expect(
    page.getByRole('checkbox', { name: /^指名の読み上げ/ }),
  ).toBeDisabled()
  await page.locator('.modal').getByRole('button', { name: '閉じる' }).click()
  await startRoom(page)
  await expect(
    page.getByRole('heading', { name: /提出候補を選ぶ/ }),
  ).toBeVisible()
})
