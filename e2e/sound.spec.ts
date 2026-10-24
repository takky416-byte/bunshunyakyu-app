import { test, expect, type Page } from '@playwright/test'
import { referenceDataset } from '../src/data'
import { newGame, beginDraft, submitNominations } from '../src/engine'
import { npcAnnouncements } from '../src/announcements'

async function speechBrowser(page: Page, available = true) {
  await page.addInitScript((available) => {
    type Utterance = { text: string; onend?: () => void }
    const probe = {
      spoken: [] as string[],
      cancelled: 0,
      current: null as Utterance | null,
      finish: () => {},
    }
    probe.finish = () => {
      const current = probe.current
      probe.current = null
      current?.onend?.()
    }
    Object.assign(window, { __speechProbe: probe })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: class {
        constructor(public text: string) {}
      },
    })
    const synth = new EventTarget()
    Object.assign(synth, {
      getVoices: () =>
        available ? [{ lang: 'ja-JP', localService: true }] : [],
      speak: (utterance: Utterance) => {
        if (utterance.text.trim()) {
          probe.spoken.push(utterance.text)
          probe.current = utterance
        }
      },
      cancel: () => {
        probe.cancelled++
        probe.current = null
      },
    })
    Object.defineProperty(window, 'speechSynthesis', { value: synth })
    sessionStorage.setItem('geneki-draft:welcome:v1', 'seen')
  }, available)
}
async function spoken(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __speechProbe: { spoken: string[] } })
        .__speechProbe.spoken,
  )
}

test('sound starts silent, produces real Web Audio after opt-in, saves separate toggles and mutes on hiding', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 667 })
  await page.addInitScript(() => {
    sessionStorage.setItem('geneki-draft:welcome:v1', 'seen')
    const Native = window.AudioContext
    const contexts: { context: AudioContext; meter: AnalyserNode }[] = []
    Object.assign(window, { __audioProbe: contexts })
    window.AudioContext = class extends Native {
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

test('spoken picks include position, hold autoplay until completion, and cancel immediately on manual next and mute', async ({
  page,
}) => {
  await speechBrowser(page)
  const players = referenceDataset.players
  const nominated = submitNominations(newGame('t', 1), ['t-1', 't-2'], players)
  const game = beginDraft(nominated, nominated.offers.g![0], players)
  const sequence = npcAnnouncements(game, players, true)
  expect(sequence.length).toBeGreaterThan(2)
  await page.addInitScript(
    (save) => {
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
    },
    { game, dataset: referenceDataset, chosenTeam: 't' },
  )
  await page.clock.install()
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/')
  const dialog = page.locator('.draft-announcement')
  await dialog.getByRole('button', { name: 'サウンドのオン・オフ' }).click()
  await page.clock.runFor(1900)
  await expect(dialog).toContainText('読み上げ中')
  const nextButton = (await dialog.locator('.button.primary').boundingBox())!
  expect(nextButton.y + nextButton.height).toBeLessThanOrEqual(568)
  expect(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true)
  await page.screenshot({ path: '.cache/spoken-announcement-mobile.png' })
  await page.clock.runFor(4000)
  const pick = sequence[0].game.picks.at(-1)!
  const player = players.find((p) => p.id === pick.playerId)!
  await expect(dialog.locator('.announcement-name')).toHaveText(player.name)
  const finishClause = async () => {
    await page.evaluate(() =>
      (
        window as unknown as { __speechProbe: { finish: () => void } }
      ).__speechProbe.finish(),
    )
    await page.clock.runFor(450)
  }
  await finishClause()
  expect((await spoken(page)).at(-1)).toBe(`${player.name}。`)
  await finishClause()
  expect((await spoken(page)).at(-1)).toBe(`${player.position}。`)
  await finishClause()
  expect((await spoken(page)).at(-1)).not.toContain(player.name)
  await finishClause()
  await page.clock.runFor(3600)
  await expect(dialog.locator('.announcement-name')).toHaveCount(0)
  await page.clock.runFor(1900)
  await expect(dialog).toContainText('読み上げ中')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __speechProbe: { current: unknown } })
          .__speechProbe.current,
    ),
  ).toBeNull()
  await page.clock.runFor(10000)
  await expect(dialog.locator('.announcement-name')).toHaveText(
    players.find((p) => p.id === sequence[1].game.picks.at(-1)!.playerId)!.name,
  )
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(dialog).toContainText('読み上げ中')
  await dialog.getByRole('button', { name: '次の指名発表へ' }).click()
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __speechProbe: { current: unknown } })
          .__speechProbe.current,
    ),
  ).toBeNull()
  await page.clock.runFor(1900)
  await expect(dialog).toContainText('読み上げ中')
  await dialog.getByRole('button', { name: 'サウンドのオン・オフ' }).click()
  await expect(dialog).not.toContainText('読み上げ中')
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __speechProbe: { current: unknown } })
          .__speechProbe.current,
    ),
  ).toBeNull()
  await dialog
    .getByRole('button', { name: /演出をスキップ/, exact: false })
    .click()
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __speechProbe: { current: unknown } })
          .__speechProbe.current,
    ),
  ).toBeNull()
})

test('missing Japanese voices explains the limitation and keeps gameplay usable', async ({
  page,
}) => {
  await speechBrowser(page, false)
  await page.goto('/')
  await page.getByRole('button', { name: 'サウンド設定', exact: true }).click()
  await expect(page.locator('.sound-settings')).toContainText(
    'この端末では日本語の読み上げ音声を利用できません',
  )
  await expect(
    page.getByRole('checkbox', { name: /^指名の読み上げ/ }),
  ).toBeDisabled()
  await page.locator('.modal').getByRole('button', { name: '閉じる' }).click()
  await page.getByRole('button', { name: 'この球団ではじめる' }).click()
  await expect(
    page.getByRole('heading', { name: /提出候補を選ぶ/ }),
  ).toBeVisible()
  expect(await spoken(page)).toEqual([])
})
