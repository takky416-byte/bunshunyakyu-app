export const SOUND_KEY = 'geneki-draft:sound:v1'
export interface SoundOptions {
  enabled: boolean
  bgm: boolean
  effects: boolean
  narration: boolean
  volume: number
}
type VoiceStatus = 'loading' | 'available' | 'unavailable' | 'unsupported'
interface SoundState {
  options: SoundOptions
  ready: boolean
  voiceStatus: VoiceStatus
  audioSupported: boolean
}
const defaults: SoundOptions = {
  enabled: false,
  bgm: true,
  effects: true,
  narration: true,
  volume: 0.5,
}
export function loadSoundOptions(raw: string | null): SoundOptions {
  try {
    const value = JSON.parse(raw ?? '{}')
    const result = { ...defaults }
    for (const key of ['enabled', 'bgm', 'effects', 'narration'] as const)
      if (typeof value?.[key] === 'boolean') result[key] = value[key]
    if (typeof value?.volume === 'number' && Number.isFinite(value.volume))
      result.volume = Math.min(1, Math.max(0, value.volume))
    return result
  } catch {
    return { ...defaults }
  }
}

type SoundWindow = Window & { webkitAudioContext?: typeof AudioContext }

/** All oscillators are original synthesis. No media downloads or paid services. */
export class DraftSound {
  private state: SoundState
  private listeners = new Set<() => void>()
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private music: GainNode | null = null
  private effects: GainNode | null = null
  private musicNodes = new Set<OscillatorNode>()
  private effectNodes = new Set<OscillatorNode>()
  private musicTimer: number | undefined
  private voiceTimer: number | undefined
  private nextBeat = 0
  private beat = 0
  private cancelCurrentSpeech: (() => void) | null = null
  private speaking = false
  private activated = false
  private mounted = false
  private voice: SpeechSynthesisVoice | null = null

  constructor() {
    let options = { ...defaults }
    try {
      options = loadSoundOptions(localStorage.getItem(SOUND_KEY))
    } catch {
      /* optional storage */
    }
    this.state = {
      options,
      ready: false,
      voiceStatus:
        'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
          ? 'loading'
          : 'unsupported',
      audioSupported: Boolean(
        window.AudioContext || (window as SoundWindow).webkitAudioContext,
      ),
    }
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish(patch: Partial<SoundState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
  mount = () => {
    this.mounted = true
    this.findVoice()
    const gesture = (event: Event) => {
      // The resume button handles its own gesture. Do not turn a resume click
      // into a mute when pointerdown resolves before the later click event.
      if (
        event.target instanceof Element &&
        event.target.closest('.sound-toggle')
      )
        return
      if (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key))
        return
      if (this.state.options.enabled && !this.state.ready) this.activate()
    }
    const hide = () => {
      this.stopAll()
      this.publish({ ready: false })
      void this.context?.suspend().catch(() => {})
    }
    const visibility = () => {
      if (document.hidden) hide()
      else if (this.activated && this.state.options.enabled) this.activate()
    }
    document.addEventListener('pointerdown', gesture, true)
    document.addEventListener('keydown', gesture, true)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', hide)
    window.addEventListener('pageshow', visibility)
    if (this.state.voiceStatus !== 'unsupported') {
      window.speechSynthesis.addEventListener('voiceschanged', this.findVoice)
      this.voiceTimer = window.setTimeout(() => {
        if (this.state.voiceStatus === 'loading')
          this.publish({ voiceStatus: 'unavailable' })
      }, 1500)
    }
    return () => {
      this.mounted = false
      this.stopAll()
      window.clearTimeout(this.voiceTimer)
      document.removeEventListener('pointerdown', gesture, true)
      document.removeEventListener('keydown', gesture, true)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', hide)
      window.removeEventListener('pageshow', visibility)
      if (this.state.voiceStatus !== 'unsupported')
        window.speechSynthesis.removeEventListener(
          'voiceschanged',
          this.findVoice,
        )
      void this.context?.suspend().catch(() => {})
    }
  }
  private findVoice = () => {
    if (this.state.voiceStatus === 'unsupported') return
    const japanese = window.speechSynthesis
      .getVoices()
      .filter((v) => /^ja(?:[-_]|$)/i.test(v.lang))
    this.voice = japanese.find((v) => v.localService) ?? japanese[0] ?? null
    if (this.voice) this.publish({ voiceStatus: 'available' })
    else if (this.state.voiceStatus !== 'loading')
      this.publish({ voiceStatus: 'unavailable' })
  }
  setOptions = (patch: Partial<SoundOptions>) => {
    const options = loadSoundOptions(
      JSON.stringify({ ...this.state.options, ...patch }),
    )
    this.publish({ options })
    try {
      localStorage.setItem(SOUND_KEY, JSON.stringify(options))
    } catch {
      /* optional storage */
    }
    if (!options.enabled) {
      this.stopAll()
      void this.context?.suspend().catch(() => {})
    } else {
      if (!options.narration || options.volume === 0) this.stopSpeech()
      if (!options.effects) this.stopNodes(this.effectNodes)
      this.activate()
    }
  }
  toggle = () => {
    if (this.state.options.enabled && !this.state.ready) this.activate()
    else this.setOptions({ enabled: !this.state.options.enabled })
  }
  activate = () => {
    if (!this.state.options.enabled || document.hidden || !this.mounted) return
    if (!this.activated && this.state.voiceStatus !== 'unsupported') {
      // A direct gesture primes speech on mobile browsers as well as Web Audio.
      const prime = new SpeechSynthesisUtterance(' ')
      prime.volume = 0
      try {
        window.speechSynthesis.speak(prime)
      } catch {
        /* unavailable voice engine */
      }
    }
    this.activated = true
    if (!this.state.audioSupported) {
      this.publish({ ready: true })
      return
    }
    try {
      if (!this.context) {
        const Constructor =
          window.AudioContext ?? (window as SoundWindow).webkitAudioContext!
        this.context = new Constructor()
        this.context.onstatechange = () => {
          const ready = this.context?.state === 'running'
          if (this.state.ready !== ready) this.publish({ ready })
        }
        this.master = this.context.createGain()
        this.music = this.context.createGain()
        this.effects = this.context.createGain()
        this.music.connect(this.master)
        this.effects.connect(this.master)
        this.master.connect(this.context.destination)
      }
      this.master!.gain.value = this.state.options.volume
      this.music!.gain.value = this.speaking ? 0.018 : 0.075
      this.effects!.gain.value = 0.16
      const context = this.context
      void context
        .resume()
        .then(() => {
          if (!this.mounted || !this.state.options.enabled || document.hidden) {
            this.stopAll()
            void context.suspend().catch(() => {})
            return
          }
          this.publish({ ready: context.state === 'running' })
          this.syncMusic()
        })
        .catch(() => this.publish({ ready: false }))
    } catch {
      this.publish({ ready: false })
    }
  }
  private tone(
    midi: number,
    at: number,
    duration: number,
    level: number,
    group: 'music' | 'effect',
    type: OscillatorType = 'sine',
  ) {
    if (!this.context) return
    const node = this.context.createOscillator(),
      envelope = this.context.createGain()
    const pool = group === 'music' ? this.musicNodes : this.effectNodes
    node.type = type
    node.frequency.value = 440 * 2 ** ((midi - 69) / 12)
    envelope.gain.setValueAtTime(0.0001, at)
    envelope.gain.exponentialRampToValueAtTime(level, at + 0.025)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    node.connect(envelope)
    envelope.connect((group === 'music' ? this.music : this.effects)!)
    pool.add(node)
    node.onended = () => {
      pool.delete(node)
      node.disconnect()
      envelope.disconnect()
    }
    node.start(at)
    node.stop(at + duration + 0.02)
  }
  private syncMusic() {
    if (!this.state.options.bgm || !this.state.options.volume) {
      window.clearInterval(this.musicTimer)
      this.musicTimer = undefined
      this.stopNodes(this.musicNodes)
      return
    }
    if (this.musicTimer !== undefined || this.context?.state !== 'running')
      return
    this.nextBeat = this.context.currentTime + 0.05
    const chords = [
      [50, 57, 62, 65],
      [46, 53, 58, 62],
      [48, 55, 60, 64],
      [45, 52, 57, 61],
    ]
    const schedule = () => {
      if (!this.context) return
      while (this.nextBeat < this.context.currentTime + 0.3) {
        const chord = chords[Math.floor(this.beat / 8) % chords.length]
        this.tone(
          chord[this.beat % 4] + 12,
          this.nextBeat,
          0.6,
          0.28,
          'music',
          'triangle',
        )
        if (this.beat % 4 === 0)
          this.tone(chord[0] - 12, this.nextBeat, 1.8, 0.5, 'music')
        if (this.beat % 8 === 0)
          for (const note of chord.slice(1))
            this.tone(note, this.nextBeat, 3.7, 0.2, 'music')
        this.beat++
        this.nextBeat += 0.48
      }
    }
    schedule()
    this.musicTimer = window.setInterval(schedule, 120)
  }
  cue(kind: 'waiting' | 'reveal') {
    if (
      !this.state.options.enabled ||
      !this.state.options.effects ||
      !this.state.options.volume ||
      document.hidden ||
      this.context?.state !== 'running'
    )
      return
    const now = this.context.currentTime + 0.01
    if (kind === 'waiting') {
      for (let i = 0; i < 9; i++)
        this.tone(
          38 + (i % 2),
          now + i * 0.14,
          0.12,
          0.2 + i * 0.025,
          'effect',
          'triangle',
        )
    } else {
      for (const [i, note] of [62, 69, 74, 77].entries())
        this.tone(note, now + i * 0.075, 0.65, 0.45, 'effect', 'triangle')
    }
  }
  speak(clauses: string[]): {
    active: boolean
    finished: Promise<void>
    cancel: () => void
  } {
    this.stopSpeech()
    if (
      !this.state.options.enabled ||
      !this.state.options.narration ||
      !this.state.options.volume ||
      !this.state.ready ||
      document.hidden ||
      !this.voice ||
      !clauses.length
    )
      return { active: false, finished: Promise.resolve(), cancel: () => {} }
    let ended = false,
      timer: number | undefined,
      watchdog: number | undefined
    let utterance: SpeechSynthesisUtterance | null = null
    let resolve!: () => void
    const finished = new Promise<void>((done) => {
      resolve = done
    })
    const complete = () => {
      if (ended) return
      ended = true
      window.clearTimeout(timer)
      window.clearTimeout(watchdog)
      if (utterance) {
        utterance.onend = null
        utterance.onerror = null
      }
      this.speaking = false
      if (this.music && this.context)
        this.music.gain.setTargetAtTime(0.075, this.context.currentTime, 0.2)
      if (this.cancelCurrentSpeech === cancel) this.cancelCurrentSpeech = null
      resolve()
    }
    const cancel = () => {
      complete()
      window.speechSynthesis.cancel()
    }
    const run = (index: number) => {
      if (ended) return
      if (index >= clauses.length) {
        complete()
        return
      }
      utterance = new SpeechSynthesisUtterance(clauses[index])
      utterance.lang = 'ja-JP'
      utterance.voice = this.voice
      utterance.rate = 0.88
      utterance.pitch = 1
      utterance.volume = Math.min(1, this.state.options.volume * 1.7)
      utterance.onend = () => {
        window.clearTimeout(watchdog)
        if (!ended) timer = window.setTimeout(() => run(index + 1), 420)
      }
      utterance.onerror = complete
      // Some mobile engines omit end/error. Never hold the draft indefinitely.
      watchdog = window.setTimeout(
        cancel,
        Math.min(20000, Math.max(7000, clauses[index].length * 500)),
      )
      try {
        window.speechSynthesis.speak(utterance)
      } catch {
        complete()
      }
    }
    this.cancelCurrentSpeech = cancel
    window.speechSynthesis.cancel()
    this.speaking = true
    if (this.music && this.context)
      this.music.gain.setTargetAtTime(0.018, this.context.currentTime, 0.12)
    run(0)
    return { active: true, finished, cancel }
  }
  stopSpeech = () => {
    this.cancelCurrentSpeech?.()
  }
  stopEffects = () => {
    this.stopNodes(this.effectNodes)
  }
  private stopNodes(pool: Set<OscillatorNode>) {
    for (const node of pool) {
      try {
        node.stop()
      } catch {
        /* already ended */
      }
    }
    pool.clear()
  }
  private stopAll() {
    this.stopSpeech()
    this.stopEffects()
    window.clearInterval(this.musicTimer)
    this.musicTimer = undefined
    this.stopNodes(this.musicNodes)
  }
}
