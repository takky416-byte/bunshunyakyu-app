import { describe, it, expect } from 'vitest'
import { RoomCore, type StoredRoom } from './room-core'
import { teamIds, type TeamId } from '../src/data'
import { officialDataset } from '../src/officialData'
import { realisticCandidates } from '../src/cpuCandidates'
import {
  beginDraft,
  choicesFor,
  confirmRoundTwo,
  makePick,
  newGame,
  startRoundTwo,
  submitNominations,
  type Game,
} from '../src/engine'
import {
  roomPhase,
  type RoomAction,
  type RoomSession,
} from '../src/room-contract'

function fixture() {
  let now = 1_800_000_000_000,
    alarmAt = now,
    stored: StoredRoom | null = null
  const online = new Set<string>()
  const repository = {
    load: async () => (stored ? structuredClone(stored) : null),
    save: async (r: StoredRoom) => {
      stored = structuredClone(r)
    },
    delete: async () => {
      stored = null
    },
  }
  const hooks = {
    online: (id: string) => online.has(id),
    broadcast() {},
    schedule: async (at: number) => {
      alarmAt = at
    },
    expired() {
      online.clear()
    },
  }
  let core = new RoomCore(repository, hooks, () => now)
  return {
    get core() {
      return core
    },
    online,
    stored: () => structuredClone(stored!),
    async advance(ms?: number) {
      now = ms === undefined ? Math.max(now + 1, alarmAt) : now + ms
      await core.alarm()
    },
    restart() {
      core = new RoomCore(repository, hooks, () => now)
    },
    async add(name = '主催', code = '000123') {
      const session = stored
        ? await core.join(name)
        : await core.init(code, name, 'd')
      online.add(session.memberId)
      await core.presence(session.memberId, true)
      return session
    },
    async send(
      session: RoomSession,
      action: RoomAction,
      id = crypto.randomUUID(),
    ) {
      const phase = roomPhase(stored?.game ?? null)
      await core.command(session.token, { id, phase, action })
      return id
    },
  }
}
const players = officialDataset.players
const offerings = (team: TeamId) => realisticCandidates(team, players, 42)

it('six-digit rooms keep leading zeros, authenticate sessions, reserve clubs and require ready peers', async () => {
  const f = fixture(),
    host = await f.add(),
    guest = await f.add('仲間')
  const state = await f.core.read(host.token)
  expect(state.code).toBe('000123')
  expect(state.members).toHaveLength(2)
  expect(new Set(state.members.map((m) => m.team)).size).toBe(2)
  expect(JSON.stringify(state)).not.toContain(host.token)
  expect(JSON.stringify(f.stored())).not.toContain(host.token)
  await expect(f.core.read('f'.repeat(64))).rejects.toMatchObject({
    status: 401,
  })
  await expect(f.send(guest, { type: 'start' })).rejects.toMatchObject({
    status: 403,
  })
  await expect(f.send(host, { type: 'start' })).rejects.toThrow('準備完了')
  await expect(f.send(guest, { type: 'team', team: 'd' })).rejects.toThrow(
    '選択済み',
  )
  await f.send(guest, { type: 'ready', ready: true })
  await f.send(host, { type: 'start' })
  expect((await f.core.read(guest.token)).game?.stage).toBe('nominate')
  await expect(f.core.join('途中参加')).rejects.toMatchObject({ status: 409 })
})

it('concurrent submissions are accepted once, secret until complete, and stale or out-of-turn actions are rejected', async () => {
  const f = fixture(),
    host = await f.add(),
    guest = await f.add('仲間')
  await f.send(guest, { type: 'team', team: 'g' })
  await f.send(guest, { type: 'ready', ready: true })
  await f.send(host, { type: 'start' })
  const duplicate = crypto.randomUUID()
  await f.send(host, { type: 'nominate', players: offerings('d') }, duplicate)
  await f.send(host, { type: 'nominate', players: offerings('d') }, duplicate)
  const privateState = await f.core.read(guest.token)
  expect(privateState.game?.offers).toEqual({})
  expect(privateState.game?.seed).toBe(0)
  expect(privateState.submitted).toHaveLength(11)
  await expect(
    f.send(host, { type: 'nominate', players: offerings('d') }),
  ).rejects.toThrow('提出済み')
  await f.send(guest, { type: 'nominate', players: offerings('g') })
  let state = await f.core.read(host.token)
  expect(Object.keys(state.game!.offers)).toHaveLength(12)
  expect(state.presentation?.kind).toBe('nominations')
  await expect(
    f.send(host, { type: 'vote', player: offerings('g')[0] }),
  ).rejects.toThrow('発表中')
  await f.advance()
  await f.send(host, { type: 'vote', player: offerings('g')[0] })
  expect((await f.core.read(guest.token)).game?.ballots).toEqual({})
  await f.send(guest, { type: 'vote', player: offerings('d')[0] })
  await f.advance()
  state = await f.core.read(host.token)
  const wrong = state.game!.current === 'd' ? guest : host
  await expect(
    f.send(wrong, { type: 'pick', player: offerings('g')[0] }),
  ).rejects.toMatchObject({ status: 403 })
  await expect(
    f.core.command(host.token, {
      id: crypto.randomUUID(),
      phase: 'nominate:0',
      action: { type: 'vote', player: offerings('g')[0] },
    }),
  ).rejects.toMatchObject({ status: 409 })
})

it('twelve simultaneous human nominations and votes preserve all inputs without overwriting them', async () => {
  const f = fixture(),
    sessions = [await f.add()]
  for (let i = 1; i < 12; i++) sessions.push(await f.add('参加者' + i))
  const byTeam = new Map(
    (await f.core.read(sessions[0].token)).members.map((m) => [m.id, m.team]),
  )
  await Promise.all(
    sessions.slice(1).map((s) => f.send(s, { type: 'ready', ready: true })),
  )
  await f.send(sessions[0], { type: 'start' })
  await Promise.all(
    sessions.map((s) =>
      f.send(s, {
        type: 'nominate',
        players: offerings(byTeam.get(s.memberId)!),
      }),
    ),
  )
  expect((await f.core.read(sessions[0].token)).game!.offers).toEqual(
    Object.fromEntries(teamIds.map((t) => [t, offerings(t)])),
  )
  await f.advance()
  await Promise.all(
    sessions.map((s) =>
      f.send(s, {
        type: 'vote',
        player: offerings(
          teamIds.find((t) => t !== byTeam.get(s.memberId))!,
        )[0],
      }),
    ),
  )
  const game = (await f.core.read(sessions[0].token)).game!
  expect(Object.keys(game.ballots)).toHaveLength(12)
  expect(game.stage).toBe('draft')
})

it('reconnect survives storage reload, pause preserves remaining time, and host transfers after disconnect', async () => {
  const f = fixture(),
    host = await f.add(),
    guest = await f.add('仲間')
  await f.send(guest, { type: 'ready', ready: true })
  await f.send(host, { type: 'start' })
  const deadline = (await f.core.read(host.token)).deadline!
  await f.send(host, { type: 'pause', paused: true })
  await f.advance(120_000)
  expect((await f.core.read(host.token)).game!.stage).toBe('nominate')
  await f.send(host, { type: 'pause', paused: false })
  expect((await f.core.read(host.token)).deadline).toBe(deadline + 120_000)
  f.restart()
  expect((await f.core.read(guest.token)).members).toHaveLength(2)
  f.online.delete(host.memberId)
  await f.core.presence(host.memberId, false)
  await f.advance(60_100)
  expect((await f.core.read(guest.token)).host).toBe(guest.memberId)
  f.online.add(host.memberId)
  await f.core.presence(host.memberId, true)
  expect((await f.core.read(host.token)).game!.userTeam).toBe('d')
})

it('chat and reactions are room scoped, bounded, rate limited and safely represented as text', async () => {
  const f = fixture(),
    host = await f.add(),
    guest = await f.add('仲間')
  await f.send(host, { type: 'chat', text: '<img src=x onerror=alert(1)>' })
  expect((await f.core.read(guest.token)).messages.at(-1)?.text).toBe(
    '<img src=x onerror=alert(1)>',
  )
  await f.send(guest, { type: 'reaction', text: 'いい指名！' })
  await expect(
    f.send(host, { type: 'reaction', text: '任意の文言' }),
  ).rejects.toThrow('リアクション')
  for (let i = 0; i < 4; i++)
    await f.send(host, { type: 'chat', text: '発言' + i })
  await expect(
    f.send(host, { type: 'chat', text: '連投' }),
  ).rejects.toMatchObject({ status: 429 })
  for (let i = 0; i < 90; i++) {
    await f.advance(11_000)
    await f.send(host, { type: 'chat', text: '履歴' + i })
  }
  expect((await f.core.read(host.token)).messages).toHaveLength(80)
  const other = fixture(),
    otherHost = await other.add('別室')
  expect(
    (await other.core.read(otherHost.token)).messages.some((m) =>
      m.text.includes('履歴'),
    ),
  ).toBe(false)
})

async function play(
  f: ReturnType<typeof fixture>,
  sessions: RoomSession[],
  allHumans: boolean,
) {
  const host = sessions[0]
  for (const s of sessions.slice(1))
    await f.send(s, { type: 'ready', ready: true })
  await f.send(host, { type: 'start' })
  const seed = f.stored().game!.seed
  for (let steps = 0; steps < 150; steps++) {
    const raw = f.stored(),
      g = raw.game!
    if (g.stage === 'results' && !raw.presentation) return { game: g, seed }
    if (raw.presentation) {
      await f.advance()
      continue
    }
    let acted = false
    for (const s of sessions) {
      const view = await f.core.read(s.token),
        team = view.game!.userTeam
      if (view.submitted.includes(team)) continue
      if (g.stage === 'nominate') {
        await f.send(s, { type: 'nominate', players: offerings(team) })
        acted = true
      } else if (g.stage === 'vote') {
        await f.send(s, {
          type: 'vote',
          player: Object.values(g.offers)
            .flat()
            .find((id) => players.find((p) => p.id === id)?.team !== team)!,
        })
        acted = true
      } else if (g.stage === 'draft' && g.current === team) {
        await f.send(s, { type: 'pick', player: choicesFor(g, players)[0].id })
        acted = true
        break
      } else if (g.stage === 'round2') {
        await f.send(s, { type: 'intent', intent: allHumans ? 'buy' : 'out' })
        acted = true
      } else if (
        g.stage === 'round2confirm' &&
        view.game!.roundTwo!.intents[team] === 'buy'
      ) {
        const used = new Set(g.picks.map((p) => p.playerId))
        const prefs = Object.values(g.offers)
          .flat()
          .filter(
            (id) =>
              !used.has(id) &&
              players.find((p) => p.id === id)?.team !== team &&
              g.roundTwo!.intents[players.find((p) => p.id === id)!.team] !==
                'out',
          )
        await f.send(s, {
          type: 'bid',
          preferences: prefs,
          condition: 'balanced',
        })
        acted = true
      }
    }
    if (!acted) await f.advance()
  }
  throw new Error('Room stalled before results')
}
describe('authoritative complete games', () => {
  it('one human + eleven CPUs reaches results and reproduces the existing rules engine', async () => {
    const f = fixture(),
      host = await f.add()
    const { game: final, seed } = await play(f, [host], false)
    let expected: Game = newGame('d', seed)
    expected = submitNominations(expected, offerings('d'), players)
    expected = beginDraft(expected, final.ballots.d!, players)
    for (const pick of final.picks.filter((p) => p.round === 1))
      expected = makePick(expected, pick.playerId, players)
    expected = startRoundTwo(expected, 'out', players)
    expected = confirmRoundTwo(expected, [], 'unconditional', players)
    expect(final.picks).toEqual(expected.picks)
    expect(final.picks.filter((p) => p.round === 1)).toHaveLength(12)
    expect(new Set(final.picks.map((p) => p.playerId)).size).toBe(
      final.picks.length,
    )
  })
  it('twelve humans complete both rounds, including all-buy balanced bid cycles', async () => {
    const f = fixture(),
      sessions = [await f.add()]
    for (let i = 1; i < 12; i++) sessions.push(await f.add('GM' + i))
    const { game } = await play(f, sessions, true)
    expect(game.stage).toBe('results')
    expect(game.roundTwo!.bids).toHaveLength(12)
    expect(game.roundTwo!.bids.every((b) => b.condition === 'balanced')).toBe(
      true,
    )
    expect(game.picks.filter((p) => p.round === 1)).toHaveLength(12)
    expect(game.picks.filter((p) => p.round === 2).length).toBeGreaterThan(0)
  })
  it('disconnected participants are taken over on deadline and can recover control without changing committed choices', async () => {
    const f = fixture(),
      host = await f.add(),
      guest = await f.add('仲間')
    await f.send(guest, { type: 'ready', ready: true })
    await f.send(host, { type: 'start' })
    await f.send(host, { type: 'nominate', players: offerings('d') })
    f.online.delete(guest.memberId)
    await f.core.presence(guest.memberId, false)
    await f.advance(181_000)
    const state = await f.core.read(host.token)
    expect(state.game!.stage).toBe('vote')
    expect(state.members.find((m) => m.id === guest.memberId)?.cpu).toBe(true)
    const before = state.game!.offers
    f.online.add(guest.memberId)
    await f.core.presence(guest.memberId, true)
    const rejoined = await f.core.read(guest.token)
    expect(rejoined.members.find((m) => m.id === guest.memberId)?.cpu).toBe(
      false,
    )
    expect(rejoined.game!.offers).toEqual(before)
  })
  it('expiry deletes stored names, tokens and chat, and permits number reuse', async () => {
    const f = fixture(),
      host = await f.add()
    await f.send(host, { type: 'chat', text: '内緒の会話' })
    await f.advance(2 * 60 * 60_000 + 1)
    await expect(f.core.read(host.token)).rejects.toMatchObject({ status: 404 })
    const next = await f.core.init('000123', '新しい主催', 'g')
    expect((await f.core.read(next.token)).messages).toHaveLength(1)
  })
})

it('a lone GM can finish a presentation early while shared-room participants cannot skip for everyone', async () => {
  const f = fixture(),
    host = await f.add()
  await f.send(host, { type: 'start' })
  await f.send(host, { type: 'nominate', players: offerings('d') })
  const presentation = (await f.core.read(host.token)).presentation!
  expect(presentation.until - (await f.core.read(host.token)).serverTime).toBe(
    7000,
  )
  await f.send(host, { type: 'presented', presentationId: presentation.id })
  expect((await f.core.read(host.token)).presentation).toBeNull()
  expect((await f.core.read(host.token)).deadline).not.toBeNull()
  const shared = fixture(),
    a = await shared.add(),
    b = await shared.add('仲間')
  await shared.send(b, { type: 'ready', ready: true })
  await shared.send(a, { type: 'start' })
  await shared.send(a, { type: 'nominate', players: offerings('d') })
  const team = (await shared.core.read(b.token)).game!.userTeam
  await shared.send(b, { type: 'nominate', players: offerings(team) })
  const p = (await shared.core.read(a.token)).presentation!
  await expect(
    shared.send(a, { type: 'presented', presentationId: p.id }),
  ).rejects.toMatchObject({ status: 403 })
  expect((await shared.core.read(b.token)).presentation!.id).toBe(p.id)
})

it('an explicitly departed session loses both HTTP and existing WebSocket access', async () => {
  const f = fixture(),
    host = await f.add(),
    guest = await f.add('仲間')
  await f.send(guest, { type: 'ready', ready: true })
  await f.send(host, { type: 'start' })
  await f.send(guest, { type: 'leave' })
  await expect(f.core.read(guest.token)).rejects.toMatchObject({ status: 401 })
  await expect(f.core.view(guest.memberId)).rejects.toMatchObject({
    status: 401,
  })
  await expect(
    f.core.socketCommand(guest.memberId, {
      id: crypto.randomUUID(),
      phase: 'nominate:0',
      action: { type: 'chat', text: '退出後' },
    }),
  ).rejects.toMatchObject({ status: 401 })
})
