import { useEffect, useRef } from 'react'
import { ArrowRight } from 'lucide-react'
import Diamond from './Diamond'

export const SPLASH_KEY = 'geneki-draft:welcome:v1'
export function needsSplash() {
  try {
    return sessionStorage.getItem(SPLASH_KEY) !== 'seen'
  } catch {
    return true
  }
}
export default function Splash({
  resume,
  onEnter,
}: {
  resume: boolean
  onEnter: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  return (
    <dialog
      ref={dialog}
      className="welcome-screen"
      aria-labelledby="welcome-title"
      onCancel={(event) => {
        event.preventDefault()
        onEnter()
      }}
    >
      <div className="welcome-content">
        <span className="welcome-kicker">2026 / GENNEKI DRAFT ROOM</span>
        <Diamond className="welcome-diamond" />
        <h1 id="welcome-title">現役ドラフトルーム</h1>
        <p className="welcome-lead">
          あなたの采配が、
          <br />
          選手の次のチャンスになる。
        </p>
        <p>
          好きな球団のGMになり、
          <br />
          11球団のCPUと現役ドラフトを体験。
        </p>
        <div className="welcome-steps">
          <span>候補を出す</span>
          <ArrowRight size={14} />
          <span>希望を投票</span>
          <ArrowRight size={14} />
          <span>選手を指名</span>
        </div>
        <button className="welcome-enter" onClick={onEnter}>
          {resume ? '前回のドラフトを続ける' : '球団を選んではじめる'}
          <ArrowRight size={18} />
        </button>
        <small>ブラウザですぐプレー・登録不要 / 非公式シミュレーション</small>
      </div>
    </dialog>
  )
}
