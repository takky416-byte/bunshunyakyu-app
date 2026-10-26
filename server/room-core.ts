import { teamById, teamIds, type TeamId } from '../src/data'
import { officialDataset } from '../src/officialData'
import {
  beginDraft,
  choicesFor,
  confirmRoundTwo,
  fit,
  hash,
  makePick,
  newGame,
  startRoundTwo,
  submitNominations,
  validateNominations,
  type Game,
} from '../src/engine'
import { CPU_TURN_MS, MIN_PRESENTATION_MS } from '../src/draftPacing'
import { realisticCandidates } from '../src/cpuCandidates'
import type { Participation, RoundTwoBid } from '../src/roundTwo'
import {
  reactions,
  roomPhase,
  type RoomAction,
  type RoomCommand,
  type RoomMessage,
  type RoomPresentation,
  type RoomSession,
  type RoomSnapshot,
} from '../src/room-contract'

const players = officialDataset.players
const TURN_MS = 180_000
const PICK_SHOW_MS = 22_000
const LIFETIME_MS = 2 * 60 * 60_000
const RULESET = '2026-rooms-v1'
interface Member {
  id: string
  name: string
  team: TeamId | null
  ready: boolean
  cpu: boolean
  tokenHash: string
  lastSeen: number
  chatTimes?: number[]
}
export interface StoredRoom {
  ruleset: string
  code: string
  revision: number
  host: string
  members: Member[]
  game: Game | null
  offers: Game['offers']
  ballots: Game['ballots']
  intents: Partial<Record<TeamId, Participation>>
  bids: RoundTwoBid[]
  deadline: number | null
  expiresAt: number
  pausedAt: number | null
  presentation: RoomPresentation | null
  playback?: {
    id: string
    members: string[]
    finished: string[]
    earliest: number
    fallbackUntil?: number
  }
  roundTwoIndex: number
  messages: RoomMessage[]
  processed: string[]
}
export interface RoomRepository {
  load(): Promise<StoredRoom | null>
  save(room: StoredRoom): Promise<void>
  delete(): Promise<void>
}
export interface RoomHooks {
  online(id: string): boolean
  broadcast(): void
  schedule(at: number): Promise<void>
  expired(): void
}
export class RoomError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}
const fail = (message: string, status = 400): never => {
  throw new RoomError(message, status)
}
const secret = () =>
  crypto.randomUUID().replaceAll('-', '') +
  crypto.randomUUID().replaceAll('-', '')
const tokenHash = async (token: string) => {
  if (!/^[a-f0-9]{64}$/.test(token)) fail('ルームに入り直してください。', 401)
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
}
export function playerName(value: unknown): string {
  if (typeof value !== 'string') return fail('プレーヤー名を入力してください。')
  const name = value.trim().normalize('NFKC')
  if (!name || [...name].length > 16 || /[\p{Cc}\p{Cf}<>]/u.test(name))
    fail('プレーヤー名は16文字以内で入力してください。')
  return name
}
function stringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 80 &&
    value.every((x) => typeof x === 'string' && x.length <= 80)
  )
}
export function parseCommand(raw: unknown): RoomCommand {
  if (!raw || typeof raw !== 'object') return fail('操作内容を読み込めません。')
  const c = raw as RoomCommand
  if (
    !/^[a-f0-9-]{36}$/.test(c.id ?? '') ||
    typeof c.phase !== 'string' ||
    c.phase.length > 40 ||
    !c.action ||
    typeof c.action !== 'object'
  )
    return fail('操作内容が不正です。')
  const a = c.action
  switch (a.type) {
    case 'playback':
    case 'presented':
      if (typeof a.presentationId !== 'string' || a.presentationId.length > 40)
        fail('発表内容を確認できません。')
      break
    case 'start':
    case 'leave':
      break
    case 'team':
      if (a.team !== null && !teamIds.includes(a.team))
        fail('球団を選んでください。')
      break
    case 'ready':
      if (typeof a.ready !== 'boolean') fail('準備状況が不正です。')
      break
    case 'pause':
      if (typeof a.paused !== 'boolean') fail('一時停止の指定が不正です。')
      break
    case 'remove':
      if (typeof a.memberId !== 'string' || a.memberId.length > 40)
        fail('参加者が不正です。')
      break
    case 'nominate':
      if (!stringList(a.players)) fail('候補を選んでください。')
      break
    case 'vote':
    case 'pick':
      if (typeof a.player !== 'string' || a.player.length > 80)
        fail('選手を選んでください。')
      break
    case 'intent':
      if (!['buy', 'supply', 'out'].includes(a.intent))
        fail('参加意向が不正です。')
      break
    case 'bid':
      if (
        !stringList(a.preferences) ||
        !['unconditional', 'balanced'].includes(a.condition)
      )
        fail('入札内容が不正です。')
      break
    case 'chat':
    case 'reaction':
      if (
        typeof a.text !== 'string' ||
        !a.text.trim() ||
        [...a.text].length > 240 ||
        /[\p{Cc}\p{Cf}]/u.test(a.text)
      )
        fail('メッセージは240文字以内で入力してください。')
      if (
        a.type === 'reaction' &&
        !(reactions as readonly string[]).includes(a.text)
      )
        fail('リアクションを選んでください。')
      break
    default:
      fail('この操作には対応していません。')
  }
  return c
}
export class RoomCore {
  private state: StoredRoom | null | undefined
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    private repository: RoomRepository,
    private hooks: RoomHooks,
    private clock = Date.now,
    private presentationScale = 1,
  ) {}
  private run<T>(operation: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(async () => {
      this.state ??= await this.repository.load()
      const now = this.clock()
      if (this.state && this.state.expiresAt <= now) {
        this.state = null
        await this.repository.delete()
        this.hooks.expired()
      }
      if (this.state && this.state.ruleset !== RULESET)
        fail('ルールが更新されました。新しいルームを作ってください。', 409)
      const before = this.state ? structuredClone(this.state) : null
      let persisted = false
      try {
        const result = await operation()
        if (
          this.state &&
          JSON.stringify(this.state) !== JSON.stringify(before)
        ) {
          this.state.revision++
          // Bound the SQLite KV value even with long UTF-8 chat messages and
          // twelve long preference lists. Keep recent messages; never trim game inputs.
          while (
            this.state.messages.length > 1 &&
            new TextEncoder().encode(JSON.stringify(this.state)).byteLength >
              110_000
          )
            this.state.messages.shift()
          await this.repository.save(this.state)
          persisted = true
          this.hooks.broadcast()
        }
        if (this.state) await this.hooks.schedule(this.nextAlarm())
        return result
      } catch (error) {
        // A failed alarm update must not roll back an already committed move.
        if (!persisted) this.state = before
        throw error
      }
    })
    this.queue = next.catch(() => {})
    return next
  }
  private room() {
    return (
      this.state ??
      fail('ルームが見つかりません。有効な番号で入り直してください。', 404)
    )
  }
  private now() {
    return this.clock()
  }
  private message(
    text: string,
    member?: Member,
    kind: RoomMessage['kind'] = 'system',
  ) {
    const r = this.room()
    r.messages.push({
      id: crypto.randomUUID(),
      at: this.now(),
      kind,
      name: member?.name ?? '進行係',
      ...(member?.team ? { team: member.team } : {}),
      text,
    })
    r.messages = r.messages.slice(-80)
  }
  private async member(token: string) {
    const digest = await tokenHash(token)
    return (
      this.room().members.find((m) => m.tokenHash === digest) ??
      fail('参加情報を確認できません。ルームに入り直してください。', 401)
    )
  }
  private humans() {
    return this.room().members.flatMap((m) =>
      !m.cpu && m.team ? [m.team] : [],
    )
  }
  private submitted(): TeamId[] {
    const r = this.room(),
      g = r.game
    if (!g) return []
    if (g.stage === 'nominate') return teamIds.filter((t) => !!r.offers[t])
    if (g.stage === 'vote') return teamIds.filter((t) => !!r.ballots[t])
    if (g.stage === 'round2') return teamIds.filter((t) => !!r.intents[t])
    if (g.stage === 'round2confirm')
      return teamIds.filter(
        (t) => r.intents[t] !== 'buy' || r.bids.some((b) => b.team === t),
      )
    return []
  }
  private show(kind: RoomPresentation['kind'], ms: number, pickIndex?: number) {
    const r = this.room()
    r.presentation = {
      id: crypto.randomUUID(),
      kind,
      until: this.now() + Math.max(1, Math.round(ms * this.presentationScale)),
      ...(pickIndex === undefined ? {} : { pickIndex }),
    }
    r.playback = {
      id: r.presentation.id,
      members: r.members
        .filter((m) => m.tokenHash && !m.cpu && this.hooks.online(m.id))
        .map((m) => m.id),
      finished: [],
      fallbackUntil: r.presentation.until,
      earliest:
        this.now() +
        Math.max(1, Math.round(MIN_PRESENTATION_MS * this.presentationScale)),
    }
    r.deadline = null
  }
  private armTurn() {
    const r = this.room()
    if (!r.game || r.game.stage === 'results') {
      r.deadline = null
      return
    }
    r.deadline =
      this.now() +
      (r.game.stage === 'draft' && !this.humans().includes(r.game.current!)
        ? Math.max(1, CPU_TURN_MS * this.presentationScale)
        : TURN_MS)
  }
  private cpuOffers() {
    const g = this.room().game!
    return submitNominations(
      g,
      realisticCandidates(g.userTeam, players, g.seed),
      players,
    ).offers
  }
  private cpuBallots() {
    const g = this.room().game!
    const offered = new Set(Object.values(g.offers).flat())
    const preferred = players
      .filter((p) => offered.has(p.id) && p.team !== g.userTeam)
      .sort(
        (a, b) =>
          fit(b, g.userTeam, g.seed) - fit(a, g.userTeam, g.seed) ||
          a.id.localeCompare(b.id),
      )[0]
    return beginDraft(g, preferred.id, players).ballots
  }
  private cpuIntents() {
    const g = this.room().game!
    const intent =
      hash(`${g.seed}:round2:${g.userTeam}`) % 100 < 55
        ? 'buy'
        : hash(`${g.seed}:supply:${g.userTeam}`) % 2
          ? 'supply'
          : 'out'
    return startRoundTwo(g, intent, players).roundTwo!.intents
  }
  private fillCpuInputs() {
    const r = this.room(),
      g = r.game!
    const cpu = teamIds.filter((t) => !this.humans().includes(t))
    if (!cpu.length) return
    if (g.stage === 'nominate') {
      const defaults = this.cpuOffers()
      for (const t of cpu) r.offers[t] ??= defaults[t]
    } else if (g.stage === 'vote') {
      const defaults = this.cpuBallots()
      for (const t of cpu) r.ballots[t] ??= defaults[t]
    } else if (g.stage === 'round2') {
      const defaults = this.cpuIntents()
      for (const t of cpu) r.intents[t] ??= defaults[t]
    } else if (g.stage === 'round2confirm') {
      // Build every CPU bid from the same ranking and seeded conditions,
      // including the original host's team after a timeout or departure.
      const perspective = this.humans()[0] ?? g.userTeam
      const ownChoices = players.filter(
        (p) =>
          p.team !== perspective &&
          Object.values(g.offers).flat().includes(p.id) &&
          !g.picks.some((pick) => pick.playerId === p.id) &&
          r.intents[p.team] !== 'out',
      )
      const prefs =
        r.intents[perspective] === 'buy'
          ? ownChoices
              .sort(
                (a, b) =>
                  fit(b, perspective, g.seed) - fit(a, perspective, g.seed) ||
                  a.id.localeCompare(b.id),
              )
              .map((p) => p.id)
          : []
      const defaults = confirmRoundTwo(
        { ...g, userTeam: perspective },
        prefs,
        hash(`${g.seed}:condition:${perspective}`) % 2
          ? 'balanced'
          : 'unconditional',
        players,
      ).roundTwo!.bids
      for (const t of cpu.filter((t) => r.intents[t] === 'buy'))
        if (!r.bids.some((b) => b.team === t))
          r.bids.push(defaults.find((b) => b.team === t)!)
    }
  }
  private finishInputs() {
    const r = this.room(),
      g = r.game!
    this.fillCpuInputs()
    if (this.submitted().length < 12) return
    if (g.stage === 'nominate') {
      // Each persisted offer was validated when submitted. A later report
      // refresh must not invalidate it while the remaining clubs are choosing.
      const accepted = new Set(Object.values(r.offers).flat())
      const submittedPlayers = players.map((p) =>
        accepted.has(p.id) && p.draftFacts
          ? {
              ...p,
              draftFacts: {
                ...p.draftFacts,
                exclusions: p.draftFacts.exclusions.filter(
                  (e) => e.reason !== '戦力外・退団・引退の報道あり',
                ),
              },
            }
          : p,
      )
      r.game = submitNominations(
        g,
        r.offers[g.userTeam]!,
        submittedPlayers,
        r.offers,
      )
      r.offers = {}
      r.ballots = {}
      this.fillCpuInputs()
      this.show('nominations', 7000)
      this.message('12球団の候補が揃いました。獲得希望の事前投票へ進みます。')
    } else if (g.stage === 'vote') {
      r.game = beginDraft(g, r.ballots[g.userTeam]!, players, r.ballots)
      r.ballots = {}
      this.show('order', 14_000)
      this.message('事前投票が終了しました。第1巡の指名を始めます。')
    } else if (g.stage === 'round2') {
      r.game = startRoundTwo(g, r.intents[g.userTeam]!, players, r.intents)
      this.fillCpuInputs()
      this.armTurn()
      // No buyer: no further human confirmation is necessary.
      if (this.submitted().length === 12) this.finishInputs()
    } else if (g.stage === 'round2confirm') {
      const own = r.bids.find((b) => b.team === g.userTeam)
      r.game = confirmRoundTwo(
        g,
        own?.preferences ?? [],
        own?.condition ?? 'unconditional',
        players,
        r.bids,
      )
      r.roundTwoIndex = 0
      this.show(
        'round2',
        PICK_SHOW_MS,
        r.game.picks.some((p) => p.round === 2) ? 0 : undefined,
      )
      this.message('第2巡の入札が揃いました。成立した指名を順番に発表します。')
      r.expiresAt = this.now() + LIFETIME_MS
    }
  }
  private pick(id: string) {
    const r = this.room(),
      g = r.game!
    r.game = makePick(g, id, players)
    const p = players.find((p) => p.id === id)!
    this.message(
      `${teamById[g.current!].short}が${p.name}（${teamById[p.team].short}）を指名しました。`,
    )
    this.show('pick', PICK_SHOW_MS)
  }
  private tick() {
    const r = this.room(),
      now = this.now()
    const host = r.members.find((m) => m.id === r.host)
    if (
      !host?.tokenHash ||
      (!this.hooks.online(host.id) && now - host.lastSeen >= 60_000)
    ) {
      const next = r.members.find((m) => m.tokenHash && this.hooks.online(m.id))
      if (next) {
        r.host = next.id
        this.message(`${next.name}さんに主催者を引き継ぎました。`)
      }
    }
    if (!r.game || r.pausedAt !== null) return
    if (r.presentation) {
      const playback = r.playback
      if (playback?.id === r.presentation.id) {
        const watching = playback.members.filter(
          (id) =>
            r.members.some((m) => m.id === id && m.tokenHash && !m.cpu) &&
            this.hooks.online(id),
        )
        if (
          playback.members.length &&
          watching.every((id) => playback.finished.includes(id))
        )
          r.presentation.until = Math.min(
            r.presentation.until,
            Math.max(now, playback.earliest),
          )
      }
      if (r.presentation.until > now) return
      if (r.presentation.kind === 'round2') {
        const count = r.game.picks.filter((p) => p.round === 2).length
        if (++r.roundTwoIndex < count) {
          this.show('round2', PICK_SHOW_MS, r.roundTwoIndex)
          return
        }
      }
      r.presentation = null
      delete r.playback
      this.armTurn()
      this.finishInputs()
      return
    }
    if (r.deadline === null || r.deadline > now) return
    const g = r.game
    if (g.stage === 'draft') {
      const member = r.members.find((m) => m.team === g.current)
      if (member && !member.cpu) {
        this.message(
          `${member.name}さんの持ち時間が終了したため、CPUが代理で指名します。`,
        )
        if (!this.hooks.online(member.id)) member.cpu = true
      }
      const choices = choicesFor(g, players).sort(
        (a, b) =>
          fit(b, g.current!, g.seed) - fit(a, g.current!, g.seed) ||
          a.id.localeCompare(b.id),
      )
      this.pick(choices[0].id)
      return
    }
    const missing = this.humans().filter((t) => !this.submitted().includes(t))
    for (const t of missing) {
      const m = r.members.find((m) => m.team === t)!
      this.message(
        `${m.name}さんの持ち時間が終了したため、CPUが代理で提出しました。`,
      )
      if (!this.hooks.online(m.id)) m.cpu = true
      if (g.stage === 'nominate') r.offers[t] = this.cpuOffers()[t]
      else if (g.stage === 'vote') r.ballots[t] = this.cpuBallots()[t]
      else if (g.stage === 'round2') r.intents[t] = this.cpuIntents()[t]
      else if (g.stage === 'round2confirm') {
        const available = players
          .filter(
            (p) =>
              p.team !== t &&
              Object.values(g.offers).flat().includes(p.id) &&
              !g.picks.some((pick) => pick.playerId === p.id) &&
              r.intents[p.team] !== 'out',
          )
          .sort(
            (a, b) =>
              fit(b, t, g.seed) - fit(a, t, g.seed) || a.id.localeCompare(b.id),
          )
        r.bids.push({
          team: t,
          condition: 'unconditional',
          preferences: available.map((p) => p.id),
        })
      }
    }
    this.finishInputs()
  }
  private nextAlarm() {
    const r = this.room(),
      times = [r.expiresAt]
    if (r.pausedAt === null) {
      if (r.presentation) times.push(r.presentation.until)
      else if (r.deadline !== null) times.push(r.deadline)
    }
    const host = r.members.find((m) => m.id === r.host)
    if (
      host &&
      !this.hooks.online(host.id) &&
      host.lastSeen + 60_000 > this.now()
    )
      times.push(host.lastSeen + 60_000)
    return Math.max(this.now() + 100, Math.min(...times))
  }
  async init(code: string, name: unknown): Promise<RoomSession> {
    return this.run(async () => {
      if (this.state) fail('ルーム番号が使用中です。', 409)
      if (!/^\d{6}$/.test(code)) fail('6桁のルーム番号を確認してください。')
      const token = secret(),
        id = crypto.randomUUID(),
        now = this.now()
      const member: Member = {
        id,
        name: playerName(name),
        team: null,
        tokenHash: await tokenHash(token),
        ready: false,
        cpu: false,
        lastSeen: now,
      }
      this.state = {
        ruleset: RULESET,
        code,
        revision: 0,
        host: id,
        members: [member],
        game: null,
        offers: {},
        ballots: {},
        intents: {},
        bids: [],
        deadline: null,
        pausedAt: null,
        presentation: null,
        roundTwoIndex: 0,
        expiresAt: now + LIFETIME_MS,
        messages: [],
        processed: [],
      }
      this.message(`${member.name}さんがルームを作りました。`)
      return { code, token, memberId: id }
    })
  }
  async join(name: unknown): Promise<RoomSession> {
    return this.run(async () => {
      const r = this.room()
      if (r.game)
        fail('このルームは開始済みです。新しい参加は開始前までです。', 409)
      if (r.members.length >= 12) fail('このルームは満員です。', 409)
      const n = playerName(name)
      if (r.members.some((m) => m.name === n))
        fail('同じ名前の参加者がいます。別の名前にしてください。', 409)
      const token = secret(),
        id = crypto.randomUUID()
      r.members.push({
        id,
        name: n,
        team: null,
        ready: false,
        cpu: false,
        tokenHash: await tokenHash(token),
        lastSeen: this.now(),
      })
      this.message(`${n}さんが参加しました。`)
      return { code: r.code, token, memberId: id }
    })
  }
  authenticate(token: string) {
    return this.run(async () => (await this.member(token)).id)
  }
  async read(token: string) {
    const memberId = await this.run(async () => {
      const m = await this.member(token)
      this.tick()
      return m.id
    })
    return this.view(memberId)
  }
  view(memberId: string) {
    return this.run(() => this.snapshot(memberId))
  }
  private snapshot(memberId: string): RoomSnapshot {
    const r = this.room(),
      me =
        r.members.find((m) => m.id === memberId && m.tokenHash) ??
        fail('退出しました。', 401)
    let game: Game | null = r.game ? structuredClone(r.game) : null
    if (game) {
      const team =
        me.team ??
        fail('担当球団を確認できません。ルームに入り直してください。', 409)
      game.userTeam = team
      game.seed = 0 // CPU randomness never leaves the authoritative server.
      if (game.stage === 'nominate')
        game.offers = r.offers[team] ? { [team]: r.offers[team] } : {}
      if (game.stage === 'nominate' || game.stage === 'vote')
        game.ballots = r.ballots[team] ? { [team]: r.ballots[team] } : {}
      if (game.roundTwo) {
        const own = r.bids.find((b) => b.team === team)
        game.roundTwo.bids =
          game.stage === 'results' ? game.roundTwo.bids : own ? [own] : []
        game.roundTwo.userPreferences = own?.preferences ?? []
        game.roundTwo.userCondition = own?.condition ?? 'unconditional'
      }
    }
    return {
      code: r.code,
      revision: r.revision,
      phase: roomPhase(r.game),
      me: me.id,
      host: r.host,
      members: r.members.map(({ id, name, team, ready, cpu }) => ({
        id,
        name,
        team,
        ready,
        cpu,
        online: this.hooks.online(id),
      })),
      game,
      submitted: this.submitted(),
      deadline: r.deadline,
      serverTime: this.now(),
      expiresAt: r.expiresAt,
      paused: r.pausedAt !== null,
      presentation: r.presentation ? structuredClone(r.presentation) : null,
      messages: structuredClone(r.messages),
    }
  }
  presence(memberId: string, connected: boolean) {
    return this.run(() => {
      const r = this.room(),
        m = r.members.find((m) => m.id === memberId)
      if (!m || !m.tokenHash) return
      r.revision++ // Presence changes must broadcast even within the same millisecond.
      m.lastSeen = this.now()
      if (connected && r.presentation && r.playback?.id === r.presentation.id) {
        if (!r.playback.members.includes(m.id)) r.playback.members.push(m.id)
        r.presentation.until = r.playback.fallbackUntil ?? r.presentation.until
      }
      if (connected && m.cpu) {
        m.cpu = false
        this.message(`${m.name}さんが操作に復帰しました。`)
      }
      this.tick()
    })
  }
  alarm() {
    return this.run(() => {
      if (this.state) this.tick()
    })
  }
  command(token: string, input: unknown) {
    return this.run(async () => {
      const m = await this.member(token)
      return this.apply(m, parseCommand(input))
    })
  }
  socketCommand(memberId: string, input: unknown) {
    return this.run(() => {
      const m =
        this.room().members.find((m) => m.id === memberId && m.tokenHash) ??
        fail('参加情報を確認できません。', 401)
      return this.apply(m, parseCommand(input))
    })
  }
  private apply(m: Member, command: RoomCommand) {
    const r = this.room(),
      key = m.id + ':' + command.id
    this.tick()
    if (r.processed.includes(key)) return
    const { action: a } = command
    if (['chat', 'reaction'].includes(a.type)) {
      const times = (m.chatTimes ?? []).filter((t) => t > this.now() - 10_000)
      if (times.length >= 5) fail('少し間を空けて送信してください。', 429)
      times.push(this.now())
      m.chatTimes = times
      const text = (
        a as Extract<RoomAction, { type: 'chat' | 'reaction' }>
      ).text.trim()
      this.message(text, m, a.type as 'chat' | 'reaction')
    } else if (a.type === 'leave' || a.type === 'remove') {
      if (a.type === 'remove' && r.host !== m.id)
        fail('主催者だけが操作できます。', 403)
      const leaving =
        a.type === 'leave'
          ? m
          : (r.members.find((x) => x.id === a.memberId) ??
            fail('参加者が見つかりません。'))
      if (a.type === 'remove' && this.hooks.online(leaving.id))
        fail('接続中の参加者は外せません。')
      if (r.game) {
        leaving.cpu = true
        leaving.tokenHash = ''
        this.message(
          r.game.stage === 'results'
            ? `${leaving.name}さんが退出しました。`
            : `${leaving.name}さんが退出しました。CPUが引き継ぎます。`,
        )
        this.fillCpuInputs()
        if (!r.presentation) this.finishInputs()
      } else {
        r.members = r.members.filter((x) => x.id !== leaving.id)
        this.message(`${leaving.name}さんが退出しました。`)
      }
      if (r.host === leaving.id) {
        r.host =
          r.members.find(
            (x) =>
              x.id !== leaving.id && x.tokenHash && this.hooks.online(x.id),
          )?.id ??
          r.members.find((x) => x.id !== leaving.id && x.tokenHash)?.id ??
          ''
        const nextHost = r.members.find((member) => member.id === r.host)
        if (nextHost)
          this.message(`${nextHost.name}さんに主催者を引き継ぎました。`)
      }
      if (!r.members.some((x) => x.tokenHash)) r.expiresAt = this.now() + 60_000
      if (
        r.game?.stage === 'draft' &&
        r.game.current === leaving.team &&
        !r.presentation
      )
        r.deadline =
          this.now() + Math.max(1, CPU_TURN_MS * this.presentationScale)
    } else if (a.type === 'playback') {
      // Each participant finishes only their own presentation. A quiet client
      // cannot cut another participant's ongoing announcement short.
      if (r.presentation?.id === a.presentationId && !m.cpu) {
        r.playback ??= {
          id: r.presentation.id,
          members: r.members
            .filter(
              (member) =>
                member.tokenHash && !member.cpu && this.hooks.online(member.id),
            )
            .map((member) => member.id),
          finished: [],
          fallbackUntil: r.presentation.until,
          earliest: this.now(),
        }
        if (!r.playback.finished.includes(m.id)) r.playback.finished.push(m.id)
        this.tick()
      }
    } else if (a.type === 'presented') {
      // A lone GM can keep their usual pace. In a shared room presentation
      // deadlines remain server controlled; one player cannot skip for others.
      if (this.humans().length !== 1 || m.cpu)
        fail('全員の発表が終わるまでお待ちください。', 403)
      if (r.pausedAt !== null) fail('進行を一時停止しています。', 409)
      if (r.presentation?.id === a.presentationId) {
        r.presentation.until = this.now()
        this.tick()
      }
    } else if (a.type === 'pause') {
      if (r.host !== m.id) fail('主催者だけが操作できます。', 403)
      if (!r.game || (r.game.stage === 'results' && !r.presentation))
        fail('進行中のみ一時停止できます。')
      if (a.paused && r.pausedAt === null) {
        r.pausedAt = this.now()
        this.message('主催者が進行を一時停止しました。')
      } else if (!a.paused && r.pausedAt !== null) {
        const elapsed = this.now() - r.pausedAt
        if (r.deadline) r.deadline += elapsed
        if (r.presentation) r.presentation.until += elapsed
        if (r.playback) {
          r.playback.earliest += elapsed
          if (r.playback.fallbackUntil) r.playback.fallbackUntil += elapsed
        }
        r.pausedAt = null
        this.message('進行を再開しました。')
        this.tick()
      }
    } else {
      if (command.phase !== roomPhase(r.game))
        fail('進行が更新されました。現在の画面で操作してください。', 409)
      if (a.type === 'team' || a.type === 'ready' || a.type === 'start') {
        if (r.game) fail('球団選択は開始前までです。', 409)
        if (a.type === 'team') {
          if (
            a.team !== null &&
            r.members.some((x) => x.id !== m.id && x.team === a.team)
          )
            fail('この球団は選択済みです。', 409)
          m.team = a.team
          m.ready = false
        } else if (a.type === 'ready') {
          if (a.ready && !m.team)
            fail('準備完了にする前に球団を選んでください。', 409)
          m.ready = a.ready
        } else {
          if (r.host !== m.id) fail('主催者だけが開始できます。', 403)
          const team = m.team ?? fail('操作する球団を選んでください。', 409)
          if (
            r.members.some(
              (x) =>
                x.id !== m.id &&
                (!x.team || !x.ready || !this.hooks.online(x.id)),
            )
          )
            fail('全員の球団選択・接続と準備完了を待ってください。')
          r.game = newGame(team, crypto.getRandomValues(new Uint32Array(1))[0])
          r.expiresAt = this.now() + 24 * 60 * 60_000
          this.fillCpuInputs()
          this.armTurn()
          this.message(
            'ドラフトを開始しました。各球団の候補を提出してください。',
          )
        }
      } else {
        const g = r.game ?? fail('まずドラフトを開始してください。')
        const team =
          m.team ?? fail('担当球団を確認できません。再接続してください。', 409)
        if (r.pausedAt !== null) fail('主催者が進行を一時停止しています。', 409)
        if (r.presentation)
          fail('指名発表中です。発表が終わるまでお待ちください。', 409)
        if (m.cpu) fail('再接続して操作に復帰してください。', 409)
        if (this.submitted().includes(team) && g.stage !== 'draft')
          fail('提出済みです。他の球団の提出を待っています。', 409)
        if (a.type === 'nominate' && g.stage === 'nominate') {
          try {
            validateNominations(team, a.players, players)
          } catch (error) {
            // A stale client can still submit a player excluded by a new report.
            // Return the validation guidance over HTTP and WebSocket as well.
            throw new RoomError(
              error instanceof Error
                ? error.message
                : '提出候補を選び直してください。',
            )
          }
          r.offers[team] = [...a.players]
        } else if (a.type === 'vote' && g.stage === 'vote') {
          beginDraft({ ...g, userTeam: team }, a.player, players)
          r.ballots[team] = a.player
        } else if (a.type === 'pick' && g.stage === 'draft') {
          if (g.current !== team) fail('あなたの指名番ではありません。', 403)
          this.pick(a.player)
        } else if (a.type === 'intent' && g.stage === 'round2') {
          r.intents[team] = a.intent
        } else if (a.type === 'bid' && g.stage === 'round2confirm') {
          confirmRoundTwo(
            { ...g, userTeam: team },
            a.preferences,
            a.condition,
            players,
          )
          r.bids.push({
            team,
            preferences: [...a.preferences],
            condition: a.condition,
          })
        } else fail('現在の段階ではこの操作はできません。', 409)
        if (!r.presentation) this.finishInputs()
      }
    }
    r.processed.push(key)
    r.processed = r.processed.slice(-128)
  }
}
