import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Database,
  Download,
  ExternalLink,
  Flag,
  Home,
  Info,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  Upload,
  Users,
  X,
} from 'lucide-react'
import {
  parseDataset,
  positions,
  referenceDataset,
  teamById,
  teamIds,
  teams,
  type Dataset,
  type Player,
  type Position,
  type Team,
  type TeamId,
} from './data'
import {
  beginDraft,
  choicesFor,
  fit,
  makePick,
  newGame,
  offeredPlayers,
  restoreGame,
  startRoundTwo,
  confirmRoundTwo,
  roundTwoChoices,
  submitNominations,
  voteCount,
  type Game,
} from './engine'
import { eligibilityOf, nominationErrors } from './eligibility'
import { RULESET_ID, salaryPolicy } from './rules2026'
import type { Participation, BidCondition } from './roundTwo'
import { officialDataset } from './officialData'
import {
  trackPageView,
  trackPlayStarted,
  trackPlayCompleted,
  validTrackedPlay,
  privacyStatus,
  subscribePrivacy,
  type TrackedPlay,
} from './analytics'
import PrivacySettings from './PrivacySettings'
import DraftAnnouncement from './DraftAnnouncement'
import CompactDetails from './CompactDetails'
import { npcAnnouncements, type Announcement } from './announcements'

const STORAGE_KEY = 'geneki-draft-room:v2'
type Modal = 'rules' | 'data' | 'reset' | 'privacy' | 'player' | null
interface Saved {
  dataset: Dataset
  game: Game | null
  chosenTeam: TeamId
  trackedPlay?: TrackedPlay | null
}
function load(): Saved & { warning?: string } {
  const initial: Saved = {
    dataset: officialDataset,
    game: null,
    chosenTeam: 't',
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved)
      return localStorage.getItem('geneki-draft-room:v1')
        ? {
            ...initial,
            warning:
              'ルール更新のため新しいドラフトから始めます。旧版の保存記録はブラウザに保持しています。',
          }
        : initial
    const value = JSON.parse(saved)
    const dataset =
      value.dataset?.kind === 'official-roster'
        ? officialDataset
        : value.dataset?.kind === 'reference'
          ? value.game
            ? referenceDataset
            : officialDataset
          : parseDataset(value.dataset)
    const game = value.game ? restoreGame(value.game, dataset.players) : null
    return {
      dataset,
      game,
      chosenTeam:
        game?.userTeam ??
        (teamIds.includes(value.chosenTeam) ? value.chosenTeam : 't'),
      trackedPlay:
        game && validTrackedPlay(value.trackedPlay) ? value.trackedPlay : null,
    }
  } catch {
    return {
      ...initial,
      warning:
        '前回の保存データを読み込めませんでした。新しいドラフトから始められます。',
    }
  }
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function TeamMark({ team, small = false }: { team: Team; small?: boolean }) {
  return (
    <span
      className={`team-mark ${small ? 'small' : ''}`}
      style={{ '--team-color': team.color } as CSSProperties}
      aria-hidden="true"
    >
      {team.mark}
      <span>BASEBALL</span>
    </span>
  )
}
function StatSummary({ player }: { player: Player }) {
  const s = player.stats
  if (!s) return <span className="player-stats">2026 一軍成績掲載なし</span>
  return (
    <span className="player-stats">
      <b>2026</b>
      {player.position === '投手'
        ? `${s.games}登板 / 防御率 ${s.era == null ? '—' : s.era.toFixed(2)}`
        : `${s.games}試合 / 打率 ${s.average == null ? '—' : s.average.toFixed(3)} / ${s.homeRuns ?? '—'}本`}
    </span>
  )
}
function Diamond({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 360 270"
      fill="none"
      role="img"
      aria-label="野球場のイラスト"
    >
      <defs>
        <linearGradient
          id="field"
          x1="180"
          y1="0"
          x2="180"
          y2="270"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#3e6e56" />
          <stop offset="1" stopColor="#254938" />
        </linearGradient>
        <pattern
          id="stripes"
          width="36"
          height="36"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <path d="M0 0h18v36H0z" fill="#fff" opacity=".028" />
        </pattern>
      </defs>
      <path
        d="M180 244 23 87Q180-49 337 87Z"
        fill="url(#field)"
        stroke="#72927a"
        strokeWidth="1"
      />
      <path d="M180 244 23 87Q180-49 337 87Z" fill="url(#stripes)" />
      <path
        d="M180 227 42 88Q180-24 318 88Z"
        stroke="#b6c7a3"
        strokeOpacity=".35"
        strokeDasharray="3 5"
      />
      <path d="m180 244-96-96 96-96 96 96Z" fill="#c3a16d" fillOpacity=".85" />
      <path d="m180 222-74-74 74-74 74 74Z" fill="#416b4e" />
      <path
        d="M180 244 23 87M180 244 337 87"
        stroke="#e9e5cd"
        strokeOpacity=".8"
      />
      <circle cx="180" cy="148" r="14" fill="#c3a16d" />
      <rect x="175" y="145" width="10" height="3" rx="1" fill="#f7f1df" />
      <path d="m180 238 5 5v6h-10v-6Z" fill="#f7f1df" />
      <path
        d="m87 148 5-5 5 5-5 5ZM175 56l5-5 5 5-5 5ZM263 148l5-5 5 5-5 5Z"
        fill="#f7f1df"
      />
      <circle cx="180" cy="244" r="19" stroke="#b6c7a3" strokeOpacity=".45" />
      <path d="M56 213h29M275 213h29" stroke="#d6bd78" strokeOpacity=".5" />
      <circle cx="104" cy="105" r="5" fill="#d6bd78" />
      <circle cx="253" cy="101" r="5" fill="#d6bd78" />
      <circle cx="180" cy="30" r="5" fill="#d6bd78" />
    </svg>
  )
}
function ModalShell({
  title,
  children,
  close,
}: {
  title: string
  children: ReactNode
  close: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!returnFocus.current && document.activeElement instanceof HTMLElement)
      returnFocus.current = document.activeElement
    dialog.current?.showModal()
    return () => {
      if (returnFocus.current?.isConnected)
        returnFocus.current.focus({ preventScroll: true })
    }
  }, [])
  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={close}
      onClose={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="閉じる" onClick={close}>
          <X size={22} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  )
}
const steps = [
  '球団を選ぶ',
  '候補を提出',
  '希望を投票',
  'ドラフト',
  '結果を見る',
]

export default function App() {
  const [initial] = useState(load)
  const [dataset, setDataset] = useState(initial.dataset)
  const [game, setGame] = useState<Game | null>(initial.game)
  const [chosenTeam, setChosenTeam] = useState<TeamId>(initial.chosenTeam)
  const [trackedPlay, setTrackedPlay] = useState<TrackedPlay | null>(() =>
    privacyStatus() === 'enabled' ? (initial.trackedPlay ?? null) : null,
  )
  const [nominees, setNominees] = useState<string[]>([])
  const [showExcluded, setShowExcluded] = useState(false)
  const [roundPreferences, setRoundPreferences] = useState<string[]>([])
  const [bidCondition, setBidCondition] =
    useState<BidCondition>('unconditional')
  const [votedId, setVotedId] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [position, setPosition] = useState<Position | 'すべて'>('すべて')
  const [league, setLeague] = useState('すべて')
  const [modal, setModal] = useState<Modal>(null)
  const [error, setError] = useState(initial.warning ?? '')
  const [storageError, setStorageError] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [detailPlayerId, setDetailPlayerId] = useState('')
  const [compact, setCompact] = useState(
    () => window.matchMedia('(max-width: 760px)').matches,
  )
  const flowTarget = useRef<HTMLHeadingElement>(null)
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(
    null,
  )
  const [presentationEnabled, setPresentationEnabled] = useState(() => {
    try {
      return localStorage.getItem('geneki-draft:presentation:v1') !== 'off'
    } catch {
      return true
    }
  })
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const file = useRef<HTMLInputElement>(null)
  const team = teamById[game?.userTeam ?? chosenTeam]
  const players = dataset.players
  const isReference = dataset.kind === 'reference'
  const isOfficial = dataset.kind === 'official-roster'
  const stageIndex = !game
    ? 0
    : game.stage === 'nominate'
      ? 1
      : game.stage === 'vote'
        ? 2
        : game.stage === 'results'
          ? 4
          : 3
  const selectedPlayer = players.find((p) => p.id === selectedId)
  const detailPlayer = players.find((p) => p.id === detailPlayerId)
  const userTurn = game?.stage === 'draft' && game.current === game.userTeam
  const player = (id: string) => players.find((p) => p.id === id)!
  const flowKey = game
    ? `${game.seed}:${game.stage}:${game.current ?? ''}:${game.picks.length}`
    : 'home'
  const previousFlow = useRef(flowKey)
  const pendingFlowFocus = useRef(false)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const change = () => setCompact(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    if (previousFlow.current !== flowKey) pendingFlowFocus.current = true
    previousFlow.current = flowKey
    if (modal || announcements || !pendingFlowFocus.current) return
    const frame = requestAnimationFrame(() => {
      pendingFlowFocus.current = false
      const target = flowTarget.current
      if (!target) return
      document
        .querySelector('.roster-list')
        ?.scrollTo({ top: 0, behavior: 'auto' })
      target.focus({ preventScroll: true })
      target.scrollIntoView({ block: 'start', behavior: 'auto' })
    })
    return () => cancelAnimationFrame(frame)
  }, [flowKey, modal, announcements])

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ dataset, game, chosenTeam, trackedPlay }),
      )
      setStorageError(false)
    } catch {
      setStorageError(true)
    }
  }, [dataset, game, chosenTeam, trackedPlay])
  useEffect(() => {
    trackPageView()
  }, [])
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReducedMotion(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useEffect(
    () =>
      subscribePrivacy(() => {
        if (privacyStatus() !== 'enabled') setTrackedPlay(null)
      }),
    [],
  )
  useEffect(() => {
    if (game?.stage === 'results' && trackedPlay)
      trackPlayCompleted(trackedPlay, game.userTeam)
  }, [game?.stage, game?.userTeam, trackedPlay])

  function act(action: () => void) {
    try {
      setError('')
      action()
      setSelectedId('')
      setSearch('')
      setPosition('すべて')
    } catch (e) {
      setError(e instanceof Error ? e.message : '処理に失敗しました。')
    }
  }
  function announce(sequence: Announcement[]) {
    if (!sequence.length) return
    if (presentationEnabled && !reducedMotion) setAnnouncements(sequence)
    else setGame(sequence.at(-1)!.game)
  }
  function togglePresentation() {
    const enabled = !presentationEnabled
    setPresentationEnabled(enabled)
    try {
      localStorage.setItem(
        'geneki-draft:presentation:v1',
        enabled ? 'on' : 'off',
      )
    } catch {
      /* usable without storage */
    }
  }
  function start() {
    act(() => {
      const seed = crypto.getRandomValues(new Uint32Array(1))[0]
      setGame(newGame(chosenTeam, seed))
      setTrackedPlay(trackPlayStarted(chosenTeam))
      setNominees([])
      setRoundPreferences([])
      setShowExcluded(false)
      setVotedId('')
    })
  }
  function reset() {
    setDetailPlayerId('')
    setAnnouncements(null)
    setGame(null)
    setTrackedPlay(null)
    setNominees([])
    setVotedId('')
    setSelectedId('')
    setSearch('')
    setPosition('すべて')
    setError('')
    setModal(null)
  }
  async function importFile(input: File | undefined) {
    if (!input) return
    setImportMessage('')
    try {
      if (input.size > 1_000_000)
        throw new Error('ファイルは1MB以内にしてください。')
      const imported = parseDataset(JSON.parse(await input.text()))
      if (game)
        throw new Error(
          '進行中のドラフトがあります。「新しいドラフト」で球団選択に戻ってから取り込んでください。',
        )
      setDataset(imported)
      setImportMessage(
        `${imported.players.length}名を取り込みました。在籍・資格の確認は自動では行いません。`,
      )
    } catch (e) {
      setImportMessage(
        e instanceof Error ? e.message : 'JSONファイルを読み込めませんでした。',
      )
    }
    if (file.current) file.current.value = ''
  }
  function exportResult() {
    if (!game) return
    download(`geneki-draft-2026-${game.seed}.json`, {
      app: '現役ドラフトルーム',
      version: 1,
      targetSeason: 2026,
      seed: game.seed,
      rules: RULESET_ID,
      salaryPolicy,
      dataset: {
        label: dataset.label,
        season: dataset.season,
        asOf: dataset.asOf,
        sourceUrl: dataset.sourceUrl,
        kind: dataset.kind,
      },
      notice:
        '非公式シミュレーション。2026年推定年俸を使う仮判定です。契約情報等に未確認部分があり、入札の内部調整は独自実装です。ゲーム内適合度は実績ではありません。',
      picks: game.picks.map((p) => ({
        round: p.round,
        team: teamById[p.by].name,
        from: teamById[p.from].name,
        player: player(p.playerId).name,
        position: player(p.playerId).position,
      })),
    })
  }
  let roster: Player[] = []
  if (game?.stage === 'nominate')
    roster = players.filter(
      (p) => p.team === team.id && (showExcluded || eligibilityOf(p).allowed),
    )
  if (game?.stage === 'vote')
    roster = offeredPlayers(game, players).filter((p) => p.team !== team.id)
  if (game?.stage === 'draft' && userTurn)
    roster = choicesFor(game, players).sort(
      (a, b) => fit(b, team.id, game.seed) - fit(a, team.id, game.seed),
    )
  const submissionErrors = nominationErrors(
    nominees.map((id) => players.find((p) => p.id === id)!),
  )
  const roundChoices =
    game?.stage === 'round2confirm'
      ? roundTwoChoices(game, players).filter((p) => p.team !== team.id)
      : []
  const filteredRoster = roster.filter(
    (p) =>
      (position === 'すべて' || p.position === position) &&
      p.name.replace(/\s/g, '').includes(search.replace(/\s/g, '')),
  )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault()
            if (game) setModal('reset')
          }}
          aria-label="現役ドラフトルーム ホーム"
        >
          <span className="brand-icon">
            <span />
          </span>
          <span>
            現役ドラフト
            <span className="brand-bottom">
              ルーム<span className="brand-dot">.</span>
            </span>
          </span>
        </a>
        <div className="season-label">
          <span className="status-dot" />
          2026 SEASON
        </div>
        <div className="nav-caption">YOUR FRONT OFFICE</div>
        <button
          className="nav-item active"
          onClick={() => {
            if (game) setModal('reset')
          }}
        >
          <Home size={18} />
          ドラフトルーム
          <ChevronRight size={15} />
        </button>
        <button className="nav-item" onClick={() => setModal('rules')}>
          <BookOpen size={18} />
          ルールガイド
          <ArrowUpRight size={14} />
        </button>
        <button
          className="nav-item"
          onClick={() => {
            setImportMessage('')
            setModal('data')
          }}
        >
          <Database size={18} />
          選手データ
          <ArrowUpRight size={14} />
        </button>
        <div className="sidebar-line" />
        <div className="nav-caption">DRAFT PROGRESS</div>
        <ol className="side-steps">
          {steps.map((s, i) => (
            <li
              key={s}
              className={
                stageIndex === i ? 'current' : stageIndex > i ? 'done' : ''
              }
            >
              <span>
                {stageIndex > i ? (
                  <Check size={12} />
                ) : (
                  String(i + 1).padStart(2, '0')
                )}
              </span>
              {s}
            </li>
          ))}
        </ol>
        <div className="sidebar-bottom">
          <div className="single-label">
            <Users size={16} />
            <span>
              シングルプレー<small>あなた ＋ NPC 11球団</small>
            </span>
          </div>
          <div className="sidebar-note">
            ひとつの移籍が、
            <br />
            新しい物語のはじまりに。
          </div>
          <span className="version">UNOFFICIAL SIMULATOR · v0.1</span>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            FRONT OFFICE<span>/</span>
            <strong>現役ドラフト 2026</strong>
          </div>
          <div className="topbar-right">
            <span className="save-state">
              <span className="status-dot" />
              {storageError ? '保存できません' : '進行を自動保存'}
            </span>
            <button
              className="help-button"
              onClick={() => setModal('rules')}
              aria-label="ルールと遊び方"
            >
              <CircleHelp size={19} />
            </button>
          </div>
        </header>
        <main id="main-content">
          <CompactDetails
            compact={compact}
            title="選手データ・対象条件（仮判定）"
            className="data-disclosure"
          >
            <div className="data-notice">
              <Info size={15} />
              <span>
                {isReference
                  ? '現在は操作体験版です。選手は過去所属の参考データで、2026年の在籍・対象資格は未確認です。'
                  : isOfficial
                    ? `2026年推定年俸で仮判定。FA・前年現役ドラフト等を照合済み／契約条件未確認あり。名簿・成績：${dataset.asOf}取得。`
                    : `2026年データ：${dataset.label}（${dataset.asOf}時点・利用者による取り込み／自動照合なし）`}
              </span>
              <button onClick={() => setModal('data')}>
                データ詳細
                <ChevronRight size={13} />
              </button>
            </div>
            {game?.stage === 'nominate' && (
              <p className="transfer-rule-note">
                <strong>2026年の対象範囲変更：</strong>
                7月31日までに通常のトレード等で加入した選手も、他の条件を満たせば対象です。前年の現役ドラフトで加入した選手は対象外です。
                <a
                  href="https://www.nikkansports.com/baseball/news/202610140000570.html"
                  target="_blank"
                  rel="noreferrer"
                >
                  制度変更の出典
                </a>
              </p>
            )}
          </CompactDetails>
          {error && (
            <div className="error-message" role="alert">
              <Info size={17} />
              {error}
              <button
                className="icon-button"
                aria-label="通知を閉じる"
                onClick={() => setError('')}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {storageError && (
            <div className="error-message" role="alert">
              ブラウザへの保存に失敗しました。この画面を閉じると進行を引き継げない可能性があります。
            </div>
          )}

          {!game ? (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <div className="eyebrow">
                    <span />
                    THE NEXT CHAPTER STARTS WITH YOU
                  </div>
                  <h1>
                    その選択が、
                    <br />
                    選手の未来を変える。
                  </h1>
                  <p>
                    あなたが、球団の編成責任者。
                    <br />
                    12球団の思惑が交わる現役ドラフトへ。
                  </p>
                  <div className="hero-tags">
                    <span>
                      <Users size={13} />1 PLAYER + 11 NPCs
                    </span>
                    <span>
                      <Flag size={13} />
                      {isOfficial
                        ? '2026年公式名簿・成績'
                        : isReference
                          ? '操作体験用の参考データ'
                          : '2026年の取り込みデータ'}
                    </span>
                  </div>
                </div>
                <div className="hero-field">
                  <div className="field-caption">
                    A NEW OPPORTUNITY.
                    <br />
                    <strong>A NEW BEGINNING.</strong>
                  </div>
                  <Diamond />
                  <span className="field-footnote">
                    GENEKI DRAFT / FRONT OFFICE SIMULATION
                  </span>
                </div>
              </section>
              <section className="team-selection">
                <div className="section-heading">
                  <div>
                    <div className="step-label">
                      STEP 01 <span>球団選択</span>
                    </div>
                    <h2 ref={flowTarget} className="flow-target" tabIndex={-1}>
                      どの球団の未来を、つくりますか。
                    </h2>
                    <p>あなたが指揮する球団をひとつ選んでください。</p>
                  </div>
                  <div className="league-tabs" aria-label="リーグで絞り込み">
                    {['すべて', 'セ・リーグ', 'パ・リーグ'].map((l) => (
                      <button
                        key={l}
                        className={league === l ? 'selected' : ''}
                        onClick={() => setLeague(l)}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div
                  className="teams-grid"
                  role="group"
                  aria-label="操作する球団"
                >
                  {teams
                    .filter((t) => league === 'すべて' || t.league === league)
                    .map((t) => (
                      <button
                        key={t.id}
                        className={`team-card ${chosenTeam === t.id ? 'selected' : ''}`}
                        style={{ '--team-color': t.color } as CSSProperties}
                        onClick={() => setChosenTeam(t.id)}
                        aria-pressed={chosenTeam === t.id}
                      >
                        <div className="team-card-top">
                          <span>{t.league}</span>
                          <span className="selection-circle">
                            {chosenTeam === t.id && <Check size={12} />}
                          </span>
                        </div>
                        <TeamMark team={t} />
                        <span className="team-city">{t.city}</span>
                        <strong>{t.name}</strong>
                        <span className="team-card-bottom">
                          編成を担当する
                          <ArrowRight size={14} />
                        </span>
                      </button>
                    ))}
                </div>
              </section>
              <section className="selection-bar">
                <div className="selection-team">
                  <TeamMark team={team} small />
                  <div>
                    <span>YOUR TEAM</span>
                    <strong>{team.name}</strong>
                  </div>
                  <span className="gm-tag">あなたが編成責任者</span>
                </div>
                <button className="button primary" onClick={start}>
                  この球団ではじめる
                  <ArrowRight size={17} />
                </button>
              </section>
              <div className="home-details">
                <div>
                  <span className="detail-icon">
                    <ClipboardList size={20} />
                  </span>
                  <div>
                    <strong>候補提出から、あなたの判断で。</strong>
                    <p>出す選手と獲る選手。編成の駆け引きを体験。</p>
                  </div>
                </div>
                <div>
                  <span className="detail-icon">
                    <ShieldCheck size={20} />
                  </span>
                  <div>
                    <strong>ルールとデータは、透明に。</strong>
                    <p>公式情報との確認状況はガイドに明記。</p>
                  </div>
                </div>
                <button onClick={() => setModal('rules')}>
                  遊び方を読む
                  <ArrowUpRight size={15} />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="game-title">
                <div>
                  <div className="eyebrow dark">
                    YOUR FRONT OFFICE / {team.city}
                  </div>
                  <h1>
                    {game.stage === 'nominate'
                      ? 'チャンスを、次の場所へ。'
                      : game.stage === 'vote'
                        ? '新たな戦力を、見極める。'
                        : game.stage === 'round2' ||
                            game.stage === 'round2confirm'
                          ? 'もうひとつの、可能性。'
                          : game.stage === 'results'
                            ? '新しい物語が、動き出す。'
                            : '編成の未来を、指名する。'}
                  </h1>
                  <p>
                    {game.stage === 'nominate'
                      ? '自球団の支配下登録選手から、提出する候補を2名以上選んでください。'
                      : game.stage === 'vote'
                        ? '他球団の候補から、最も獲得したい選手に事前投票します。'
                        : game.stage === 'results'
                          ? 'あなたと11球団の判断で生まれた、今回の移籍を振り返ります。'
                          : game.stage === 'round2' ||
                              game.stage === 'round2confirm'
                            ? '第1巡が終了しました。第2巡の参加意向を選び、入札条件と希望順位を確認します。'
                            : `第${game.round}巡${game.round === 2 ? '（入札方式）' : '（暫定モデル）'}。指名された選手の所属球団へ、次の指名権が移ります。`}
                  </p>
                </div>
                <div className="presentation-controls">
                  <button
                    className="presentation-toggle"
                    aria-label="指名発表の演出"
                    aria-pressed={presentationEnabled && !reducedMotion}
                    disabled={reducedMotion}
                    title={
                      reducedMotion
                        ? 'ブラウザの「動きを減らす」設定に合わせて演出を省略しています'
                        : '指名発表の待ち時間と演出を切り替えます'
                    }
                    onClick={togglePresentation}
                  >
                    演出：
                    {presentationEnabled && !reducedMotion ? 'あり' : 'なし'}
                  </button>
                  <button
                    className="button ghost"
                    onClick={() => setModal('reset')}
                  >
                    <RotateCcw size={15} />
                    新しいドラフト
                  </button>
                </div>
              </div>
              <div className="game-layout">
                <div className="game-main">
                  {(game.stage === 'nominate' ||
                    game.stage === 'vote' ||
                    userTurn) && (
                    <section
                      className="panel roster-panel"
                      data-stage={game.stage}
                    >
                      <div className="panel-heading">
                        <div>
                          <h2
                            ref={flowTarget}
                            className="flow-target"
                            tabIndex={-1}
                          >
                            {game.stage === 'nominate'
                              ? '提出候補を選ぶ'
                              : game.stage === 'vote'
                                ? '獲得希望を選ぶ'
                                : 'あなたの指名番です'}
                            <span className="count">{roster.length}名</span>
                          </h2>
                          <p>
                            {game.stage === 'nominate'
                              ? '候補を2名以上選択してください。'
                              : game.stage === 'vote'
                                ? '予備指名した選手を指名できる場合、本指名でもその選手を獲得します。'
                                : '指名可能な候補から、獲得する選手を選んでください。'}
                          </p>
                        </div>
                        {userTurn && (
                          <span className="live-pill">
                            <span />
                            YOUR PICK
                          </span>
                        )}
                      </div>

                      {game.stage === 'nominate' && (
                        <button
                          className="excluded-toggle"
                          aria-pressed={showExcluded}
                          onClick={() => setShowExcluded(!showExcluded)}
                        >
                          {showExcluded
                            ? '仮対象だけを表示'
                            : '対象外・確認保留も表示'}
                        </button>
                      )}
                      <div className="roster-toolbar">
                        <label className="search-box">
                          <Search size={16} />
                          <input
                            aria-label="選手名で検索"
                            placeholder="選手名で検索"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </label>
                        <select
                          aria-label="守備位置で絞り込み"
                          value={position}
                          onChange={(e) =>
                            setPosition(e.target.value as Position | 'すべて')
                          }
                        >
                          <option value="すべて">すべての守備位置</option>
                          {positions.map((p) => (
                            <option key={p}>{p}</option>
                          ))}
                        </select>
                      </div>
                      <div className="roster-list">
                        {filteredRoster.length === 0 ? (
                          <div className="empty-state">
                            <Search size={25} />
                            <p>条件に合う選手がいません。</p>
                            <button
                              className="text-button"
                              onClick={() => {
                                setSearch('')
                                setPosition('すべて')
                              }}
                            >
                              絞り込みを解除
                            </button>
                          </div>
                        ) : (
                          filteredRoster.map((p) => {
                            const checked =
                              game.stage === 'nominate'
                                ? nominees.includes(p.id)
                                : game.stage === 'vote'
                                  ? votedId === p.id
                                  : selectedId === p.id
                            return (
                              <label
                                className={`player-row ${checked ? 'checked' : ''}`}
                                key={p.id}
                              >
                                <input
                                  type={
                                    game.stage === 'nominate'
                                      ? 'checkbox'
                                      : 'radio'
                                  }
                                  name="player"
                                  disabled={!eligibilityOf(p).allowed}
                                  checked={checked}
                                  onChange={() => {
                                    if (game.stage === 'nominate')
                                      setNominees((old) =>
                                        old.includes(p.id)
                                          ? old.filter((id) => id !== p.id)
                                          : [...old, p.id],
                                      )
                                    else if (game.stage === 'vote')
                                      setVotedId(p.id)
                                    else setSelectedId(p.id)
                                  }}
                                />
                                <span className="position-badge">
                                  {p.position === '内野手'
                                    ? '内'
                                    : p.position === '外野手'
                                      ? '外'
                                      : p.position[0]}
                                </span>
                                <span className="player-name">
                                  <strong>{p.name}</strong>
                                  <small className="player-affiliation">
                                    <span className="player-team-full">
                                      {teamById[p.team].name}
                                    </span>
                                    <span className="player-team-short">
                                      {teamById[p.team].short}
                                    </span>
                                    {p.number ? ` · #${p.number}` : ''}
                                  </small>
                                  {isOfficial && <StatSummary player={p} />}
                                  <small className="salary-info">
                                    {p.draftFacts?.salaryManYen == null ? (
                                      '2026年俸未確認'
                                    ) : (
                                      <>
                                        <span className="salary-year">
                                          2026
                                        </span>
                                        推定{' '}
                                        {p.draftFacts.salaryManYen.toLocaleString()}
                                        万円
                                      </>
                                    )}{' '}
                                    · {eligibilityOf(p).label}
                                  </small>
                                  {eligibilityOf(p).allowed &&
                                  p.draftFacts?.unresolved.length ? (
                                    <small className="player-contract-note">
                                      契約等未確認・仮判定
                                    </small>
                                  ) : null}
                                  {!eligibilityOf(p).allowed && (
                                    <small>
                                      {eligibilityOf(p).reasons.join(' / ')}
                                    </small>
                                  )}
                                  {p.draftFacts?.salarySource && (
                                    <a
                                      className="salary-source"
                                      href={p.draftFacts.salarySource}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      年俸出典
                                    </a>
                                  )}
                                </span>
                                <button
                                  type="button"
                                  className="player-details-button"
                                  aria-label={`${p.name}の詳細`}
                                  onClick={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    setDetailPlayerId(p.id)
                                    setModal('player')
                                  }}
                                >
                                  詳細
                                  <ChevronRight size={13} />
                                </button>
                                <span className="player-position">
                                  {p.position}
                                </span>
                                {game.stage !== 'nominate' && (
                                  <span className="fit-score">
                                    <small>ゲーム内適合度</small>
                                    <strong>
                                      {fit(p, team.id, game.seed)}
                                      <span>/100</span>
                                    </strong>
                                  </span>
                                )}
                                <span className="player-check">
                                  {checked ? <Check size={15} /> : <span />}
                                </span>
                              </label>
                            )
                          })
                        )}
                      </div>
                      {game.stage === 'nominate' &&
                        nominees.length > 0 &&
                        submissionErrors.length > 0 && (
                          <p className="nomination-error" role="status">
                            {submissionErrors.join(' ')}
                          </p>
                        )}
                      <div className="panel-footer">
                        <span>
                          {game.stage === 'nominate' ? (
                            <>
                              <strong>{nominees.length}名</strong> 選択中 /
                              2名以上
                            </>
                          ) : game.stage === 'vote' ? (
                            votedId ? (
                              `${player(votedId).name} に投票`
                            ) : (
                              '獲得希望を1名選んでください'
                            )
                          ) : selectedPlayer ? (
                            `${selectedPlayer.name} を獲得`
                          ) : (
                            '獲得する選手を選んでください'
                          )}
                        </span>
                        <button
                          className="button primary"
                          disabled={
                            game.stage === 'nominate'
                              ? submissionErrors.length > 0
                              : game.stage === 'vote'
                                ? !votedId
                                : !selectedId
                          }
                          onClick={() =>
                            act(() => {
                              if (game.stage === 'nominate')
                                setGame(
                                  submitNominations(game, nominees, players),
                                )
                              else if (game.stage === 'vote')
                                announce([
                                  {
                                    kind: 'order',
                                    game: beginDraft(game, votedId, players),
                                  },
                                ])
                              else
                                announce([
                                  {
                                    kind: 'pick',
                                    game: makePick(game, selectedId, players),
                                  },
                                ])
                            })
                          }
                        >
                          {game.stage === 'nominate'
                            ? '候補を提出する'
                            : game.stage === 'vote'
                              ? '投票してドラフトへ'
                              : 'この選手を指名'}
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    </section>
                  )}

                  {game.stage === 'draft' && !userTurn && (
                    <section className="panel npc-stage">
                      <div className="eyebrow dark">NOW ON THE CLOCK</div>
                      <TeamMark team={teamById[game.current!]} />
                      <h2
                        ref={flowTarget}
                        className="flow-target"
                        tabIndex={-1}
                      >
                        {teamById[game.current!].name}
                      </h2>
                      <p>NPCの編成責任者が、補強ポイントをもとに指名します。</p>
                      <span className="need-chip">
                        補強ポイント：{teamById[game.current!].need}{' '}
                        <span>ゲーム内設定</span>
                      </span>
                      <div className="npc-actions">
                        <button
                          className="button primary"
                          onClick={() =>
                            act(() =>
                              announce(npcAnnouncements(game, players, false)),
                            )
                          }
                        >
                          <Play size={15} />
                          NPCの指名を進める
                        </button>
                        <button
                          className="button ghost"
                          onClick={() =>
                            act(() =>
                              announce(npcAnnouncements(game, players, true)),
                            )
                          }
                        >
                          自分の番まで進める
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </section>
                  )}

                  {game.stage === 'round2' && (
                    <section className="panel round-two">
                      <span className="round-icon">
                        <Sparkles size={30} />
                      </span>
                      <span className="eyebrow dark">
                        SECOND ROUND / PARTICIPATION
                      </span>
                      <h2
                        ref={flowTarget}
                        className="flow-target"
                        tabIndex={-1}
                      >
                        第2巡の参加意向を選んでください
                      </h2>
                      <p>
                        残った候補選手で、もう一度補強を検討できます。
                        <br />
                        あなたが見送っても、参加するNPC同士の指名は進みます。
                      </p>
                      <div className="inline-notice">
                        <Info size={17} />
                        <span>
                          獲得希望・放出のみ・不参加の3区分から選び、参加状況を確認して入札します。参加確定後は不参加へ変更できません。
                        </span>
                      </div>
                      <div className="npc-actions">
                        <button
                          className="button primary"
                          onClick={() =>
                            act(() =>
                              setGame(startRoundTwo(game, true, players)),
                            )
                          }
                        >
                          獲得希望で参加する
                          <ArrowRight size={16} />
                        </button>
                        <button
                          className="button ghost"
                          onClick={() =>
                            act(() =>
                              setGame(startRoundTwo(game, false, players)),
                            )
                          }
                        >
                          自球団は参加を見送る
                        </button>
                        <button
                          className="button ghost"
                          onClick={() =>
                            act(() =>
                              setGame(startRoundTwo(game, 'supply', players)),
                            )
                          }
                        >
                          放出のみで参加する
                        </button>
                      </div>
                    </section>
                  )}

                  {game.stage === 'round2confirm' && game.roundTwo && (
                    <section className="panel round-two-confirm">
                      <div className="panel-heading">
                        <div>
                          <h2
                            ref={flowTarget}
                            className="flow-target"
                            tabIndex={-1}
                          >
                            参加状況と入札を確認
                          </h2>
                          <p>
                            参加確定後の辞退はできません。無条件入札が優先され、同条件は第1巡の実際の指名順の逆順で調整します。
                          </p>
                        </div>
                      </div>
                      <div className="round-two-body">
                        <label>
                          自球団の意向
                          <select
                            aria-label="第2巡の参加意向"
                            value={game.roundTwo.intents[team.id]}
                            onChange={(e) => {
                              setRoundPreferences([])
                              act(() =>
                                setGame(
                                  startRoundTwo(
                                    game,
                                    e.target.value as Participation,
                                    players,
                                  ),
                                ),
                              )
                            }}
                          >
                            <option value="buy">獲得希望で参加</option>
                            <option value="supply">放出のみで参加</option>
                            <option value="out">不参加</option>
                          </select>
                        </label>
                        <CompactDetails
                          compact={compact}
                          title="12球団の参加状況"
                          className="participation-disclosure"
                        >
                          <div className="participation-grid">
                            {teams.map((t) => (
                              <div key={t.id}>
                                <strong>{t.short}</strong>
                                <span>
                                  {game.roundTwo!.intents[t.id] === 'buy'
                                    ? '獲得希望'
                                    : game.roundTwo!.intents[t.id] === 'supply'
                                      ? '放出のみ'
                                      : '不参加'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </CompactDetails>
                        {game.roundTwo.intents[team.id] === 'buy' && (
                          <>
                            <label>
                              入札条件
                              <select
                                aria-label="第2巡の入札条件"
                                value={bidCondition}
                                onChange={(e) =>
                                  setBidCondition(
                                    e.target.value as BidCondition,
                                  )
                                }
                              >
                                <option value="unconditional">
                                  無条件（人数の増減を許容）
                                </option>
                                <option value="balanced">
                                  獲得・放出の人数が均衡するときだけ
                                </option>
                              </select>
                            </label>
                            <h3>獲得希望順</h3>
                            <p>
                              候補を選んだ順で入札します。上の希望から優先し、条件が合わなければ次の希望を検討します。
                            </p>
                            <ol className="bid-preferences">
                              {roundPreferences.map((id, i) => (
                                <li key={id}>
                                  {player(id).name}
                                  <button
                                    aria-label={`${player(id).name}の希望順位を上げる`}
                                    disabled={i === 0}
                                    onClick={() =>
                                      setRoundPreferences((old) => {
                                        const next = [...old]
                                        ;[next[i - 1], next[i]] = [
                                          next[i],
                                          next[i - 1],
                                        ]
                                        return next
                                      })
                                    }
                                  >
                                    ↑
                                  </button>
                                  <button
                                    aria-label={`${player(id).name}を希望から外す`}
                                    onClick={() =>
                                      setRoundPreferences((old) =>
                                        old.filter((v) => v !== id),
                                      )
                                    }
                                  >
                                    削除
                                  </button>
                                </li>
                              ))}
                            </ol>
                            <div className="second-round-choices">
                              {roundChoices.map((p) => (
                                <label key={p.id}>
                                  <input
                                    type="checkbox"
                                    checked={roundPreferences.includes(p.id)}
                                    onChange={() =>
                                      setRoundPreferences((old) =>
                                        old.includes(p.id)
                                          ? old.filter((id) => id !== p.id)
                                          : [...old, p.id],
                                      )
                                    }
                                  />
                                  <strong>{p.name}</strong>
                                  <span>
                                    {teamById[p.team].short} · {p.position}
                                  </span>
                                </label>
                              ))}
                            </div>
                            {roundChoices.length === 0 && (
                              <p>指名可能な他球団の候補がいません。</p>
                            )}
                          </>
                        )}
                        <p className="small-print">
                          参加確定後、NPCの入札と合わせて成立条件を判定します。指名が成立しない場合や、獲得のみ・放出のみになる場合もあります。
                        </p>
                        <button
                          className="button primary"
                          disabled={
                            game.roundTwo.intents[team.id] === 'buy' &&
                            roundChoices.length > 0 &&
                            roundPreferences.length === 0
                          }
                          onClick={() =>
                            act(() =>
                              announce([
                                {
                                  kind: 'round2',
                                  game: confirmRoundTwo(
                                    game,
                                    game.roundTwo!.intents[team.id] === 'buy'
                                      ? roundPreferences
                                      : [],
                                    bidCondition,
                                    players,
                                  ),
                                },
                              ]),
                            )
                          }
                        >
                          参加・入札を確定して結果を見る
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    </section>
                  )}
                  {game.stage === 'results' && (
                    <>
                      <section className="result-hero">
                        <div className="result-kicker">
                          <CheckCheck size={18} />
                          DRAFT COMPLETE
                        </div>
                        <h2
                          ref={flowTarget}
                          className="flow-target"
                          tabIndex={-1}
                        >
                          {team.short}の、新しい一歩。
                        </h2>
                        <p>あなたの指名で、新たなチャンスが生まれました。</p>
                        <div className="movement-grid">
                          {game.picks
                            .filter((p) => p.by === team.id)
                            .map((p) => (
                              <div className="movement" key={p.playerId}>
                                <span className="movement-label">
                                  <ArrowDownLeft size={16} />
                                  獲得 / 第{p.round}巡
                                </span>
                                <strong>{player(p.playerId).name}</strong>
                                <span>
                                  {teamById[p.from].short} → {team.short} ·{' '}
                                  {player(p.playerId).position}
                                </span>
                                <small>
                                  {player(p.playerId).position === team.need
                                    ? '設定した補強ポイントと一致'
                                    : '選手層を広げる新たな選択肢'}
                                </small>
                              </div>
                            ))}
                          {game.picks
                            .filter((p) => p.from === team.id)
                            .map((p) => (
                              <div
                                className="movement outgoing"
                                key={p.playerId}
                              >
                                <span className="movement-label">
                                  <ArrowUpRight size={16} />
                                  移籍 / 第{p.round}巡
                                </span>
                                <strong>{player(p.playerId).name}</strong>
                                <span>
                                  {team.short} → {teamById[p.by].short} ·{' '}
                                  {player(p.playerId).position}
                                </span>
                                <small>新しいチームでの挑戦へ</small>
                              </div>
                            ))}
                        </div>
                        <div className="result-buttons">
                          <button
                            className="button light"
                            onClick={exportResult}
                          >
                            <Download size={16} />
                            結果を保存
                          </button>
                          <button
                            className="button result-reset"
                            onClick={() => setModal('reset')}
                          >
                            <RotateCcw size={16} />
                            もう一度プレー
                          </button>
                        </div>
                      </section>
                      <section className="panel">
                        <div className="panel-heading">
                          <div>
                            <h2>12球団のドラフト結果</h2>
                            <p>
                              第1巡{' '}
                              {game.picks.filter((p) => p.round === 1).length}名
                              / 第2巡{' '}
                              {game.picks.filter((p) => p.round === 2).length}名
                            </p>
                          </div>
                          <Trophy size={21} />
                        </div>
                        <div className="table-scroll">
                          <table className="result-table">
                            <thead>
                              <tr>
                                <th>巡</th>
                                <th>獲得球団</th>
                                <th>選手</th>
                                <th>移籍元</th>
                              </tr>
                            </thead>
                            <tbody>
                              {game.picks.map((p, i) => (
                                <tr
                                  key={i}
                                  className={
                                    p.by === team.id ? 'your-result' : ''
                                  }
                                >
                                  <td>
                                    {p.round}
                                    <span>巡</span>
                                  </td>
                                  <td>
                                    <span className="table-team">
                                      <TeamMark team={teamById[p.by]} small />
                                      {teamById[p.by].short}
                                      {p.by === team.id && (
                                        <span className="you-tag">YOU</span>
                                      )}
                                    </span>
                                  </td>
                                  <td>
                                    <strong>{player(p.playerId).name}</strong>
                                    <small>{player(p.playerId).position}</small>
                                  </td>
                                  <td>{teamById[p.from].short}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    </>
                  )}

                  {game.picks.length > 0 && game.stage !== 'results' && (
                    <CompactDetails
                      compact={compact}
                      title={`指名履歴（${game.picks.length}件）`}
                      className="panel timeline-panel"
                    >
                      <div className="panel-heading">
                        <h2>指名のタイムライン</h2>
                        <span className="muted">{game.picks.length} PICKS</span>
                      </div>
                      <ol className="timeline">
                        {[...game.picks].reverse().map((p, i) => (
                          <li key={p.playerId}>
                            <span className="timeline-number">
                              {String(game.picks.length - i).padStart(2, '0')}
                            </span>
                            <div>
                              <span className="timeline-team">
                                {teamById[p.by].short}
                                {p.by === team.id && (
                                  <span className="you-tag">YOU</span>
                                )}
                                <span>第{p.round}巡で指名</span>
                              </span>
                              <strong>{player(p.playerId).name}</strong>
                              <small>
                                {teamById[p.from].short} →{' '}
                                {teamById[p.by].short} /{' '}
                                {player(p.playerId).position}
                              </small>
                            </div>
                            <Check size={15} />
                          </li>
                        ))}
                      </ol>
                    </CompactDetails>
                  )}
                </div>
                <CompactDetails
                  compact={compact}
                  title="球団情報・得票・編成のヒント"
                  className="aside-disclosure"
                >
                  <aside className="game-aside">
                    <section className="panel your-team">
                      <span className="eyebrow dark">YOUR TEAM</span>
                      <TeamMark team={team} />
                      <h3>{team.name}</h3>
                      <span className="gm-tag">編成責任者：あなた</span>
                      <div className="team-objective">
                        <span>ゲーム内の補強ポイント</span>
                        <strong>{team.need}</strong>
                        <p>{team.philosophy}</p>
                      </div>
                      {game.stage !== 'nominate' && (
                        <div className="submitted-list">
                          <span>提出した候補選手</span>
                          {game.offers[team.id]?.map((id) => (
                            <div key={id}>
                              <span>{player(id).name}</span>
                              <small>{player(id).position}</small>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                    {game.stage === 'draft' ||
                    game.stage === 'round2' ||
                    game.stage === 'round2confirm' ||
                    game.stage === 'results' ? (
                      <section className="panel vote-panel">
                        <div className="panel-heading">
                          <h3>第1巡の事前投票</h3>
                          <span>12票</span>
                        </div>
                        {[...teamIds]
                          .sort(
                            (a, b) =>
                              voteCount(game, b, players) -
                              voteCount(game, a, players),
                          )
                          .map((id) => (
                            <div className="vote-row" key={id}>
                              <span>{teamById[id].short}</span>
                              <span className="vote-bar">
                                <i
                                  style={{
                                    width: `${(voteCount(game, id, players) / 12) * 100}%`,
                                  }}
                                />
                              </span>
                              <strong>{voteCount(game, id, players)}</strong>
                            </div>
                          ))}
                        <p className="aside-footnote">
                          票は候補選手の所属球団に集計。同票は2026年の新人ドラフト第2巡の指名順です。
                        </p>
                      </section>
                    ) : (
                      <section className="panel tip-card">
                        <BookOpen size={20} />
                        <h3>編成のヒント</h3>
                        <p>
                          {game.stage === 'nominate'
                            ? '他球団に求められる選手を提出すると、最初の指名権を得られる可能性が高まります。残す戦力と、獲得のチャンスを考えてみましょう。'
                            : 'NPCは設定された補強ポイントを重視します。人気の集まる候補と、自球団に必要な選手が一致するとは限りません。'}
                        </p>
                        <button
                          className="text-button"
                          onClick={() => setModal('rules')}
                        >
                          進行ルールを見る
                          <ArrowUpRight size={14} />
                        </button>
                      </section>
                    )}
                  </aside>
                </CompactDetails>
              </div>
            </>
          )}
          <footer className="footer">
            <span>
              現役ドラフトルーム <b>2026</b>
            </span>
            <p>
              非公式ファンプロジェクト。NPB・各球団・選手とは関係ありません。
            </p>
            <button onClick={() => setModal('privacy')}>利用状況の計測</button>
            <button onClick={() => setModal('rules')}>
              ルールの確認状況
              <ArrowUpRight size={12} />
            </button>
          </footer>
        </main>
      </div>

      {announcements && (
        <DraftAnnouncement
          sequence={announcements}
          players={players}
          onCommit={setGame}
          onFinish={() => setAnnouncements(null)}
        />
      )}
      {modal === 'player' && detailPlayer && (
        <ModalShell
          title={`${detailPlayer.name}の詳細`}
          close={() => setModal(null)}
        >
          <p>
            {teamById[detailPlayer.team].name} / {detailPlayer.position}
            {detailPlayer.number ? ` / #${detailPlayer.number}` : ''}
          </p>
          {isOfficial && <StatSummary player={detailPlayer} />}
          <h3>2026年推定年俸</h3>
          <p>
            {detailPlayer.draftFacts?.salaryManYen == null
              ? '未確認'
              : `${detailPlayer.draftFacts.salaryManYen.toLocaleString()}万円`}
          </p>
          <h3>候補資格：{eligibilityOf(detailPlayer).label}</h3>
          {eligibilityOf(detailPlayer).reasons.length > 0 && (
            <ul>
              {eligibilityOf(detailPlayer).reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          <p>
            2026年推定年俸を使用した仮判定です。実際の候補リストを示すものではありません。
          </p>
          <h3>未確認の条件</h3>
          <ul>
            {eligibilityOf(detailPlayer).unresolved.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <div className="player-detail-sources">
            {detailPlayer.draftFacts?.salarySource && (
              <a
                className="source-link"
                href={detailPlayer.draftFacts.salarySource}
                target="_blank"
                rel="noreferrer"
              >
                年俸出典
                <ExternalLink size={14} />
              </a>
            )}
            {detailPlayer.sourceUrl && (
              <a
                className="source-link"
                href={detailPlayer.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                選手データの出典
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        </ModalShell>
      )}
      {modal === 'privacy' && (
        <ModalShell title="利用状況の計測について" close={() => setModal(null)}>
          <PrivacySettings />
        </ModalShell>
      )}
      {modal === 'reset' && (
        <ModalShell
          title="新しいドラフトを始めますか？"
          close={() => setModal(null)}
        >
          <p>
            現在の進行は消去され、球団選択に戻ります。使用する選手データは引き継ぎます。
          </p>
          <div className="modal-actions">
            <button className="button ghost" onClick={() => setModal(null)}>
              続ける
            </button>
            <button className="button primary" onClick={reset}>
              球団選択に戻る
              <ArrowRight size={16} />
            </button>
          </div>
        </ModalShell>
      )}
      {modal === 'rules' && (
        <ModalShell title="ルールと遊び方" close={() => setModal(null)}>
          <div className="inline-notice">
            <Info size={19} />
            <span>
              <strong>2026年推定年俸を用いた仮判定</strong>
              <br />
              新聞報道から2026年の対象範囲改定と2025年の第2巡変更を参照し、同票時の順位・予備指名の拘束・条件付き入札を実装しています。年俸は利用者の方針により2026年推定額で仮判定します。選手別の契約情報と入札の内部調整は完全再現を保証しません。
            </span>
          </div>
          <p>
            <a
              className="source-link"
              href="https://www.nikkansports.com/baseball/news/202610140000570.html"
              target="_blank"
              rel="noreferrer"
            >
              日刊スポーツ：2026年の対象範囲変更（10月14日）
              <ExternalLink size={14} />
            </a>
          </p>
          <p>
            <a
              className="source-link"
              href="https://www.daily.co.jp/baseball/2025/12/03/0019774070.shtml"
              target="_blank"
              rel="noreferrer"
            >
              デイリースポーツ：第2巡の参加と入札手順（2025年12月3日）
              <ExternalLink size={14} />
            </a>
          </p>
          <h3>シーズン中に移籍した選手は？</h3>
          <p>
            2026年10月の規定改定により、7月31日までに通常のトレード等で獲得した選手も、他の資格条件を満たせば対象です。前年の現役ドラフトで獲得した選手は引き続き対象外です。
            また、開催年の年度連盟選手権試合終了の翌日以降に契約譲渡で獲得した選手と、同じ基準日以降に育成から支配下へ移行した選手は除外されます。加入時期・契約等の選手別最終確認は残ります。
          </p>
          <p>
            <a
              className="source-link"
              href="https://news.infoseek.co.jp/article/sponichin_20261015_0022/"
              target="_blank"
              rel="noreferrer"
            >
              スポニチ：今年7月までに移籍した選手も対象（10月15日）
              <ExternalLink size={14} />
            </a>
          </p>
          <h3>ドラフトの流れ</h3>
          <ol className="guide-list">
            <li>
              <strong>候補提出</strong>
              <p>
                自球団から2名以上を選びます。NPC11球団はゲーム内適合度をもとに、各2名を提出します。
              </p>
            </li>
            <li>
              <strong>事前投票</strong>
              <p>
                他球団の候補に1票ずつ投票し、選手の所属球団ごとに集計します。最多票の球団が最初に指名。同票時は2026年新人ドラフト第2巡の指名順です。指名可能な予備指名先は本指名でも拘束されます。
              </p>
            </li>
            <li>
              <strong>第1巡の指名</strong>
              <p>
                指名された選手の元所属球団に、次の指名権が移ります。各球団が1名獲得・1名放出するまで進みます。一連の指名が閉じた場合は、未指名球団の投票順位から再開します。
              </p>
            </li>
            <li>
              <strong>第2巡の参加と入札</strong>
              <p>
                獲得希望・放出のみ・不参加を選び、参加状況を確認して確定します。獲得希望は順位と、無条件または人数均衡の条件を指定します。無条件、次に第1巡の実指名順の逆順を優先し、成立可能な組合せを探索します。NPCの意向と入札はゲーム内判断で、実際の内部調整結果を保証するものではありません。
              </p>
            </li>
          </ol>
          <h3>制度の調査と選手別の資格確認</h3>
          <p>
            年俸例外・FA資格・前年現役ドラフト・育成登録等を反映しています。年俸は2026年の推定額で仮判定し、5,000万円以上1億円未満を1名含める場合は、5,000万円未満が2名以上必要です。未確認の契約等は残ります。取り込みでは、利用者が資格を確認した選手だけを
            eligible: true にしてください。
          </p>
          <p>
            実際の候補リストや球団の判断を予測するものではありません。補強ポイント・NPCの選考・ゲーム内適合度は独自設定で、実際の編成方針・成績・選手評価ではありません。
          </p>
          <a
            className="source-link"
            href="https://npb.jp/geneki_draft/"
            target="_blank"
            rel="noreferrer"
          >
            NPB公式「現役ドラフト」結果ページ
            <ExternalLink size={14} />
          </a>
        </ModalShell>
      )}
      {modal === 'data' && (
        <ModalShell title="選手データと出典" close={() => setModal(null)}>
          <div className="data-summary">
            <Database size={24} />
            <div>
              <strong>{dataset.label}</strong>
              <span>
                {players.length}名 /{' '}
                {isReference
                  ? '手入力・未照合の参考データ'
                  : isOfficial
                    ? `${dataset.asOf}取得 / NPB公式・12球団`
                    : `${dataset.asOf}時点 / 利用者提供データ`}
              </span>
            </div>
            <span className="data-status">
              {isReference
                ? '参考版'
                : isOfficial
                  ? '公式名簿'
                  : '取り込み済み'}
            </span>
          </div>
          <h3>現在のデータについて</h3>
          <p>
            {isReference
              ? '操作確認のため、2024年前後の所属を参考に実在選手72名を手入力しています。2026年の所属・契約・引退・参加資格を反映したものではなく、球団ごとの全登録選手も収録していません。候補選手として表示されても、実際の提出可能性を示すものではありません。'
              : isOfficial
                ? `NPB公式サイトの2026年度名簿から${players.length}名を収録し、2026年度一軍成績を対応付けています。名簿・打撃・投手の計36ページを取得しました。育成登録選手は選択できません。2026年推定年俸、公式FA資格者、前年現役ドラフト加入者、育成登録、戦力外等の報道を候補判定に反映しました。外国出身で外国人区分未確認の選手も保留します。複数年契約・過去のFA行使・開催時の保留名簿は全選手の確認が完了していません。仮対象でも実際に提出できるとは限りません。`
                : '取り込まれたデータを使用しています。ファイルの形式は検証しますが、在籍・参加資格・出典の正確性は自動照合しません。'}
          </p>
          <p>
            年俸はgurazeni.comの2026年推定額を使用し、金額不明は補完せず候補を保留します。実際の翌季年俸による対象判定とは異なります。成績は公式ページの掲載値です。「ゲーム内適合度」は成績・守備位置・ゲーム内乱数から算出した独自スコア、NPCの補強方針は仮想設定です。
          </p>
          <h3>2026年データの取り込み</h3>
          <p>
            12球団それぞれ2名以上の候補対象選手が必要です。データはブラウザ内に保存され、サーバーには送信されません。球団選択画面でのみ差し替えできます。
          </p>
          <pre className="data-example">{`{ "version": 1, "season": 2026,\n  "label": "データ名", "asOf": "2026-10-24",\n  "sourceUrl": "https://npb.jp/…",\n  "players": [\n    { "id": "unique-id", "team": "t",\n      "name": "選手名", "position": "投手",\n      "eligible": true }\n  ] }`}</pre>
          <p className="small-print">
            球団ID：{teams.map((t) => `${t.id}=${t.short}`).join(' / ')}
            。守備位置：投手・捕手・内野手・外野手。eligible
            は参加資格を確認した選手のみ true にしてください。
          </p>
          <div className="import-actions">
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              aria-label="2026年の選手JSONファイル"
              onChange={(e) => void importFile(e.target.files?.[0])}
            />
            <button
              className="button primary"
              disabled={!!game}
              onClick={() => file.current?.click()}
            >
              <Upload size={16} />
              JSONを取り込む
            </button>
            <button
              className="button ghost"
              onClick={() =>
                download('players-2026-template.json', {
                  version: 1,
                  season: 2026,
                  label: '2026年・参加資格確認済み候補',
                  asOf: '2026-10-24',
                  sourceUrl: null,
                  players: [],
                })
              }
            >
              <Download size={16} />
              空のひな形
            </button>
          </div>
          {game && (
            <p className="small-print">
              取り込むには「新しいドラフト」で球団選択に戻ってください。
            </p>
          )}
          {importMessage && (
            <div className="inline-notice" role="status">
              {importMessage}
            </div>
          )}
          {!isOfficial && !game && (
            <button
              className="text-button"
              onClick={() => {
                setDataset(officialDataset)
                setImportMessage('NPB公式2026年度の名簿・成績に戻しました。')
              }}
            >
              公式名簿に戻す
              <RotateCcw size={14} />
            </button>
          )}
          <div className="source-list">
            <h3>公式情報と取得状況</h3>
            <a
              href="https://npb.jp/geneki_draft/"
              target="_blank"
              rel="noreferrer"
            >
              NPB 現役ドラフト（2025年度結果は取得済み）
              <ExternalLink size={13} />
            </a>
            <a
              href="https://npb.jp/bis/teams/"
              target="_blank"
              rel="noreferrer"
            >
              NPB 2026年度 球団別選手情報（取得済み）
              <ExternalLink size={13} />
            </a>
            {dataset.sourceUrl && !isOfficial && (
              <a href={dataset.sourceUrl} target="_blank" rel="noreferrer">
                取り込みデータの指定出典（利用者提供）
                <ExternalLink size={13} />
              </a>
            )}
          </div>
        </ModalShell>
      )}
    </div>
  )
}
