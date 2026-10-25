import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PLAYER_NAME_KEY,
  ROOM_SESSION_KEY,
  type RoomAction,
  type RoomCommand,
  type RoomSession,
  type RoomSnapshot,
} from './room-contract'

function remembered(): RoomSession | null {
  try {
    const x = JSON.parse(localStorage.getItem(ROOM_SESSION_KEY) ?? 'null')
    return x &&
      /^\d{6}$/.test(x.code) &&
      /^[a-f0-9]{64}$/.test(x.token) &&
      typeof x.memberId === 'string'
      ? x
      : null
  } catch {
    return null
  }
}
export function rememberedName() {
  try {
    return localStorage.getItem(PLAYER_NAME_KEY) ?? ''
  } catch {
    return ''
  }
}
export function useRoom() {
  const [session, setSession] = useState(remembered)
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fatal, setFatal] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const socket = useRef<WebSocket | null>(null)
  const latest = useRef<RoomSnapshot | null>(null)
  const pending = useRef(
    new Map<
      string,
      { resolve: () => void; reject: (error: Error) => void; timer: number }
    >(),
  )
  const offset = useRef(0)
  const clear = useCallback(() => {
    try {
      localStorage.removeItem(ROOM_SESSION_KEY)
    } catch {
      /* memory-only is usable */
    }
    socket.current?.close()
    latest.current = null
    setSession(null)
    setSnapshot(null)
    setConnected(false)
    setFatal(false)
    setStorageError(false)
    setError('')
  }, [])
  useEffect(() => {
    if (!session) return
    let stopped = false,
      checking = false,
      retry: number,
      heartbeat: number,
      handshake: number,
      checkAbort: AbortController | null = null,
      attempt = 0
    const apply = (state: RoomSnapshot) => {
      if (stopped) return
      if (state.me !== session.memberId || state.code !== session.code) return
      if (latest.current && state.revision < latest.current.revision) return
      offset.current = state.serverTime - Date.now()
      latest.current = state
      setSnapshot(state)
    }
    const rejectPending = () => {
      for (const p of pending.current.values()) {
        window.clearTimeout(p.timer)
        p.reject(
          new Error('接続が切れました。復帰後に提出状況を確認してください。'),
        )
      }
      pending.current.clear()
    }
    const connect = () => {
      if (stopped) return
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(
        `${protocol}//${location.host}/api/rooms/${session.code}/socket`,
        ['draft-room', 'session.' + session.token],
      )
      socket.current = ws
      let lastHeard = Date.now()
      handshake = window.setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) ws.close()
      }, 15_000)
      ws.onopen = () => {
        if (stopped || socket.current !== ws) {
          ws.close()
          return
        }
        window.clearTimeout(handshake)
        attempt = 0
        setConnected(true)
        setError('')
        setFatal(false)
        heartbeat = window.setInterval(() => {
          if (Date.now() - lastHeard > 60_000) ws.close()
          else if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'ping' }))
        }, 25_000)
      }
      ws.onmessage = (event) => {
        if (stopped || socket.current !== ws) return
        lastHeard = Date.now()
        let data
        try {
          data = JSON.parse(event.data)
        } catch {
          return
        }
        if (data.type === 'state') apply(data.snapshot)
        else if (data.type === 'ack' || data.type === 'error') {
          const p = pending.current.get(data.id)
          if (p) {
            window.clearTimeout(p.timer)
            pending.current.delete(data.id)
            if (data.type === 'ack') p.resolve()
            else p.reject(new Error(data.error))
          } else if (data.type === 'error') setError(data.error)
        }
      }
      ws.onerror = () => {
        /* close handles retry and status */
      }
      ws.onclose = (event) => {
        if (stopped || socket.current !== ws) return
        socket.current = null
        window.clearTimeout(handshake)
        window.clearInterval(heartbeat)
        rejectPending()
        setConnected(false)
        if (event.code === 4001 || event.code === 4004) {
          setFatal(true)
          setError(
            event.code === 4004
              ? 'ルームの有効期限が終了しました。'
              : 'このルームから退出しました。',
          )
          return
        }
        retry = window.setTimeout(
          () => {
            void checkAndConnect()
          },
          Math.min(10_000, 1000 * 2 ** Math.min(attempt++, 4)),
        )
      }
    }
    const checkAndConnect = async () => {
      if (checking || stopped || socket.current) return
      checking = true
      const abort = new AbortController()
      checkAbort = abort
      const timeout = window.setTimeout(() => abort.abort(), 10_000)
      try {
        const response = await fetch(`/api/rooms/${session.code}`, {
          headers: { Authorization: 'Bearer ' + session.token },
          cache: 'no-store',
          signal: abort.signal,
        })
        if (stopped) return
        if ([401, 404, 409, 410].includes(response.status)) {
          const b = await response.json()
          if (stopped) return
          setFatal(true)
          setError(b.error)
          return
        }
        if (!response.ok) throw new Error()
        apply(await response.json())
        if (!stopped) connect()
      } catch {
        if (!stopped) {
          setConnected(false)
          retry = window.setTimeout(() => {
            void checkAndConnect()
          }, 3000)
        }
      } finally {
        window.clearTimeout(timeout)
        if (checkAbort === abort) checkAbort = null
        checking = false
      }
    }
    void checkAndConnect()
    const visible = () => {
      if (!document.hidden && !socket.current && !stopped) {
        window.clearTimeout(retry)
        void checkAndConnect()
      }
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      stopped = true
      window.clearTimeout(retry)
      window.clearInterval(heartbeat)
      window.clearTimeout(handshake)
      checkAbort?.abort()
      document.removeEventListener('visibilitychange', visible)
      socket.current?.close()
      socket.current = null
      rejectPending()
    }
  }, [session])
  const enter = useCallback(async (name: string, code?: string) => {
    setBusy(true)
    setError('')
    const abort = new AbortController()
    const timeout = window.setTimeout(() => abort.abort(), 10_000)
    try {
      const response = await fetch(
        code ? `/api/rooms/${code}/join` : '/api/rooms',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
          signal: abort.signal,
        },
      )
      const b = await response.json()
      if (!response.ok) throw new Error(b.error ?? 'ルームに入れませんでした。')
      try {
        localStorage.setItem(ROOM_SESSION_KEY, JSON.stringify(b))
        localStorage.setItem(PLAYER_NAME_KEY, name.trim())
        setStorageError(false)
      } catch {
        setStorageError(true)
      }
      latest.current = null
      setSnapshot(null)
      setSession(b)
      setFatal(false)
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'AbortError'
          ? '接続に時間がかかっています。通信状態を確認して、もう一度お試しください。'
          : e instanceof Error
            ? e.message
            : '接続に失敗しました。',
      )
    } finally {
      window.clearTimeout(timeout)
      setBusy(false)
    }
  }, [])
  const send = useCallback(async (action: RoomAction) => {
    const ws = socket.current,
      state = latest.current
    if (!state || !ws || ws.readyState !== WebSocket.OPEN)
      throw new Error('再接続中です。接続が戻るまでお待ちください。')
    const command: RoomCommand = {
      id: crypto.randomUUID(),
      phase: state.phase,
      action,
    }
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.current.delete(command.id)
        reject(
          new Error(
            '応答を確認できません。提出状況を確認してからお試しください。',
          ),
        )
      }, 10_000)
      pending.current.set(command.id, { resolve, reject, timer })
      ws.send(JSON.stringify(command))
    })
  }, [])
  const leave = useCallback(async () => {
    if (!session) {
      clear()
      return
    }
    setBusy(true)
    const abort = new AbortController()
    const timeout = window.setTimeout(() => abort.abort(), 10_000)
    try {
      // HTTP confirms revocation even when the room socket is reconnecting or
      // closes before it can acknowledge the leave command.
      const response = await fetch(`/api/rooms/${session.code}/actions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + session.token,
        },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          phase: 'exit',
          action: { type: 'leave' },
        }),
        signal: abort.signal,
      })
      if (!response.ok && ![401, 404, 410].includes(response.status))
        throw new Error()
      clear()
    } catch {
      throw new Error(
        '退出を確認できませんでした。参加情報は保持しています。接続が戻ってからもう一度お試しください。',
      )
    } finally {
      window.clearTimeout(timeout)
      setBusy(false)
    }
  }, [session, clear])
  return {
    session,
    snapshot,
    connected,
    busy,
    error,
    fatal,
    storageError,
    enter,
    send,
    leave,
    clear,
    setError,
    serverNow: () => Date.now() + offset.current,
  }
}
export type RoomConnection = ReturnType<typeof useRoom>
