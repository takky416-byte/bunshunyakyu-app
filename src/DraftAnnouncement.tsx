import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { ArrowRight, Check, Pause, Play, SkipForward } from 'lucide-react'
import { teamById, type Player } from './data'
import { voteCount, type Game } from './engine'
import type { Announcement } from './announcements'
import { clubStyle } from './presentation'
import { usePageVisible } from './usePageVisible'
import './draft-announcement.css'

export default function DraftAnnouncement({
  sequence,
  players,
  autoPlay,
  onAutoPlayChange,
  onCommit,
  onFinish,
}: {
  sequence: Announcement[]
  players: Player[]
  autoPlay: boolean
  onAutoPlayChange: (enabled: boolean) => void
  onCommit: (game: Game) => void
  onFinish: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const committed = useRef(-1)
  const transitioned = useRef(-1)
  const finished = useRef(false)
  const pageVisible = usePageVisible()
  const item = sequence[index]
  const { game } = item
  const pick = game.picks.at(-1)
  const selected = players.find((p) => p.id === pick?.playerId)
  const club =
    teamById[
      item.kind === 'pick'
        ? pick!.by
        : item.kind === 'nominations' || item.kind === 'round2'
          ? game.userTeam
          : game.order[0]
    ]
  const roundTwoPicks = game.picks.filter((p) => p.round === 2)
  const ownRelease = item.kind === 'pick' && pick?.from === game.userTeam

  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  useEffect(() => {
    dialog.current?.scrollTo({ top: 0, behavior: 'auto' })
    if (index > 0)
      dialog.current?.querySelector('h2')?.focus({ preventScroll: true })
  }, [index])
  useEffect(() => {
    if (revealed || !pageVisible) return
    const timer = window.setTimeout(() => setRevealed(true), 1800)
    return () => window.clearTimeout(timer)
  }, [index, revealed, pageVisible])
  useEffect(() => {
    if (revealed && committed.current < index) {
      committed.current = index
      onCommit(item.game)
    }
  }, [revealed, index, item, onCommit])

  const finish = useCallback(
    (skip: boolean) => {
      if (finished.current) return
      finished.current = true
      if (skip) onCommit(sequence.at(-1)!.game)
      onFinish()
    },
    [sequence, onCommit, onFinish],
  )
  const next = useCallback(() => {
    if (finished.current || transitioned.current >= index) return
    transitioned.current = index
    if (index === sequence.length - 1) finish(false)
    else {
      setRevealed(false)
      setIndex(index + 1)
    }
  }, [index, sequence.length, finish])
  const canAutoAdvance = item.kind === 'pick' || item.kind === 'order'
  useEffect(() => {
    if (!canAutoAdvance || !autoPlay || !revealed || !pageVisible) return
    const timer = window.setTimeout(next, 3500)
    return () => window.clearTimeout(timer)
  }, [canAutoAdvance, autoPlay, revealed, pageVisible, next])
  const last = index === sequence.length - 1
  const nextLabel = !last
    ? '次の指名発表へ'
    : item.kind === 'nominations'
      ? '獲得希望を選ぶ'
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
      style={clubStyle(club.id) as CSSProperties}
      data-team={club.id}
      data-kind={item.kind}
      data-autoplay={autoPlay && canAutoAdvance && pageVisible}
      aria-labelledby="announcement-title"
      onCancel={(event) => {
        event.preventDefault()
        finish(true)
      }}
    >
      <div className="announcement-inner" key={index}>
        <div className="announcement-topline">
          <span>GENNEKI DRAFT / 2026</span>
          <span>
            {item.kind === 'nominations'
              ? 'CANDIDATE LISTS'
              : item.kind === 'order'
                ? 'OPENING'
                : item.kind === 'round2'
                  ? 'ROUND 02'
                  : `ROUND 01 / ${String(game.picks.length).padStart(2, '0')}`}
          </span>
        </div>
        <div className="announcement-stage" data-revealed={revealed}>
          <span className="announcement-kicker">
            {item.kind === 'nominations'
              ? `${club.short}の候補を受け付けました。`
              : item.kind === 'order'
                ? '12球団の予備指名、集計完了。'
                : item.kind === 'round2'
                  ? '第2巡、入札条件の照合。'
                  : `${club.name}、選択希望選手。`}
          </span>
          <h2 id="announcement-title" tabIndex={-1}>
            {item.kind === 'nominations' && revealed ? (
              '候補提出、完了。'
            ) : item.kind === 'nominations' ? (
              <>
                <span className="text-unit">12球団の候補が、</span>
                <span className="text-unit">集まる。</span>
              </>
            ) : item.kind === 'order' ? (
              '最初の指名権は、'
            ) : item.kind === 'round2' ? (
              'もうひとつの移籍が、'
            ) : revealed ? (
              `${club.short}の指名`
            ) : (
              'その名前が、未来を変える。'
            )}
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
                  {item.kind === 'nominations'
                    ? '他の11球団の候補リストを取りまとめています'
                    : item.kind === 'order'
                      ? '指名順位を確認しています'
                      : item.kind === 'round2'
                        ? '入札の成立を確認しています'
                        : 'まもなく、指名を発表します'}
                </p>
              </div>
            ) : (
              <div className="announcement-revealed">
                {item.kind === 'nominations' ? (
                  <>
                    <span className="announcement-result-label">
                      LISTS READY
                    </span>
                    <strong className="announcement-name">
                      <span className="text-unit">12球団の候補が</span>
                      <span className="text-unit">揃いました</span>
                    </strong>
                    <p>
                      提出候補は計{Object.values(game.offers).flat().length}名。
                    </p>
                    <small>
                      <span className="text-unit">次は、獲得したい選手を</span>
                      <span className="text-unit">1名選んで投票します。</span>
                    </small>
                  </>
                ) : item.kind === 'order' ? (
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
        <div className="announcement-actions">
          {canAutoAdvance && (
            <div className="announcement-playback">
              <button
                className="announcement-autoplay"
                aria-label="指名発表の自動送り"
                aria-pressed={autoPlay}
                onClick={() => onAutoPlayChange(!autoPlay)}
              >
                {autoPlay ? <Pause size={15} /> : <Play size={15} />}
                自動送り：{autoPlay ? 'オン' : 'オフ'}
              </button>
              <small>
                {autoPlay ? '自分の指名番で停止' : 'ボタンで次へ進む'}
              </small>
            </div>
          )}
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
      </div>
    </dialog>
  )
}
