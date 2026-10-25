import { legacyStart } from './legacy-helper'
import { test, expect } from './fixtures'
import { referenceDataset } from '../src/data'
import { beginDraft, newGame, submitNominations } from '../src/engine'

// Measure before clicking: Playwright's automatic scrolling must not hide a
// next-action placement regression.
async function inViewport(
  page: import('@playwright/test').Page,
  locator: import('@playwright/test').Locator,
) {
  await expect(locator).toBeVisible()
  const b = (await locator.boundingBox())!
  expect(b.y).toBeGreaterThanOrEqual(0)
  expect(b.y + b.height).toBeLessThanOrEqual(page.viewportSize()!.height)
}

test('candidate and voting actions stay in view without scrolling the page', async ({
  page,
}) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 667 },
    { width: 768, height: 640 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await page.evaluate(() => localStorage.removeItem('geneki-draft-room:v2'))
    await page.reload()
    await legacyStart(page)
    await expect(page.locator('.flow-target')).toBeFocused()
    await inViewport(page, page.getByRole('button', { name: '候補を提出する' }))
    await page.getByRole('checkbox').nth(0).check()
    await page.getByRole('checkbox').nth(1).check()
    await inViewport(page, page.getByRole('button', { name: '候補を提出する' }))
    await page.getByRole('button', { name: '候補を提出する' }).click()
    await expect(page.locator('.flow-target')).toBeFocused()
    await inViewport(
      page,
      page.getByRole('button', { name: '投票してドラフトへ' }),
    )
    await page.getByRole('radio').first().check()
    await inViewport(
      page,
      page.getByRole('button', { name: '投票してドラフトへ' }),
    )
    await page.screenshot({ path: `.cache/next-action-${viewport.width}.png` })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  }
})

test('club labels never overlap vote bars and desktop navigation stays on one line', async ({
  page,
}) => {
  const players = referenceDataset.players
  const nominated = submitNominations(newGame('t', 9), ['t-1', 't-2'], players)
  const game = beginDraft(nominated, nominated.offers.g![0], players)
  await page.addInitScript(
    ({ game, dataset }) =>
      localStorage.setItem(
        'geneki-draft-room:v2',
        JSON.stringify({ game, dataset, chosenTeam: 't' }),
      ),
    { game, dataset: referenceDataset },
  )
  for (const width of [768, 980, 1024, 1199, 1200, 1280, 1440, 1500, 1920]) {
    await page.setViewportSize({ width, height: 720 })
    await page.goto('/')
    await expect(page.locator('.vote-row')).toHaveCount(12)
    const overlaps = await page.locator('.vote-row').evaluateAll(
      (rows) =>
        rows.filter((row) => {
          const name = row.firstElementChild!
          const range = document.createRange()
          range.selectNodeContents(name)
          return (
            range.getBoundingClientRect().right >
            row.querySelector('.vote-bar')!.getBoundingClientRect().left
          )
        }).length,
    )
    expect(overlaps, `vote labels at ${width}`).toBe(0)
    const navLines = await page
      .locator('.sidebar .nav-item')
      .first()
      .evaluate((button) => {
        const text = Array.from(button.childNodes).find(
          (node) =>
            node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        )!
        const range = document.createRange()
        range.selectNodeContents(text)
        return range.getClientRects().length
      })
    expect(navLines, `navigation at ${width}`).toBe(1)
    for (const selector of ['.single-label-title', '.single-label small']) {
      const metrics = await page.locator(selector).evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        const rects: DOMRect[] = []
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent?.trim()) continue
          const range = document.createRange()
          range.selectNodeContents(walker.currentNode)
          rects.push(...range.getClientRects())
        }
        const parent = el.closest('.single-label-copy')!.getBoundingClientRect()
        return {
          lines: new Set(rects.map((r) => Math.round(r.top))).size,
          contained: rects.every(
            (r) => r.left >= parent.left - 1 && r.right <= parent.right + 1,
          ),
        }
      })
      expect(metrics.lines, `${selector} at ${width}`).toBe(1)
      expect(metrics.contained, `${selector} at ${width}`).toBe(true)
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  }
  await page
    .locator('.sidebar')
    .evaluate((el) => (el.scrollTop = el.scrollHeight))
  await page
    .locator('.single-label')
    .screenshot({ path: '.cache/sidebar-label-fixed.png' })
  await page.screenshot({ path: '.cache/vote-bars-fixed.png', fullPage: true })
})
