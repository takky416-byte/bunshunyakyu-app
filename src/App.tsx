import {
  useEffect,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
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
  Share2,
  Download,
  Home,
  Info,
  Play,
  RotateCcw,
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
  offeredPlayers,
  restoreGame,
  startRoundTwo,
  confirmRoundTwo,
  roundTwoChoices,
  submitNominations,
  voteCount,
  type Game,
} from './engine'
import { useRoom, rememberedName } from './useRoom'
import {
  RoomEntry,
  RoomLobby,
  RoomStatus,
  RoomWaiting,
  RoomChat,
} from './RoomUI'
import { PLAYER_NAME_KEY } from './room-contract'
import { eligibilityOf, nominationErrors } from './eligibility'
import type { Participation, BidCondition } from './roundTwo'
import { officialDataset } from './officialData'
import { recordedOfficialDataset } from './recordedDataset'
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
import {
  npcAnnouncements,
  roundTwoAnnouncements,
  type Announcement,
} from './announcements'
import Diamond from './Diamond'
import Splash, { needsSplash, SPLASH_KEY } from './Splash'
import ResultShare from './ResultShare'
import { usePageVisible } from './usePageVisible'
import { playerAge, playerCareerYears } from './playerBio'
import { DraftSound } from './draftSound'
import { draftSpeech } from './draftSpeech'
import { SoundControls, SoundSettings } from './SoundControls'
import { clubThemes, clubStyle, neutralClubTheme } from './presentation'

const ignoreRoomCommit = () => {}
const STORAGE_KEY = 'geneki-draft-room:v2'
type Modal =
  'rules' | 'data' | 'reset' | 'privacy' | 'player' | 'share' | 'sound' | null
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
        ? value.game && value.game.stage !== 'nominate'
          ? recordedOfficialDataset(value.dataset)
          : officialDataset
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
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function TeamMark({ team, small = false }: { team: Team; small?: boolean }) {
  return (
    <span
      className={`team-mark ${small ? 'small' : ''}`}
      style={{ '--team-color': clubThemes[team.id].accent } as CSSProperties}
      aria-hidden="true"
    >
      {team.mark}
      <span>BASEBALL</span>
    </span>
  )
}
function PlayerFacts({ player }: { player: Player }) {
  const age = playerAge(player.birthDate)
  const careerYears = playerCareerYears(player)
  return (
    <small className="salary-info">
      <span>
        {player.draftFacts?.salaryManYen == null
          ? '年俸データなし'
          : `${player.draftFacts.salaryManYen.toLocaleString()}万円`}
      </span>
      <span className="player-age-career">
        <span className="player-age">
          {age == null ? '年齢 —' : `${age}歳`}
        </span>
        <span className="player-career">
          {careerYears == null ? 'プロ年数 —' : `プロ${careerYears}年目`}
        </span>
      </span>
      {eligibilityOf(player).band === 'exception' && <span>高年俸枠</span>}
    </small>
  )
}
function StatSummary({
  player,
  compact = false,
}: {
  player: Player
  compact?: boolean
}) {
  const s = player.stats
  const label = compact ? '一軍' : '2026年 一軍成績'
  const noAppearances = !s || s.games === 0
  const stats = noAppearances
    ? ['一軍出場なし']
    : player.position === '投手'
      ? [
          `${s.games}登板`,
          `防御率 ${s.era == null ? '—' : s.era.toFixed(2)}`,
          `${s.wins ?? '—'}勝${s.losses ?? '—'}敗`,
          ...(s.saves ? [`${s.saves}セーブ`] : []),
        ]
      : [
          `${s.games}試合`,
          `打率 ${s.average == null ? '—' : s.average.toFixed(3).replace(/^0\./, '.')}`,
          `${s.homeRuns ?? '—'}本`,
          `${s.rbi ?? '—'}打点`,
        ]
  return (
    <span className="player-stats" title="2026年一軍成績">
      {(!compact || !noAppearances) && <b>{label}</b>}
      {stats.map((stat) => (
        <span key={stat}>{stat}</span>
      ))}
    </span>
  )
}
function PlayerSelectionFacts({ player }: { player: Player }) {
  return (
    <span className="player-selection-facts">
      <PlayerFacts player={player} />
      <StatSummary player={player} compact />
    </span>
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
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault()
          event.stopPropagation()
          close()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
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
  'ルームに参加',
  '候補を提出',
  '希望を投票',
  'ドラフト',
  '結果を見る',
]

export default function App() {
  const room = useRoom()
  const [playerName, setPlayerName] = useState(rememberedName)
  const [roomCode, setRoomCode] = useState('')
  const [roomChatOpen, setRoomChatOpen] = useState(false)
  const [roomPending, setRoomPending] = useState(false)
  const [lastReadMessage, setLastReadMessage] = useState('')
  const receivedPresentation = useRef('')
  const reportedPlayback = useRef('')
  const receivedPhase = useRef('')
  const trackedRoom = useRef('')
  const isRoom = Boolean(room.session)
  const roomState = room.snapshot
  const roomMe = roomState?.members.find((m) => m.id === roomState.me)
  const unreadMessages = roomState
    ? (() => {
        const messages = roomState.messages.filter((m) => m.kind !== 'system')
        const seen = messages.findIndex((m) => m.id === lastReadMessage)
        return roomChatOpen ? 0 : messages.length - (seen + 1)
      })()
    : 0
  useEffect(() => {
    if (roomChatOpen)
      setLastReadMessage(
        roomState?.messages.filter((m) => m.kind !== 'system').at(-1)?.id ?? '',
      )
  }, [roomChatOpen, roomState?.messages])
  const [sound] = useState(() => new DraftSound())
  const soundState = useSyncExternalStore(sound.subscribe, sound.getSnapshot)
  useEffect(sound.mount, [sound])
  const [initial] = useState(load)
  const [showSplash, setShowSplash] = useState(needsSplash)
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
  const [position, setPosition] = useState<Position | 'すべて'>('すべて')
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
  const [autoPlay, setAutoPlay] = useState(() => {
    try {
      return localStorage.getItem('geneki-draft:autoplay:v1') !== 'off'
    } catch {
      return true
    }
  })
  const pageVisible = usePageVisible()
  const roomHumanCount = roomState?.members.filter((m) => !m.cpu).length ?? 0
  const reportPlayback = useCallback(
    (id: string) => {
      if (reportedPlayback.current === id) return
      reportedPlayback.current = id
      void room.send({ type: 'playback', presentationId: id }).catch(() => {
        if (reportedPlayback.current === id) reportedPlayback.current = ''
      })
    },
    [room.send],
  )
  const completePlayback = useCallback(() => {
    if (roomState?.presentation) reportPlayback(roomState.presentation.id)
  }, [roomState?.presentation?.id, reportPlayback])
  const finishAnnouncements = useCallback(() => {
    setAnnouncements(null)
    if (!roomState?.presentation) return
    if (roomHumanCount === 1)
      void room
        .send({ type: 'presented', presentationId: roomState.presentation.id })
        .catch(() => {})
    else reportPlayback(roomState.presentation.id)
  }, [room.send, roomState?.presentation?.id, roomHumanCount, reportPlayback])
  const changeAutoPlay = useCallback((enabled: boolean) => {
    setAutoPlay(enabled)
    try {
      localStorage.setItem('geneki-draft:autoplay:v1', enabled ? 'on' : 'off')
    } catch {
      /* usable without storage */
    }
  }, [])
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const file = useRef<HTMLInputElement>(null)
  const team = teamById[game?.userTeam ?? chosenTeam]
  const themeId =
    roomState && !roomState.game ? (roomMe?.team ?? null) : team.id
  const players = dataset.players
  const isReference = dataset.kind === 'reference'
  const isOfficial = dataset.kind === 'official-roster'
  const stageIndex = !game
    ? 0
    : game.stage === 'nominate'
      ? 1
      : game.stage === 'vote'
        ? 2
        : game.stage === 'results' && !roomState?.presentation
          ? 4
          : 3
  const selectedPlayer = players.find((p) => p.id === selectedId)
  const detailPlayer = players.find((p) => p.id === detailPlayerId)
  const userTurn = game?.stage === 'draft' && game.current === game.userTeam
  const player = (id: string) => players.find((p) => p.id === id)!
  const flowKey = game
    ? `${game.seed}:${game.stage}:${game.current ?? ''}:${game.picks.length}:${roomState?.submitted.includes(team.id) ? 'waiting' : ''}:${roomState?.paused ? 'paused' : ''}:${roomState?.presentation ? 'presenting' : ''}`
    : roomState
      ? `${roomState.code}:lobby`
      : 'home'
  const previousFlow = useRef(flowKey)
  const pendingFlowFocus = useRef(Boolean(initial.game || room.session))

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const change = () => setCompact(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    if (previousFlow.current !== flowKey) pendingFlowFocus.current = true
    previousFlow.current = flowKey
    if (
      showSplash ||
      modal ||
      roomChatOpen ||
      announcements ||
      !pendingFlowFocus.current
    )
      return
    const frame = requestAnimationFrame(() => {
      pendingFlowFocus.current = false
      const target = flowTarget.current
      if (!target) return
      document
        .querySelector('.roster-list')
        ?.scrollTo({ top: 0, behavior: 'auto' })
      target.focus({ preventScroll: true })
      const scrollTarget =
        !game && roomState
          ? (document.querySelector('.room-status') ?? target)
          : target
      scrollTarget.scrollIntoView({ block: 'start', behavior: 'auto' })
    })
    return () => cancelAnimationFrame(frame)
  }, [flowKey, modal, roomChatOpen, announcements, showSplash])

  function enterApp() {
    try {
      sessionStorage.setItem(SPLASH_KEY, 'seen')
    } catch {
      /* usable with unavailable storage */
    }
    pendingFlowFocus.current = true
    setShowSplash(false)
  }
  useEffect(() => {
    if (
      isRoom ||
      !autoPlay ||
      !pageVisible ||
      !game ||
      game.stage !== 'draft' ||
      game.current === game.userTeam ||
      announcements ||
      modal ||
      showSplash
    )
      return
    try {
      const sequence = npcAnnouncements(game, players, true)
      if (!sequence.length) return
      if (presentationEnabled && !reducedMotion) setAnnouncements(sequence)
      else {
        setGame(sequence.at(-1)!.game)
        sound.speak(sequence.flatMap((item) => draftSpeech(item, players)))
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : '指名を進められませんでした。',
      )
    }
  }, [
    isRoom,
    autoPlay,
    pageVisible,
    game,
    players,
    announcements,
    modal,
    showSplash,
    presentationEnabled,
    reducedMotion,
    sound,
  ])
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    )
    if (meta)
      meta.content =
        themeId === null ? neutralClubTheme.deep : clubThemes[themeId].deep
  }, [themeId])

  useEffect(() => {
    if (isRoom) return
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ dataset, game, chosenTeam, trackedPlay }),
      )
      setStorageError(false)
    } catch {
      setStorageError(true)
    }
  }, [dataset, game, chosenTeam, trackedPlay, isRoom])
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
      setPosition('すべて')
    } catch (e) {
      setError(e instanceof Error ? e.message : '処理に失敗しました。')
    }
  }
  function announce(sequence: Announcement[]) {
    if (!sequence.length) return
    if (presentationEnabled && !reducedMotion) setAnnouncements(sequence)
    else {
      setGame(sequence.at(-1)!.game)
      sound.speak(sequence.flatMap((item) => draftSpeech(item, players)))
    }
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
  async function roomAction(action: Parameters<typeof room.send>[0]) {
    setRoomPending(true)
    setError('')
    try {
      await room.send(action)
      setSelectedId('')
      setPosition('すべて')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRoomPending(false)
    }
  }
  useEffect(() => {
    if (!roomState) return
    setDataset(officialDataset)
    if (roomMe?.team) setChosenTeam(roomMe.team)
    setGame(roomState.game)
    const phaseKey = roomState.code + ':' + roomState.phase
    if (receivedPhase.current !== phaseKey) {
      receivedPhase.current = phaseKey
      setNominees([])
      setVotedId('')
      setSelectedId('')
      setRoundPreferences([])
      setPosition('すべて')
    }
    const presentation = roomState.presentation
    if (presentation && presentation.id !== receivedPresentation.current) {
      receivedPresentation.current = presentation.id
      if (roomState.game) {
        const item: Announcement = {
          kind: presentation.kind,
          game: roomState.game,
          ...(presentation.pickIndex === undefined
            ? {}
            : { pickIndex: presentation.pickIndex }),
        }
        if (presentationEnabled && !reducedMotion) setAnnouncements([item])
        else {
          const playback = sound.speak(
            draftSpeech(item, officialDataset.players),
          )
          if (roomHumanCount > 1 || autoPlay)
            void playback.finished
              .then(() =>
                !document.hidden
                  ? roomHumanCount > 1
                    ? reportPlayback(presentation.id)
                    : room.send({
                        type: 'presented',
                        presentationId: presentation.id,
                      })
                  : undefined,
              )
              .catch(() => {})
        }
      }
    } else if (!presentation) setAnnouncements(null)
    if (roomState.game) {
      const key = roomState.code + ':' + roomState.me
      if (trackedRoom.current !== key) {
        trackedRoom.current = key
        let tracked: TrackedPlay | null = null
        try {
          const saved = JSON.parse(
            localStorage.getItem('geneki-draft:room-tracking:v1') ?? 'null',
          )
          if (
            saved?.key === key &&
            validTrackedPlay(saved.tracked) &&
            privacyStatus() === 'enabled'
          )
            tracked = saved.tracked
        } catch {
          /* unavailable storage */
        }
        tracked ??= trackPlayStarted(roomState.game.userTeam)
        setTrackedPlay(tracked)
        try {
          localStorage.setItem(
            'geneki-draft:room-tracking:v1',
            JSON.stringify({ key, tracked }),
          )
        } catch {
          /* unavailable storage */
        }
      }
    }
  }, [
    roomState,
    roomMe?.team,
    roomHumanCount,
    room.send,
    reportPlayback,
    autoPlay,
    presentationEnabled,
    reducedMotion,
    sound,
  ])
  useEffect(() => {
    if (!room.fatal) return
    setAnnouncements(null)
    setRoomChatOpen(false)
    setModal(null)
    sound.stopSpeech()
    sound.stopEffects()
  }, [room.fatal, sound])
  async function reset() {
    if (isRoom) {
      try {
        await room.leave()
      } catch (e) {
        setError((e as Error).message)
        setModal(null)
        return
      }
    }
    clearDraft()
  }
  function clearDraft() {
    setRoomChatOpen(false)
    setLastReadMessage('')
    sound.stopSpeech()
    sound.stopEffects()
    if (dataset.kind === 'official-roster') setDataset(officialDataset)
    setDetailPlayerId('')
    setAnnouncements(null)
    setGame(null)
    setTrackedPlay(null)
    setNominees([])
    setRoundPreferences([])
    setVotedId('')
    setSelectedId('')
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
      if (isRoom)
        throw new Error('ルームでは全員が共通の2026年選手データを使用します。')
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
    (p) => position === 'すべて' || p.position === position,
  )
  const roomWaiting = Boolean(
    roomState &&
    roomMe &&
    (roomState.paused ||
      Boolean(roomState.presentation && !announcements) ||
      (['nominate', 'vote', 'round2', 'round2confirm'].includes(
        game?.stage ?? '',
      ) &&
        roomMe.team !== null &&
        roomState.submitted.includes(roomMe.team))),
  )
  const roomBlocked =
    isRoom &&
    (!room.connected ||
      roomPending ||
      Boolean(roomState?.paused) ||
      Boolean(roomState?.presentation))
  const progressStep =
    !game || game.stage === 'nominate'
      ? 0
      : game.stage === 'vote'
        ? 1
        : game.stage === 'results' && !roomState?.presentation
          ? 3
          : 2

  return (
    <div
      className="app-shell"
      style={clubStyle(themeId) as CSSProperties}
      data-team={themeId ?? 'unselected'}
      data-playing={Boolean(game)}
      data-room={isRoom}
    >
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
            <span className="single-label-copy">
              <span className="single-label-title">
                <span>{isRoom ? 'ルームで' : '仲間と、'}</span>
                <span>{isRoom ? 'プレー' : '1人でも。'}</span>
              </span>
              <small>
                <span>
                  {isRoom && !game
                    ? `${roomState?.members.length ?? 1}人参加`
                    : isRoom
                      ? `${roomState?.members.filter((m) => !m.cpu).length ?? 1}人＋`
                      : '1〜12人'}
                </span>
                <span>
                  {isRoom && !game
                    ? '球団を選んで開始'
                    : isRoom
                      ? `CPU ${12 - (roomState?.members.filter((m) => !m.cpu).length ?? 1)}球団`
                      : '空席はCPU'}
                </span>
              </small>
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
              {isRoom
                ? room.connected
                  ? 'ルームに接続中'
                  : '再接続中…'
                : storageError
                  ? '保存できません'
                  : '進行を自動保存'}
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
            title="選手データとルール"
            className="data-disclosure"
          >
            <div className="data-notice">
              <Info size={15} />
              <span>
                {isReference
                  ? '過去所属の参考データを使用しています。'
                  : isOfficial
                    ? `2026年推定年俸と公表情報を使用。名簿・成績：${dataset.asOf}取得。`
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
              </p>
            )}
            {game?.stage === 'nominate' && (
              <button
                className="excluded-toggle"
                aria-pressed={showExcluded}
                onClick={() => setShowExcluded(!showExcluded)}
              >
                {showExcluded ? '対象選手だけを表示' : '対象外も表示'}
              </button>
            )}
          </CompactDetails>
          {(error || room.error) && (
            <div className="error-message" role="alert">
              <Info size={17} />
              {error || room.error}
              <button
                className="icon-button"
                aria-label="通知を閉じる"
                onClick={() => {
                  setError('')
                  room.setError('')
                }}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {(isRoom ? room.storageError : storageError) && (
            <div className="error-message" role="alert">
              {isRoom
                ? 'このブラウザに参加情報を保存できません。再読み込みや画面を閉じると、元の球団に戻れない場合があります。'
                : 'ブラウザへの保存に失敗しました。この画面を閉じると進行を引き継げない可能性があります。'}
            </div>
          )}

          {roomState && !room.fatal && (
            <RoomStatus
              room={room}
              onChat={() => setRoomChatOpen(true)}
              unread={unreadMessages}
            />
          )}
          {room.session && (!roomState || room.fatal) ? (
            <section className="panel room-loading">
              <h2>
                {room.fatal
                  ? 'ルームを確認してください'
                  : 'ルームに接続しています…'}
              </h2>
              <p>
                {room.fatal
                  ? '新しいルームを作成するか、有効な番号で参加できます。'
                  : '再読み込み後も、担当球団と進行を引き継ぎます。'}
              </p>
              <button
                className="button ghost"
                disabled={room.busy}
                onClick={() => {
                  if (room.fatal) {
                    room.clear()
                    clearDraft()
                  } else void reset()
                }}
              >
                {room.fatal
                  ? 'ホームに戻る'
                  : room.busy
                    ? '退出しています…'
                    : '接続を中止して退出する'}
              </button>
            </section>
          ) : roomState && !game ? (
            <>
              <RoomLobby headingRef={flowTarget} room={room} />
              <div className="room-exit">
                <button
                  className="button ghost"
                  onClick={() => setModal('reset')}
                >
                  ルームを退出する
                </button>
              </div>
            </>
          ) : !game ? (
            <>
              <section className="hero concept-intro">
                <div className="hero-copy">
                  <span className="concept-label">
                    2026 現役ドラフトシミュレーション
                  </span>
                  {!isOfficial && (
                    <p>新しいルームでは公式2026年データを使用します。</p>
                  )}
                  <h1
                    ref={flowTarget}
                    className="flow-target"
                    tabIndex={-1}
                    aria-label="現役ドラフトのGM体験"
                  >
                    <span className="text-unit">現役ドラフトの</span>
                    <span className="text-unit">GM体験</span>
                  </h1>
                  <p>
                    好きな球団の編成責任者に。仲間と、1人でも。空席はCPUが担当します。
                  </p>
                </div>
                <Diamond className="concept-diamond" />
              </section>
              <RoomEntry
                name={playerName}
                setName={(name) => {
                  setPlayerName(name)
                  try {
                    localStorage.setItem(PLAYER_NAME_KEY, name)
                  } catch {
                    /* memory-only */
                  }
                }}
                code={roomCode}
                setCode={setRoomCode}
                busy={room.busy}
                create={() => void room.enter(playerName)}
                join={() => void room.enter(playerName, roomCode)}
              />
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
                    {roomState?.presentation?.kind === 'round2'
                      ? '第2巡の指名発表'
                      : `${team.short}のドラフト`}
                  </h1>
                  <p>
                    {roomState?.presentation?.kind === 'round2'
                      ? '成立した指名を順番に発表しています。すべての発表が終わると最終結果へ進みます。'
                      : game.stage === 'nominate'
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
                  <SoundControls
                    sound={sound}
                    onSettings={() => setModal('sound')}
                  />
                  <button
                    className="presentation-toggle autoplay-toggle"
                    aria-label={
                      isRoom && roomHumanCount > 1
                        ? '発表を自動で閉じる'
                        : '指名発表の自動送り'
                    }
                    aria-pressed={autoPlay}
                    onClick={() => changeAutoPlay(!autoPlay)}
                  >
                    {isRoom && roomHumanCount > 1
                      ? '発表を自動で閉じる'
                      : '自動送り'}
                    ：{autoPlay ? 'オン' : 'オフ'}
                  </button>
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
                    {isRoom ? 'ルームを退出する' : '新しいドラフト'}
                  </button>
                </div>
              </div>
              <nav className="play-progress" aria-label="プレーの流れ">
                <ol>
                  {['候補提出', '希望投票', '指名', '結果'].map((label, i) => (
                    <li
                      key={label}
                      aria-current={progressStep === i ? 'step' : undefined}
                      className={progressStep > i ? 'complete' : ''}
                    >
                      <span>
                        {progressStep > i ? <Check size={12} /> : i + 1}
                      </span>
                      {label}
                    </li>
                  ))}
                </ol>
              </nav>
              <div className="game-layout">
                <div className="game-main">
                  {roomWaiting && roomState && (
                    <RoomWaiting headingRef={flowTarget} state={roomState} />
                  )}
                  {!roomWaiting &&
                    (game.stage === 'nominate' ||
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
                                ? '移籍候補を2名以上選んでください。'
                                : game.stage === 'vote'
                                  ? '獲得したい選手を1名選んでください。'
                                  : roster.length === 1
                                    ? '指名できる選手は1人です。選んで「この選手を指名」を押してください。'
                                    : '獲得する選手を1人選び、「この選手を指名」を押してください。'}
                            </p>
                          </div>
                          {userTurn && (
                            <span className="live-pill">
                              <span />
                              YOUR PICK
                            </span>
                          )}
                        </div>

                        <div className="roster-toolbar">
                          <label htmlFor="position-filter">守備位置</label>
                          <select
                            id="position-filter"
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
                              <p>条件に合う選手がいません。</p>
                              <button
                                className="text-button"
                                onClick={() => {
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
                                    disabled={
                                      game.stage === 'nominate' &&
                                      !eligibilityOf(p).allowed
                                    }
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
                                    <PlayerSelectionFacts player={p} />
                                    {!eligibilityOf(p).allowed && (
                                      <small>
                                        {game.stage === 'nominate'
                                          ? eligibilityOf(p).reasons.join(' / ')
                                          : '提出済み候補（提出時点の条件で進行）'}
                                      </small>
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
                              roomBlocked ||
                              (game.stage === 'nominate'
                                ? submissionErrors.length > 0
                                : game.stage === 'vote'
                                  ? !votedId
                                  : !selectedId)
                            }
                            onClick={() =>
                              act(() => {
                                if (isRoom) {
                                  void roomAction(
                                    game.stage === 'nominate'
                                      ? { type: 'nominate', players: nominees }
                                      : game.stage === 'vote'
                                        ? { type: 'vote', player: votedId }
                                        : { type: 'pick', player: selectedId },
                                  )
                                  return
                                }
                                if (game.stage === 'nominate')
                                  announce([
                                    {
                                      kind: 'nominations',
                                      game: submitNominations(
                                        game,
                                        nominees,
                                        players,
                                      ),
                                    },
                                  ])
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
                                ? isRoom
                                  ? '事前投票を確定する'
                                  : '投票してドラフトへ'
                                : 'この選手を指名'}
                            <ArrowRight size={16} />
                          </button>
                        </div>
                      </section>
                    )}

                  {game.stage === 'draft' && !userTurn && !roomWaiting && (
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
                      <p>
                        {isRoom
                          ? `${roomState?.members.find((m) => m.team === game.current && !m.cpu)?.name ?? 'CPU'}が指名を選んでいます。指名が確定すると自動で発表します。`
                          : autoPlay
                            ? 'CPUの指名を自動で発表します。あなたの指名番で止まります。'
                            : '次はCPU球団の番です。指名を1球団ずつ確認するか、自分の番まで進めてください。'}
                      </p>
                      {!isRoom && (
                        <div className="npc-actions">
                          <button
                            className="button primary"
                            onClick={() =>
                              act(() =>
                                announce(
                                  npcAnnouncements(game, players, false),
                                ),
                              )
                            }
                          >
                            <Play size={15} />
                            CPUの指名を進める
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
                      )}
                    </section>
                  )}

                  {game.stage === 'round2' && !roomWaiting && (
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
                        もう1人の獲得を狙うか、ここで補強を終えるかを選びます。
                        <br />
                        {isRoom
                          ? 'あなたが見送っても、参加する他球団の指名は進みます。'
                          : 'あなたが見送っても、参加するCPU同士の指名は進みます。'}
                      </p>
                      <div className="inline-notice">
                        <Info size={17} />
                        <span>
                          {isRoom
                            ? '全員の参加意向が揃ったら、獲得希望の球団が入札します。確定後の参加意向は変更できません。'
                            : '「獲得希望」は追加の補強、「放出のみ」は他球団への移籍を認める選択です。次の画面で最終確認できます。'}
                        </span>
                      </div>
                      <div className="npc-actions">
                        <button
                          disabled={roomBlocked}
                          className="button primary"
                          onClick={() =>
                            act(() =>
                              isRoom
                                ? void roomAction({
                                    type: 'intent',
                                    intent: 'buy',
                                  })
                                : setGame(startRoundTwo(game, true, players)),
                            )
                          }
                        >
                          獲得希望で参加する
                          <ArrowRight size={16} />
                        </button>
                        <button
                          disabled={roomBlocked}
                          className="button ghost"
                          onClick={() =>
                            act(() =>
                              isRoom
                                ? void roomAction({
                                    type: 'intent',
                                    intent: 'out',
                                  })
                                : setGame(startRoundTwo(game, false, players)),
                            )
                          }
                        >
                          自球団は参加を見送る
                        </button>
                        <button
                          disabled={roomBlocked}
                          className="button ghost"
                          onClick={() =>
                            act(() =>
                              isRoom
                                ? void roomAction({
                                    type: 'intent',
                                    intent: 'supply',
                                  })
                                : setGame(
                                    startRoundTwo(game, 'supply', players),
                                  ),
                            )
                          }
                        >
                          放出のみで参加する
                        </button>
                      </div>
                    </section>
                  )}

                  {game.stage === 'round2confirm' &&
                    game.roundTwo &&
                    !roomWaiting && (
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
                              獲得希望なら候補を希望順に選び、内容を確定してください。
                              <span className="text-unit">確定後は</span>
                              <span className="text-unit">
                                変更できません。
                              </span>
                            </p>
                          </div>
                        </div>
                        <div className="round-two-body">
                          <label>
                            自球団の意向
                            <select
                              aria-label="第2巡の参加意向"
                              value={game.roundTwo.intents[team.id]}
                              disabled={isRoom}
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
                                      : game.roundTwo!.intents[t.id] ===
                                          'supply'
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
                                    無条件（放出なしでも獲得する）
                                  </option>
                                  <option value="balanced">
                                    獲得・放出が両方成立するときだけ
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
                                    <div className="bid-preference-row">
                                      <span className="bid-preference-player">
                                        <strong>{player(id).name}</strong>
                                        <PlayerSelectionFacts
                                          player={player(id)}
                                        />
                                      </span>
                                      <span className="bid-preference-actions">
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
                                      </span>
                                    </div>
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
                                    <span className="bid-player">
                                      <span className="bid-player-heading">
                                        <strong>{p.name}</strong>
                                        <span className="bid-player-team">
                                          {teamById[p.team].short} ·{' '}
                                          {p.position}
                                        </span>
                                      </span>
                                      <PlayerSelectionFacts player={p} />
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
                            全員の入札が揃うと成立条件を判定します。指名が成立しない場合や、獲得のみ・放出のみになる場合もあります。
                          </p>
                        </div>
                        <div className="panel-footer">
                          <button
                            className="button primary"
                            disabled={
                              roomBlocked ||
                              (game.roundTwo.intents[team.id] === 'buy' &&
                                roundChoices.length > 0 &&
                                roundPreferences.length === 0)
                            }
                            onClick={() =>
                              act(() =>
                                isRoom
                                  ? void roomAction({
                                      type: 'bid',
                                      preferences:
                                        game.roundTwo!.intents[team.id] ===
                                        'buy'
                                          ? roundPreferences
                                          : [],
                                      condition: bidCondition,
                                    })
                                  : announce(
                                      roundTwoAnnouncements(
                                        confirmRoundTwo(
                                          game,
                                          game.roundTwo!.intents[team.id] ===
                                            'buy'
                                            ? roundPreferences
                                            : [],
                                          bidCondition,
                                          players,
                                        ),
                                      ),
                                    ),
                              )
                            }
                          >
                            {isRoom
                              ? '入札を確定する'
                              : '参加・入札を確定して結果を見る'}
                            <ArrowRight size={16} />
                          </button>
                        </div>
                      </section>
                    )}
                  {game.stage === 'results' && !roomWaiting && (
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
                          {team.short}の獲得・放出
                        </h2>
                        <p>今回の結果を振り返り、ブログなどで共有できます。</p>
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
                            onClick={() => setModal('share')}
                          >
                            <Share2 size={16} />
                            プレー結果を共有
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
                  title="球団情報・得票"
                  className="aside-disclosure"
                >
                  <aside className="game-aside">
                    <section className="panel your-team">
                      <span className="eyebrow dark">YOUR TEAM</span>
                      <TeamMark team={team} />
                      <h3>{team.name}</h3>
                      <span className="gm-tag">
                        編成責任者：{roomMe?.name ?? 'あなた'}
                      </span>
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
                        <h3>指名のヒント</h3>
                        <p>
                          {game.stage === 'nominate'
                            ? '他球団に求められる選手を提出すると、最初の指名権を得られる可能性が高まります。残す戦力と、獲得のチャンスを考えてみましょう。'
                            : '欲しい選手が他球団に指名されることもあります。別の獲得候補も考えておきましょう。'}
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
            {!game && (
              <button onClick={() => setModal('sound')}>サウンド設定</button>
            )}
            <button onClick={() => setModal('rules')}>
              ルールの確認状況
              <ArrowUpRight size={12} />
            </button>
          </footer>
        </main>
      </div>

      {showSplash && (
        <Splash resume={Boolean(game || room.session)} onEnter={enterApp} />
      )}
      {announcements && !room.fatal && (
        <DraftAnnouncement
          key={isRoom ? receivedPresentation.current : 'local'}
          chatOpen={roomChatOpen}
          modalOpen={Boolean(modal) || showSplash}
          roomChat={
            isRoom ? (
              <span className="announcement-room-actions">
                {roomState?.host === roomState?.me && (
                  <button
                    className="button ghost"
                    onClick={() => {
                      void room
                        .send({ type: 'pause', paused: !roomState?.paused })
                        .catch((e) => room.setError(e.message))
                    }}
                  >
                    {roomState?.paused ? '進行を再開' : '全員の進行を一時停止'}
                  </button>
                )}
                <button
                  className="button ghost"
                  onClick={() => setRoomChatOpen(true)}
                >
                  <Users size={16} />
                  チャット{unreadMessages > 0 ? ` (${unreadMessages})` : ''}
                </button>
              </span>
            ) : undefined
          }
          roomMode={
            isRoom ? (roomHumanCount > 1 ? 'shared' : 'solo') : undefined
          }
          sequence={announcements}
          players={players}
          autoPlay={autoPlay}
          onAutoPlayChange={changeAutoPlay}
          onCommit={isRoom ? ignoreRoomCommit : setGame}
          onFinish={finishAnnouncements}
          onPlaybackComplete={
            isRoom && roomHumanCount > 1 ? completePlayback : undefined
          }
          sound={sound}
          soundOptions={soundState.options}
          soundReady={soundState.ready}
          voiceAvailable={soundState.voiceStatus === 'available'}
          paused={modal === 'sound' || Boolean(roomState?.paused)}
          onSoundSettings={() => setModal('sound')}
        />
      )}
      {modal === 'sound' && (
        <ModalShell title="サウンド設定" close={() => setModal(null)}>
          <SoundSettings sound={sound} />
        </ModalShell>
      )}
      {modal === 'share' && game?.stage === 'results' && (
        <ModalShell title="プレー結果を共有" close={() => setModal(null)}>
          <ResultShare game={game} dataset={dataset} />
        </ModalShell>
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
          <dl className="player-bio">
            <div>
              <dt>年齢</dt>
              <dd>
                {playerAge(detailPlayer.birthDate) == null
                  ? '—'
                  : `${playerAge(detailPlayer.birthDate)}歳`}
              </dd>
            </div>
            <div>
              <dt>プロ年数</dt>
              <dd>
                {playerCareerYears(detailPlayer) == null
                  ? '—'
                  : `${playerCareerYears(detailPlayer)}年目`}
              </dd>
            </div>
          </dl>
          <p className="player-bio-basis">
            年齢は2026年12月9日時点。プロ年数は2026シーズン基準（NPB入団年を1年目、育成期間を含む）。
          </p>
          {isOfficial && <StatSummary player={detailPlayer} />}
          <h3>2026年推定年俸</h3>
          <p>
            {detailPlayer.draftFacts?.salaryManYen == null
              ? '年俸データなし'
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
            2026年推定年俸を使用しています。実際の候補リストを示すものではありません。
          </p>
        </ModalShell>
      )}
      {roomState && !room.fatal && (
        <RoomChat
          room={room}
          players={players}
          open={roomChatOpen}
          close={() => setRoomChatOpen(false)}
        />
      )}
      {modal === 'privacy' && (
        <ModalShell title="利用状況の計測について" close={() => setModal(null)}>
          <PrivacySettings />
        </ModalShell>
      )}
      {modal === 'reset' && (
        <ModalShell
          title={
            isRoom ? 'ルームを退出しますか？' : '新しいドラフトを始めますか？'
          }
          close={() => setModal(null)}
        >
          <p>
            {isRoom
              ? !game
                ? '待合室から退出し、選んでいた球団は空席に戻ります。'
                : game.stage === 'results'
                  ? 'このルームから退出してホームへ戻ります。結果を残したい場合は、退出前にテキストや画像で保存してください。'
                  : '退出すると担当球団はCPUが引き継ぎます。他の参加者はそのままプレーを続けられます。'
              : '現在の進行は消去され、球団選択に戻ります。使用する選手データは引き継ぎます。'}
          </p>
          <div className="modal-actions">
            <button className="button ghost" onClick={() => setModal(null)}>
              続ける
            </button>
            <button
              className="button primary"
              disabled={isRoom && room.busy}
              onClick={() => void reset()}
            >
              {isRoom
                ? room.busy
                  ? '退出しています…'
                  : '退出してホームに戻る'
                : '球団選択に戻る'}
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
              <strong>2026年推定年俸を使用</strong>
              <br />
              新聞報道から2026年の対象範囲改定と2025年の第2巡変更を参照し、同票時の順位・予備指名の拘束・条件付き入札を実装しています。年俸は2026年推定額を使用します。選手別の契約情報と入札の内部調整は完全再現を保証しません。
            </span>
          </div>
          <h3>シーズン中に移籍した選手は？</h3>
          <p>
            2026年10月の規定改定により、7月31日までに通常のトレード等で獲得した選手も、他の資格条件を満たせば対象です。前年の現役ドラフトで獲得した選手は引き続き対象外です。
            また、開催年の年度連盟選手権試合終了の翌日以降に契約譲渡で獲得した選手と、同じ基準日以降に育成から支配下へ移行した選手は除外されます。加入時期・契約等の選手別最終確認は残ります。
          </p>
          <h3>ルームでの遊び方</h3>
          <p>
            ニックネームを入力してルームを作るか、6桁の番号で参加します。球団を選び、準備が揃ったら主催者が開始します。空席はCPUが担当するので1人でも遊べます。開始後の新規参加はできません。同じブラウザから再接続すると元の球団に戻ります。
          </p>
          <p>
            候補・投票・参加意向・入札は全員が確定するまで非公開です。操作の持ち時間は各3分。時間切れはCPUが代理で判断し、切断中なら復帰まで引き継ぎます。主催者は一時停止と再開ができ、切断が1分続いた場合は接続中の参加者へ主催を引き継ぎます。
          </p>
          <p>
            チャットとリアクションはルーム内だけで共有します。複数人の指名発表は共通の進行で自動的に進みます。自動送り・音声の設定は各端末の表示に適用され、他の参加者の進行を止めません。
          </p>
          <h3>ドラフトの流れ</h3>
          <ol className="guide-list">
            <li>
              <strong>候補提出</strong>
              <p>
                自球団から2名以上を選びます。空席を担当するCPUは一軍の戦力・若手・ルーキー・入団間もない上位指名選手を保護し、出場機会などに応じて候補を選びます。新しいプレーでは候補の組み合わせが変わります。
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
                獲得希望・放出のみ・不参加を選び、参加状況を確認して確定します。獲得希望は順位と、無条件または人数均衡の条件を指定します。無条件、次に第1巡の実指名順の逆順を優先し、成立可能な組合せを探索します。CPUの意向と入札はゲーム内判断で、実際の内部調整結果を保証するものではありません。
              </p>
            </li>
          </ol>
          <h3>制度の調査と選手別の資格確認</h3>
          <p>
            年俸例外・FA資格・前年現役ドラフト・育成登録等を反映しています。年俸は2026年の推定額を使用し、5,000万円以上1億円未満を1名含める場合は、5,000万円未満が2名以上必要です。取り込みでは、利用者が資格を確認した選手だけを
            eligible: true にしてください。
          </p>
          <p>
            実際の候補リストや球団の判断を予測するものではありません。CPUの選考は独自設定で、実際の編成方針・成績・選手評価ではありません。
          </p>
        </ModalShell>
      )}
      {modal === 'data' && (
        <ModalShell title="選手データ" close={() => setModal(null)}>
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
                ? `NPB公式サイトの2026年度名簿から${players.length}名を収録し、2026年度一軍成績を対応付けています。名簿・打撃・投手の計36ページを取得しました。育成登録選手は選択できません。2026年推定年俸、公式FA資格者、前年現役ドラフト加入者、育成登録、戦力外等の報道を候補判定に反映しました。出生地だけで外国人枠を判定せず、NPBの記録などを照合しています。実際の提出候補とは異なります。`
                : '取り込まれたデータを使用しています。ファイルの形式は検証しますが、在籍・参加資格・出典の正確性は自動照合しません。'}
          </p>
          <p>
            年俸はgurazeni.comの2026年推定額を使用し、金額不明は補完せず候補を保留します。実際の翌季年俸による対象判定とは異なります。成績は公式ページの掲載値です。CPUの判断はゲーム用の設定です。
          </p>
          <h3>2026年データの取り込み</h3>
          <p>
            取り込みデータはブラウザ内だけに保存され、サーバーには送信されません。新しいルームでは全員が共通の2026年公式名簿を使用するため、取り込みデータは反映されません。
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
              disabled={!!game || isRoom}
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
              {isRoom
                ? 'ルームでは共通の選手データを使用します。'
                : '進行中のプレーではデータを差し替えできません。'}
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
        </ModalShell>
      )}
    </div>
  )
}
