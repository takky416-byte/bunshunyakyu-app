import { useEffect, useRef, useState } from 'react'
import { Copy, ImageDown } from 'lucide-react'
import type { Dataset } from './data'
import type { Game } from './engine'
import { shareResult } from './share'
import { resultImage } from './shareImage'
import { clubThemes } from './presentation'

export default function ResultShare({
  game,
  dataset,
}: {
  game: Game
  dataset: Dataset
}) {
  const result = shareResult(game, dataset)
  const [message, setMessage] = useState('')
  const [manual, setManual] = useState(false)
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (manual) {
      field.current?.focus()
      field.current?.select()
    }
  }, [manual])
  async function copy() {
    setMessage('')
    setManual(false)
    try {
      await navigator.clipboard.writeText(result.text)
      setMessage(
        'テキストをコピーしました。ブログなどに貼り付けて活用できます。',
      )
    } catch {
      setManual(true)
      setMessage(
        'コピーが許可されませんでした。下の文章を選択してコピーしてください。',
      )
    }
  }
  async function image() {
    setBusy(true)
    setMessage('')
    try {
      const blob = await resultImage(result, clubThemes[game.userTeam])
      const url = URL.createObjectURL(blob),
        a = document.createElement('a')
      a.href = url
      a.download = `genneki-draft-2026-${game.userTeam}.png`
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage('結果をPNG画像にしました。ブログの画像として使えます。')
    } catch {
      setMessage(
        '画像を作成できませんでした。テキストのコピーをお試しください。',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="result-share">
      <div className="share-preview">
        <strong>{result.club}</strong>
        <p>獲得：{result.acquired.map((p) => p.player).join('、')}</p>
        <p>放出：{result.released.map((p) => p.player).join('、')}</p>
      </div>
      <div className="share-actions">
        <button
          className="button primary"
          onClick={copy}
          aria-label="獲得・放出と12球団の結果のテキストをコピー"
        >
          <Copy size={17} />
          <span className="copy-result-label">
            <span>獲得・放出と</span>
            <span>12球団の結果の</span>
            <span>テキストをコピー</span>
          </span>
        </button>
        <button className="button ghost" onClick={image} disabled={busy}>
          <ImageDown size={17} />
          {busy ? '画像を作成中…' : 'PNG画像を保存'}
        </button>
      </div>
      <p className="share-help">
        獲得・放出と12球団の結果を文章としてコピーします。ブログやSNSなどに貼り付けて活用できます。
      </p>
      {message && (
        <p className="share-message" role="status">
          {message}
        </p>
      )}
      {manual && (
        <textarea
          ref={field}
          aria-label="貼り付け用のプレー結果"
          readOnly
          value={result.text}
          rows={10}
        />
      )}
    </div>
  )
}
