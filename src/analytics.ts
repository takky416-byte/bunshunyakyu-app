import type { TeamId } from './data'
import type { AnalyticsEvent } from './analytics-contract'

const VISITOR_KEY = 'draft-analytics:visitor:v1'
const PREFERENCE_KEY = 'draft-analytics:preference:v1'
const QUEUE_KEY = 'draft-analytics:pending:v1'
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export interface TrackedPlay {
  playId: string
  visitorId: string
}
export function validTrackedPlay(raw: unknown): raw is TrackedPlay {
  if (!raw || typeof raw !== 'object') return false
  const value = raw as TrackedPlay
  return (
    typeof value.playId === 'string' &&
    uuid.test(value.playId) &&
    typeof value.visitorId === 'string' &&
    uuid.test(value.visitorId)
  )
}
let memoryVisitor: string | null = null
let memoryOptOut = false
let initialized = false
let pending: AnalyticsEvent[] = []
let flushing = false
let timer: number | undefined
let retries = 0
let controller: AbortController | undefined
let pageId: string | undefined
const subscribers = new Set<() => void>()

export function privacyStatus(): 'enabled' | 'opted-out' | 'browser' {
  const browser = navigator as Navigator & { globalPrivacyControl?: boolean }
  if (browser.doNotTrack === '1' || browser.globalPrivacyControl === true)
    return 'browser'
  if (memoryOptOut) return 'opted-out'
  try {
    return localStorage.getItem(PREFERENCE_KEY) === 'off'
      ? 'opted-out'
      : 'enabled'
  } catch {
    return memoryOptOut ? 'opted-out' : 'enabled'
  }
}
export function subscribePrivacy(callback: () => void) {
  subscribers.add(callback)
  return () => {
    subscribers.delete(callback)
  }
}
export function setAnalyticsEnabled(enabled: boolean) {
  memoryOptOut = !enabled
  try {
    localStorage.setItem(PREFERENCE_KEY, enabled ? 'on' : 'off')
  } catch {
    /* in-memory preference still applies */
  }
  if (!enabled) clearTracking()
  for (const callback of subscribers) callback()
}
function clearTracking() {
  pending = []
  memoryVisitor = null
  controller?.abort()
  if (timer !== undefined) window.clearTimeout(timer)
  try {
    localStorage.removeItem(VISITOR_KEY)
    localStorage.removeItem('geneki-draft:room-tracking:v1')
    sessionStorage.removeItem(QUEUE_KEY)
    for (const key of ['geneki-draft-room:v1', 'geneki-draft-room:v2']) {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      try {
        const saved = JSON.parse(raw)
        if (saved && typeof saved === 'object' && saved.trackedPlay) {
          saved.trackedPlay = null
          localStorage.setItem(key, JSON.stringify(saved))
        }
      } catch {
        /* preserve malformed game records instead of deleting them */
      }
    }
  } catch {
    /* unavailable storage */
  }
}
function visitorId(): string {
  if (memoryVisitor) return memoryVisitor
  try {
    const saved = localStorage.getItem(VISITOR_KEY)
    if (saved && uuid.test(saved)) return (memoryVisitor = saved)
  } catch {
    /* ephemeral identifier if storage is unavailable */
  }
  memoryVisitor = crypto.randomUUID()
  try {
    localStorage.setItem(VISITOR_KEY, memoryVisitor)
  } catch {
    /* count is approximate */
  }
  return memoryVisitor
}
function persist() {
  try {
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify(pending))
  } catch {
    /* analytics must never block gameplay */
  }
}
function init() {
  if (initialized) return
  initialized = true
  try {
    const raw = JSON.parse(sessionStorage.getItem(QUEUE_KEY) || '[]')
    if (Array.isArray(raw))
      pending = raw
        .filter(
          (e: AnalyticsEvent) =>
            e &&
            typeof e.id === 'string' &&
            uuid.test(e.id) &&
            e.visitorId === visitorId() &&
            ['page_view', 'play_start', 'play_complete'].includes(e.type),
        )
        .slice(-100)
        .map((e: AnalyticsEvent) => ({
          id: e.id,
          type: e.type,
          visitorId: e.visitorId,
          ...(e.type === 'page_view' ? {} : { playId: e.playId, team: e.team }),
        }))
  } catch {
    pending = []
  }
  window.addEventListener('online', () => {
    void flush()
  })
  window.addEventListener('storage', (event) => {
    if (event.key !== PREFERENCE_KEY) return
    memoryOptOut = event.newValue === 'off'
    if (privacyStatus() !== 'enabled') clearTracking()
    for (const callback of subscribers) callback()
  })
  window.addEventListener('pagehide', () => {
    if (privacyStatus() !== 'enabled' || !pending.length) return
    try {
      navigator.sendBeacon(
        '/api/analytics/events',
        new Blob([JSON.stringify({ events: pending.slice(0, 20) })], {
          type: 'application/json',
        }),
      )
    } catch {
      /* retain pending events for a reload */
    }
  })
}
async function flush() {
  if (flushing || !pending.length || privacyStatus() !== 'enabled') return
  flushing = true
  if (timer !== undefined) window.clearTimeout(timer)
  try {
    while (pending.length && privacyStatus() === 'enabled') {
      const batch = pending.slice(0, 20)
      controller = new AbortController()
      const response = await fetch('/api/analytics/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        signal: controller.signal,
        keepalive: true,
      })
      if (!response.ok && ![400, 413, 415].includes(response.status))
        throw new Error('analytics unavailable')
      const ids = new Set(batch.map((e) => e.id))
      pending = pending.filter((e) => !ids.has(e.id))
      persist()
      retries = 0
    }
  } catch {
    if (privacyStatus() === 'enabled' && pending.length)
      timer = window.setTimeout(
        () => {
          void flush()
        },
        Math.min(60_000, 2000 * 2 ** Math.min(retries++, 5)),
      )
  } finally {
    flushing = false
    controller = undefined
  }
}
function enqueue(event: AnalyticsEvent) {
  if (privacyStatus() !== 'enabled') return
  init()
  if (
    !pending.some(
      (e) =>
        e.id === event.id ||
        (e.type === event.type && e.playId && e.playId === event.playId),
    )
  ) {
    pending.push(event)
    if (pending.length > 100) pending.shift()
    persist()
  }
  void flush()
}
export function trackPageView() {
  try {
    if (privacyStatus() !== 'enabled') {
      clearTracking()
      return
    }
    pageId ??= crypto.randomUUID()
    enqueue({ id: pageId, type: 'page_view', visitorId: visitorId() })
  } catch {
    /* unavailable analytics must not affect the game */
  }
}
export function trackPlayStarted(team: TeamId): TrackedPlay | null {
  try {
    if (privacyStatus() !== 'enabled') return null
    const tracked = { playId: crypto.randomUUID(), visitorId: visitorId() }
    enqueue({
      id: crypto.randomUUID(),
      type: 'play_start',
      visitorId: tracked.visitorId,
      playId: tracked.playId,
      team,
    })
    return tracked
  } catch {
    return null
  }
}
export function trackPlayCompleted(tracked: TrackedPlay, team: TeamId) {
  try {
    if (privacyStatus() !== 'enabled' || visitorId() !== tracked.visitorId)
      return
    enqueue({
      id: crypto.randomUUID(),
      type: 'play_complete',
      ...tracked,
      team,
    })
  } catch {
    /* gameplay remains available */
  }
}
