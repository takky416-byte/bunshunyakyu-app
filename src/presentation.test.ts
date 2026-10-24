import { expect, it } from 'vitest'
import { clubThemes } from './presentation'

function luminance(hex: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
}
it('keeps button labels and links readable across all twelve club palettes', () => {
  expect(Object.keys(clubThemes)).toHaveLength(12)
  for (const theme of Object.values(clubThemes)) {
    const a = luminance(theme.accent),
      b = luminance(theme.onAccent)
    expect(
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
    ).toBeGreaterThanOrEqual(4.5)
    expect(1.05 / (luminance(theme.link) + 0.05)).toBeGreaterThanOrEqual(4.5)
    const secondary = luminance(theme.secondary),
      onSecondary = luminance(theme.onSecondary)
    expect(
      (Math.max(secondary, onSecondary) + 0.05) /
        (Math.min(secondary, onSecondary) + 0.05),
    ).toBeGreaterThanOrEqual(4.5)
    expect(theme.secondary).not.toBe(theme.accent)
  }
})
