import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from 'react'
import {
  Check,
  Copy,
  LogOut,
  MessageCircle,
  Send,
  Users,
  X,
} from 'lucide-react'
import { teamById } from './data'
import {
  centralSelection,
  pacificSelection,
  selectionNames,
  clubStyle,
} from './presentation'
import { reactions, type RoomSnapshot } from './room-contract'
import type { RoomConnection } from './useRoom'
import './rooms.css'

export function RoomEntry({
  name,
  setName,
  code,
  setCode,
  busy,
  create,
  join,
}: {
  name: string
  setName: (s: string) => void
  code: string
  setCode: (s: string) => void
  busy: boolean
  create: () => void
  join: () => void
}) {
  return (
    <section className="room-entry panel" aria-label="ルームの作成・参加">
      <label>
        プレーヤー名
        <input
          aria-label="プレーヤー名"
          autoComplete="nickname"
          maxLength={16}
          placeholder="ニックネーム（16文字以内）"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="room-entry-actions">
        <div>
          <button
            className="button primary"
            disabled={busy || !name.trim()}
            onClick={create}
          >
            <Users size={18} />
            ルームを作る
          </button>
          <small>
            {name.trim()
              ? '1人でも開始できます。球団は作成後に選択。'
              : 'プレーヤー名を入力すると、作成・参加できます。'}
          </small>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            join()
          }}
        >
          <label>
            ルーム番号
            <input
              aria-label="ルーム番号"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="6桁の番号"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.normalize('NFKC').replace(/[^0-9]/g, ''))
              }
            />
          </label>
          <button
            className="button ghost"
            disabled={busy || !name.trim() || code.length !== 6}
          >
            ルームに入る
          </button>
        </form>
      </div>
    </section>
  )
}
export function RoomLobby({
  room,
  headingRef,
}: {
  room: RoomConnection
  headingRef?: Ref<HTMLHeadingElement>
}) {
  const state = room.snapshot!,
    me = state.members.find((m) => m.id === state.me)!
  const [busy, setBusy] = useState(false)
  const run = async (action: Parameters<RoomConnection['send']>[0]) => {
    setBusy(true)
    room.setError('')
    try {
      await room.send(action)
    } catch (e) {
      room.setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="room-lobby panel" aria-label="ルームの待合室">
      <div className="panel-heading">
        <div>
          <span className="eyebrow dark">DRAFT LOBBY</span>
          <h1 ref={headingRef} className="flow-target" tabIndex={-1}>
            球団を選んで、準備しよう。
          </h1>
          <p>
            {state.host === me.id
              ? state.members.length === 1
                ? '1人でも開始できます。仲間と遊ぶ場合は、ルーム番号を伝えて参加を待ってください。'
                : '仲間にはルーム番号を伝えてください。全員が「準備完了」になると開始できます。'
              : me.ready
                ? '準備完了です。主催者が開始するまでお待ちください。'
                : '球団を選び「準備完了」を押してください。主催者が開始すると、空席はCPUが担当します。'}
          </p>
        </div>
      </div>
      <div className="lobby-scroll">
        <div className="team-leagues" role="group" aria-label="操作する球団">
          {[
            { name: 'セ・リーグ', ids: centralSelection },
            { name: 'パ・リーグ', ids: pacificSelection },
          ].map((division) => (
            <div
              className="team-division"
              role="region"
              aria-label={division.name}
              key={division.name}
            >
              <h3>{division.name}</h3>
              <div className="lobby-teams">
                {division.ids.map((id) => {
                  const owner = state.members.find((m) => m.team === id),
                    own = owner?.id === me.id
                  return (
                    <button
                      key={id}
                      className={`lobby-team ${own ? 'selected' : ''}`}
                      style={clubStyle(id) as CSSProperties}
                      aria-label={teamById[id].name}
                      aria-pressed={own}
                      disabled={!room.connected || busy || (!!owner && !own)}
                      onClick={() => void run({ type: 'team', team: id })}
                    >
                      <strong>{selectionNames[id]}</strong>
                      <small
                        title={
                          owner
                            ? `${owner.name}：${owner.ready ? '準備完了' : owner.online ? '選択中' : '再接続待ち'}`
                            : undefined
                        }
                      >
                        {owner
                          ? `${owner.name}${owner.ready ? ' ✓' : ''}`
                          : 'CPU（空席）'}
                      </small>
                      {owner && (
                        <span>
                          {owner.ready
                            ? '準備完了'
                            : owner.online
                              ? '選択中'
                              : '再接続待ち'}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        {state.members
          .filter((m) => !m.online && m.id !== me.id)
          .map((m) => (
            <p key={m.id} className="room-disconnected">
              {m.name}さんは再接続待ちです。
              {state.host === me.id && (
                <button
                  onClick={() => void run({ type: 'remove', memberId: m.id })}
                >
                  待合室から外す
                </button>
              )}
            </p>
          ))}
      </div>
      <div className="panel-footer lobby-footer">
        <span>
          <strong>{state.members.length}人</strong> ＋ CPU{' '}
          {12 - state.members.length}球団
        </span>
        <div className="lobby-buttons">
          <button
            className="button ghost"
            disabled={busy || !room.connected}
            aria-pressed={me.ready}
            onClick={() => void run({ type: 'ready', ready: !me.ready })}
          >
            <Check size={16} />
            {me.ready ? '準備完了を取り消す' : '準備完了'}
          </button>
          {state.host === me.id ? (
            <button
              className="button primary"
              disabled={
                busy ||
                !room.connected ||
                state.members.some(
                  (m) => m.id !== me.id && (!m.ready || !m.online),
                )
              }
              onClick={() => void run({ type: 'start' })}
            >
              ドラフトを開始する
            </button>
          ) : (
            <span className="muted">主催者の開始を待ちます</span>
          )}
        </div>
      </div>
    </section>
  )
}
export function RoomStatus({
  room,
  onChat,
  unread,
}: {
  room: RoomConnection
  onChat: () => void
  unread: number
}) {
  const state = room.snapshot!
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = bar.current,
      shell = element?.closest<HTMLElement>('.app-shell')
    if (!element || !shell) return
    const update = () =>
      shell.style.setProperty(
        '--room-bar-height',
        `${Math.ceil(element.getBoundingClientRect().height)}px`,
      )
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    return () => {
      observer.disconnect()
      shell.style.removeProperty('--room-bar-height')
    }
  }, [])
  const [copied, setCopied] = useState(false)
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const remaining = state.deadline
    ? Math.max(0, Math.ceil((state.deadline - room.serverNow()) / 1000))
    : null
  const run = (paused: boolean) => {
    void room
      .send({ type: 'pause', paused })
      .catch((e) => room.setError(e.message))
  }
  return (
    <div ref={bar} className="room-status" aria-label="ルームの状況">
      <div className="room-number">
        <span>ROOM</span>
        <strong>{state.code}</strong>
        <button
          className="icon-button"
          aria-label="ルーム番号をコピー"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(state.code)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }}
        >
          {copied ? <Check size={18} /> : <Copy size={18} />}
        </button>
      </div>
      <span className={`room-connection ${room.connected ? '' : 'offline'}`}>
        {room.connected
          ? `${state.members.filter((m) => m.online && !m.cpu).length}人接続中`
          : '再接続中…'}
      </span>
      {state.game && (state.game.stage !== 'results' || state.presentation) && (
        <span className="room-clock">
          {state.paused
            ? '一時停止中'
            : state.presentation
              ? '指名発表中'
              : remaining !== null
                ? `残り ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
                : ''}
        </span>
      )}
      <div className="room-status-actions">
        {state.host === state.me &&
          state.game &&
          (state.game.stage !== 'results' || state.presentation) && (
            <button
              onClick={() => run(!state.paused)}
              disabled={!room.connected}
            >
              {state.paused ? '進行を再開' : '一時停止'}
            </button>
          )}
        {state.presentation &&
          state.members.filter((m) => !m.cpu).length === 1 && (
            <button
              disabled={!room.connected || state.paused}
              onClick={() => {
                void room
                  .send({
                    type: 'presented',
                    presentationId: state.presentation!.id,
                  })
                  .catch((e) => room.setError(e.message))
              }}
            >
              発表を終えて次へ
            </button>
          )}
        <button className="room-chat-button" onClick={onChat}>
          <MessageCircle size={18} />
          チャット{unread > 0 && <b>{unread}</b>}
        </button>
      </div>
    </div>
  )
}
export function RoomWaiting({
  state,
  headingRef,
}: {
  state: RoomSnapshot
  headingRef?: Ref<HTMLHeadingElement>
}) {
  const stage = state.game?.stage
  const copy =
    stage === 'nominate'
      ? {
          title: '提出候補を受け付けました',
          noun: '候補提出済み',
          text: '他の球団の候補提出を待っています。全員が確定すると、候補一覧を公開します。',
        }
      : stage === 'vote'
        ? {
            title: '投票を受け付けました',
            noun: '投票済み',
            text: '他の球団の投票を待っています。全員の投票が揃うと、指名順を発表します。',
          }
        : stage === 'round2'
          ? {
              title: '参加意向を受け付けました',
              noun: '意向確定済み',
              text: '全員の参加意向が揃うと、獲得希望の球団が入札します。獲得を見送る球団は、そのまま発表をお待ちください。',
            }
          : stage === 'round2confirm'
            ? {
                title:
                  state.game?.roundTwo?.intents[state.game.userTeam] === 'buy'
                    ? '入札を受け付けました'
                    : '第2巡の入札を待っています',
                noun: '確認済み',
                text: '獲得希望の球団の入札を待っています。全員が確定すると、成立した指名を順番に発表します。',
              }
            : null
  return (
    <section className="panel room-waiting" aria-live="polite">
      <span className="eyebrow dark">WAITING FOR TEAMS</span>
      <h2 ref={headingRef} className="flow-target" tabIndex={-1}>
        {state.paused
          ? '進行を一時停止しています'
          : state.presentation
            ? 'ルーム全員への発表中です'
            : copy?.title}
      </h2>
      <p>
        {state.paused
          ? '主催者が再開するまでお待ちください。チャットは利用できます。'
          : state.presentation
            ? '発表が終わると、次の操作へ自動で切り替わります。チャットは引き続き使えます。'
            : copy?.text}
      </p>
      {copy && !state.presentation && (
        <>
          <strong>
            {state.submitted.length}／12球団 {copy.noun}
          </strong>
          {stage === 'round2confirm' && (
            <p>確認済みには、獲得を見送るため入札が不要な球団も含みます。</p>
          )}
          <div className="room-submitted">
            {[...centralSelection, ...pacificSelection].map((t) => (
              <span
                key={t}
                className={state.submitted.includes(t) ? 'done' : ''}
              >
                {teamById[t].short} {state.submitted.includes(t) ? '✓' : '…'}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

export function RoomChat({
  room,
  open,
  close,
}: {
  room: RoomConnection
  open: boolean
  close: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    bottom = useRef<HTMLDivElement>(null)
  const [text, setText] = useState(''),
    [error, setError] = useState(''),
    [sending, setSending] = useState(false)
  useEffect(() => {
    const element = dialog.current,
      desktop = window.matchMedia('(min-width: 1200px)')
    const sync = () => {
      element?.close()
      if (!open || !element) return
      if (
        desktop.matches &&
        !document.querySelector('dialog.draft-announcement[open]')
      )
        element.show()
      else element.showModal()
    }
    sync()
    desktop.addEventListener('change', sync)
    return () => desktop.removeEventListener('change', sync)
  }, [open, room.snapshot?.presentation?.id])
  useEffect(() => {
    if (open) bottom.current?.scrollIntoView({ block: 'end' })
  }, [open, room.snapshot?.messages.length, room.snapshot?.messages.at(-1)?.id])
  const send = async (message: string, reaction = false) => {
    setSending(true)
    setError('')
    try {
      await room.send(
        reaction
          ? { type: 'reaction', text: message }
          : { type: 'chat', text: message },
      )
      if (!reaction) setText('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSending(false)
    }
  }
  return (
    <dialog
      className="room-chat"
      ref={dialog}
      aria-labelledby="room-chat-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          close()
        }
      }}
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <header>
        <div>
          <h2 id="room-chat-title">ルームチャット</h2>
          <small>このルーム内だけで共有されます</small>
        </div>
        <button
          className="icon-button"
          onClick={close}
          aria-label="チャットを閉じる"
        >
          <X size={22} />
        </button>
      </header>
      <ol
        className="room-chat-messages"
        aria-label="チャットの履歴"
        aria-live="polite"
      >
        {room.snapshot?.messages.map((m) => (
          <li key={m.id} className={`message-${m.kind}`}>
            {m.kind !== 'system' && (
              <div>
                <strong>{m.name}</strong>
                <small>{m.team && teamById[m.team].short}</small>
                <time>
                  {new Intl.DateTimeFormat('ja-JP', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Tokyo',
                  }).format(m.at)}
                </time>
              </div>
            )}
            <p>{m.text}</p>
          </li>
        ))}
        <li aria-hidden="true" className="chat-bottom">
          <div ref={bottom} />
        </li>
      </ol>
      <footer>
        <div className="room-reactions">
          {reactions.map((r) => (
            <button
              key={r}
              disabled={!room.connected || sending}
              onClick={() => void send(r, true)}
            >
              {r}
            </button>
          ))}
        </div>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void send(text)
          }}
        >
          <input
            aria-label="チャットメッセージ"
            placeholder="メッセージ（240文字以内）"
            value={text}
            maxLength={240}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            className="button primary"
            aria-label="メッセージを送信"
            disabled={!room.connected || sending || !text.trim()}
          >
            <Send size={18} />
          </button>
        </form>
        <small>履歴は最大80件。ルームの終了後、一定時間で削除します。</small>
      </footer>
    </dialog>
  )
}
export function RoomLeaveButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="button ghost" onClick={onClick}>
      <LogOut size={16} />
      ルームを退出する
    </button>
  )
}
