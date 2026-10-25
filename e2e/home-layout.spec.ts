import { test, expect } from './fixtures'

test('home text remains separate and legible across phones, PC widths and larger fonts', async ({
  page,
}) => {
  await page.goto('/')
  for (const width of [320, 360, 390, 430, 768, 980, 1280, 1920]) {
    await page.setViewportSize({ width, height: 844 })
    for (const fontSize of [16, 20]) {
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size + 'px'
        scrollTo(0, 0)
      }, fontSize)
      const layout = await page.evaluate(() => {
        const root = document.querySelector('main')!
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        const texts: {
          text: string
          left: number
          right: number
          top: number
          bottom: number
        }[] = []
        while (walker.nextNode()) {
          const node = walker.currentNode,
            parent = node.parentElement!
          if (
            !node.textContent?.trim() ||
            parent.closest('svg,dialog') ||
            !parent.checkVisibility()
          )
            continue
          const range = document.createRange()
          range.selectNodeContents(node)
          for (const box of range.getClientRects())
            if (box.width && box.height)
              texts.push({
                text: node.textContent.trim(),
                left: box.left,
                right: box.right,
                top: box.top,
                bottom: box.bottom,
              })
        }
        const overlaps: string[][] = []
        for (let i = 0; i < texts.length; i++)
          for (let j = i + 1; j < texts.length; j++) {
            const a = texts[i],
              b = texts[j]
            if (
              Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
              Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
            )
              overlaps.push([a.text, b.text])
          }
        const hero = document
          .querySelector('.concept-intro')!
          .getBoundingClientRect()
        const copy = document
          .querySelector('.hero-copy')!
          .getBoundingClientRect()
        const diamond = document.querySelector<HTMLElement>('.concept-diamond')!
        const deco = diamond.getBoundingClientRect()
        return {
          overlaps,
          overflow: document.documentElement.scrollWidth > innerWidth,
          decorationOverlaps:
            getComputedStyle(diamond).display !== 'none' &&
            deco.left < copy.right &&
            deco.right > copy.left &&
            deco.top < copy.bottom &&
            deco.bottom > copy.top,
          copyWithin:
            copy.left >= hero.left &&
            copy.right <= hero.right &&
            copy.top >= hero.top &&
            copy.bottom <= hero.bottom,
        }
      })
      expect(layout.overlaps, `${width}px / ${fontSize}px font`).toEqual([])
      expect(layout.overflow).toBe(false)
      expect(layout.copyWithin).toBe(true)
      expect(layout.decorationOverlaps).toBe(false)
      for (const unit of await page
        .locator('.concept-intro h1 .text-unit')
        .all()) {
        expect(await unit.evaluate((e) => e.getClientRects().length)).toBe(1)
      }
    }
    await page.evaluate(
      () => (document.documentElement.style.fontSize = '16px'),
    )
    if ([320, 390, 768, 1280].includes(width))
      await page.screenshot({
        path: `.cache/home-fixed-${width}.png`,
        fullPage: true,
      })
  }
})
