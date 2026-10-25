import type { TeamId } from './data'
import type { Game } from './engine'
import type { Participation, BidCondition } from './roundTwo'
import type { Announcement } from './announcements'

export const ROOM_SESSION_KEY = 'geneki-draft:room-session:v1'
export const PLAYER_NAME_KEY = 'geneki-draft:player-name:v1'
export const reactions = [
  'よろしく！',
  'いい指名！',
  '悩み中…',
  'まさか！',
  'お疲れさま！',
] as const
export type RoomAction =
  | { type: 'team'; team: TeamId }
  | { type: 'ready'; ready: boolean }
  | { type: 'start' }
  | { type: 'nominate'; players: string[] }
  | { type: 'vote'; player: string }
  | { type: 'pick'; player: string }
  | { type: 'intent'; intent: Participation }
  | { type: 'bid'; preferences: string[]; condition: BidCondition }
  | { type: 'pause'; paused: boolean }
  | { type: 'presented'; presentationId: string }
  | { type: 'playback'; presentationId: string }
  | { type: 'leave' }
  | { type: 'remove'; memberId: string }
  | { type: 'chat'; text: string }
  | { type: 'reaction'; text: string }
export interface RoomCommand {
  id: string
  phase: string
  action: RoomAction
}
export interface RoomSession {
  code: string
  token: string
  memberId: string
}
export interface RoomMember {
  id: string
  name: string
  team: TeamId
  ready: boolean
  online: boolean
  cpu: boolean
}
export interface RoomMessage {
  id: string
  at: number
  kind: 'system' | 'chat' | 'reaction'
  name: string
  team?: TeamId
  text: string
}
export interface RoomPresentation {
  id: string
  kind: Announcement['kind']
  until: number
  pickIndex?: number
}
export interface RoomSnapshot {
  code: string
  revision: number
  phase: string
  me: string
  host: string
  members: RoomMember[]
  game: Game | null
  submitted: TeamId[]
  deadline: number | null
  serverTime: number
  expiresAt: number
  paused: boolean
  presentation: RoomPresentation | null
  messages: RoomMessage[]
}
export const roomPhase = (game: Game | null) =>
  game ? `${game.stage}:${game.picks.length}` : 'lobby'
