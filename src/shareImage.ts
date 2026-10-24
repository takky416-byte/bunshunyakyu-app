import type { SharedResult } from './share'
import { APP_URL, SHARE_NOTICE } from './share'
import type { ClubTheme } from './presentation'

export async function resultImage(
  result: SharedResult,
  theme: ClubTheme,
): Promise<Blob> {
  await document.fonts.ready
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('画像を作成できませんでした。')
  const font = '"Noto Sans JP", "Yu Gothic", sans-serif'
  context.font = `24px ${font}`
  const wrap = (text: string, width: number) => {
    const lines: string[] = []
    let current = ''
    for (const c of text) {
      if (current && context.measureText(current + c).width > width) {
        lines.push(current)
        current = c
      } else current += c
    }
    if (current) lines.push(current)
    return lines
  }
  const own = [
    `獲得：${result.acquired.map((p) => `${p.player}（${p.from}）`).join('、')}`,
    `放出：${result.released.map((p) => `${p.player}（${p.by}へ）`).join('、')}`,
  ].flatMap((line) => wrap(line, 1080))
  const rows = result.picks.map((p) => ({ p, lines: wrap(p.player, 370) }))
  context.font = `20px ${font}`
  const footer = [
    ...wrap(SHARE_NOTICE, 1100),
    ...wrap(`使用データ：${result.dataset}`, 1100),
    APP_URL,
  ]
  canvas.width = 1200
  canvas.height =
    310 +
    own.length * 36 +
    rows.reduce((n, r) => n + Math.max(54, r.lines.length * 30 + 18), 0) +
    footer.length * 28 +
    90
  context.fillStyle = '#fafbf8'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = theme.deep
  context.fillRect(0, 0, 1200, 150)
  context.fillStyle = theme.accent
  context.fillRect(0, 0, 12, 150)
  context.fillStyle = theme.secondary
  context.fillRect(12, 144, 1188, 6)
  context.fillStyle = '#ffffff'
  context.font = `bold 34px ${font}`
  context.fillText('現役ドラフトルーム 2026', 50, 65)
  context.font = `24px ${font}`
  context.fillText(result.club + 'でのプレー結果', 50, 112)
  context.fillStyle = '#263a32'
  let y = 200
  for (const line of own) {
    context.fillText(line, 50, y)
    y += 36
  }
  y += 24
  context.fillStyle = theme.accent
  context.fillRect(40, y, 1120, 50)
  context.fillStyle = theme.onAccent
  context.font = `bold 23px ${font}`
  const xs = [56, 136, 330, 530, 970]
  ;['巡', '移籍元', '獲得球団', '選手', '守備位置'].forEach((label, i) =>
    context.fillText(label, xs[i], y + 34),
  )
  y += 50
  context.font = `24px ${font}`
  for (const { p, lines } of rows) {
    const height = Math.max(54, lines.length * 30 + 18)
    context.fillStyle = '#ffffff'
    context.fillRect(40, y, 1120, height)
    context.fillStyle = '#263a32'
    ;[String(p.round), p.from, p.by].forEach((value, i) =>
      context.fillText(value, xs[i], y + 35),
    )
    lines.forEach((line, i) => context.fillText(line, xs[3], y + 35 + i * 30))
    context.fillText(p.position, xs[4], y + 35)
    context.strokeStyle = '#dce3db'
    context.beginPath()
    context.moveTo(40, y + height)
    context.lineTo(1160, y + height)
    context.stroke()
    y += height
  }
  context.fillStyle = '#526452'
  context.font = `20px ${font}`
  y += 42
  for (const line of footer) {
    context.fillText(line, 50, y)
    y += 28
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('画像を作成できませんでした。')),
      'image/png',
    ),
  )
}
