import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, SkipForward } from 'lucide-react'
import { teamById, type Player } from './data'
import { voteCount, type Game } from './engine'
import type { Announcement } from './announcements'
import './draft-announcement.css'

export default function DraftAnnouncement({
  sequence,
  players,
  onCommit,
  onFinish,
}: {
  sequence: Announcement[]
  players: Player[]
  onCommit: (game: Game) => void
  onFinish: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const committed = useRef(-1)
  const finished = useRef(false)
  const item = sequence[index]
  const { game } = item
  const pick = game.picks.at(-1)
  const selected = players.find((p) => p.id === pick?.playerId)
  const club = teamById[item.kind === 'pick' ? pick!.by : game.order[0]]
  const roundTwoPicks = game.picks.filter((p) => p.round === 2)
  const ownRelease = item.kind === 'pick' && pick?.from === game.userTeam

  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  useEffect(() => {
    if (revealed) return
    const timer = window.setTimeout(() => setRevealed(true), 1800)
    return () => window.clearTimeout(timer)
  }, [index, revealed])
  useEffect(() => {
    if (revealed && committed.current < index) {
      committed.current = index
      onCommit(item.game)
    }
  }, [revealed, index, item, onCommit])

  function finish(skip: boolean) {
    if (finished.current) return
    finished.current = true
    if (skip) onCommit(sequence.at(-1)!.game)
    onFinish()
  }
  function next() {
    if (index === sequence.length - 1) finish(false)
    else {
      setRevealed(false)
      setIndex(index + 1)
    }
  }
  const last = index === sequence.length - 1
  const nextLabel = !last
    ? '次の指名発表へ'
    : game.stage === 'results'
      ? 'ドラフト結果を見る'
      : game.stage === 'round2'
        ? '第2巡へ進む'
        : game.current === game.userTeam
          ? '自分の指名へ'
          : 'ドラフトへ戻る'

  return (
    <dialog
      ref={dialog}
      className="draft-announcement"
      aria-labelledby="announcement-title"
      onCancel={(event) => {
        event.preventDefault()
        finish(true)
      }}
    >
      <div className="announcement-inner" key={index}>
        <div className="announcement-topline">
          <span>GENEKI DRAFT / 2026</span>
          <span>
            {item.kind === 'order'
              ? 'OPENING'
              : item.kind === 'round2'
                ? 'ROUND 02'
                : `ROUND 01 / ${String(game.picks.length).padStart(2, '0')}`}
          </span>
        </div>
        <div className="announcement-stage" data-revealed={revealed}>
          <span className="announcement-kicker">
            {item.kind === 'order'
              ? '12球団の予備指名、集計完了。'
              : item.kind === 'round2'
                ? '第2巡、入札条件の照合。'
                : `${club.name}、選択希望選手。`}
          </span>
          <h2 id="announcement-title">
            {item.kind === 'order'
              ? '最初の指名権は、'
              : item.kind === 'round2'
                ? 'もうひとつの移籍が、'
                : 'その名前が、未来を変える。'}
          </h2>
          <div className="announcement-envelope" aria-hidden="true">
            <span>{item.kind === 'pick' ? club.mark : '2026'}</span>
            <i />
          </div>
          <div
            className="announcement-content"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {!revealed ? (
              <div className="announcement-waiting">
                <span className="announcement-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <p>
                  {item.kind === 'order'
                    ? '指名順位を確認しています'
                    : item.kind === 'round2'
                      ? '入札の成立を確認しています'
                      : 'まもなく、指名を発表します'}
                </p>
              </div>
            ) : (
              <div className="announcement-revealed">
                {item.kind === 'order' ? (
                  <>
                    <span className="announcement-result-label">
                      FIRST PICK
                    </span>
                    <strong className="announcement-name">{club.name}</strong>
                    <p>
                      {voteCount(game, club.id, players)}票を獲得 /
                      あなたの暫定順位は{game.order.indexOf(game.userTeam) + 1}
                      位
                    </p>
                    <small>
                      同票の場合は2026年新人ドラフト第2巡の指名順で決定
                    </small>
                  </>
                ) : item.kind === 'pick' ? (
                  <>
                    <span className="announcement-result-label">
                      {ownRelease
                        ? 'あなたの提出候補が指名されました'
                        : '選択希望選手'}
                    </span>
                    <strong className="announcement-name">
                      {selected!.name}
                    </strong>
                    <p>
                      {teamById[pick!.from].short} / {selected!.position}
                    </p>
                    <div className="announcement-transfer">
                      <span>{teamById[pick!.from].short}</span>
                      <ArrowRight size={18} />
                      <b>{club.short}</b>
                    </div>
                    <small>
                      {game.current
                        ? `次の指名権：${teamById[game.current].name}`
                        : '第1巡、12球団の指名が終了しました。'}
                    </small>
                  </>
                ) : (
                  <>
                    <span className="announcement-result-label">
                      SECOND ROUND
                    </span>
                    <strong className="announcement-name">
                      {roundTwoPicks.length
                        ? `${roundTwoPicks.length}件の移籍が成立`
                        : '今回は、指名なし。'}
                    </strong>
                    <p>
                      {roundTwoPicks.length
                        ? '入札条件が合致した選手に、新しいチャンス。'
                        : '入札条件の合う移籍は成立しませんでした。'}
                    </p>
                    <small>全12球団の最終結果へ進みます。</small>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="announcement-footer">
          <span>
            {revealed ? (
              <>
                <Check size={14} />
                発表済み
              </>
            ) : (
              '発表をお待ちください'
            )}
          </span>
          <button
            className="button primary"
            onClick={next}
            disabled={!revealed}
          >
            {revealed ? nextLabel : '発表を待っています'}
            <ArrowRight size={16} />
          </button>
        </div>
        <button className="announcement-skip" onClick={() => finish(true)}>
          <SkipForward size={14} />
          演出をスキップ
          {sequence.length > 1
            ? sequence.at(-1)!.game.stage === 'round2'
              ? 'して第2巡へ進む'
              : 'して自分の番へ進む'
            : ''}
        </button>
      </div>
    </dialog>
  )
}
