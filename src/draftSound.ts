import { speechKey, type SpeechClause } from './draftSpeech'
import maleVoice from './maleVoice2026.json' with { type: 'json' }
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
  voiceError: boolean
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

export function chooseMaleVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  return (
    voices.find((voice) => {
      const name = voice.name + ' ' + voice.voiceURI
      return (
        /^ja(?:[-_]|$)/i.test(voice.lang) &&
        !/female|女性|nanami|haruka|sayaka|kyoko/i.test(name) &&
        /ichiro|keita|otoya|takumi|hattori|(?:^|[\s(_-])male(?:$|[\s)_-])|男性|いちろう|おとや/i.test(
          name,
        )
      )
    }) ?? null
  )
}

/** All oscillators are original synthesis. No media downloads or paid services. */
export class DraftSound {
  private state: SoundState
  private listeners = new Set<() => void>()
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private music: GainNode | null = null
  private effects: GainNode | null = null
  private narrationGain: GainNode | null = null
  private musicNodes = new Set<AudioScheduledSourceNode>()
  private effectNodes = new Set<AudioScheduledSourceNode>()
  private speechCache = new Map<string, AudioBuffer>()
  private musicTimer: number | undefined
  private voiceTimer: number | undefined
  private effectPreviewTimer: number | undefined
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
      voiceError: false,
      voiceStatus:
        window.AudioContext || (window as SoundWindow).webkitAudioContext
          ? 'available'
          : Boolean(window.speechSynthesis) &&
              typeof window.SpeechSynthesisUtterance === 'function'
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
    if (Boolean(window.speechSynthesis)) {
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
      if (Boolean(window.speechSynthesis))
        window.speechSynthesis.removeEventListener(
          'voiceschanged',
          this.findVoice,
        )
      void this.context?.suspend().catch(() => {})
    }
  }
  private findVoice = () => {
    if (!Boolean(window.speechSynthesis)) return
    // The primary voice is a fixed male recording. Never substitute a known
    // female system voice when imported/legacy text needs the fallback.
    this.voice = chooseMaleVoice(window.speechSynthesis.getVoices())
    if (this.state.audioSupported || this.voice)
      this.publish({ voiceStatus: 'available' })
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
      if (!options.effects || options.volume === 0) this.stopEffects()
      this.activate()
    }
  }
  toggle = () => {
    if (this.state.options.enabled && !this.state.ready) this.activate()
    else this.setOptions({ enabled: !this.state.options.enabled })
  }
  activate = () => {
    if (!this.state.options.enabled || document.hidden || !this.mounted) return
    if (
      !this.activated &&
      this.voice &&
      typeof window.SpeechSynthesisUtterance === 'function'
    ) {
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
        this.narrationGain = this.context.createGain()
        this.narrationGain.gain.value = 1.3
        this.music.connect(this.master)
        this.effects.connect(this.master)
        this.narrationGain.connect(this.master)
        const reverb = this.context.createConvolver()
        const impulse = this.context.createBuffer(
          2,
          this.context.sampleRate * 2,
          this.context.sampleRate,
        )
        for (let channel = 0; channel < 2; channel++) {
          const data = impulse.getChannelData(channel)
          for (let i = 0; i < data.length; i++)
            data[i] =
              (Math.random() * 2 - 1) * (1 - i / data.length) ** 3 * 0.18
        }
        reverb.buffer = impulse
        const wet = this.context.createGain()
        wet.gain.value = 0.2
        this.music.connect(reverb)
        this.effects.connect(reverb)
        reverb.connect(wet)
        wet.connect(this.master)
        const compressor = this.context.createDynamicsCompressor()
        compressor.threshold.value = -6
        compressor.knee.value = 6
        compressor.ratio.value = 4
        this.master.connect(compressor)
        compressor.connect(this.context.destination)
      }
      this.master!.gain.value = this.state.options.volume
      this.music!.gain.value = this.speaking ? 0.025 : 0.17
      this.effects!.gain.value = 0.7
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
    attack = 0.025,
    cutoff = 1800,
    detune = 0,
  ) {
    if (!this.context) return
    const node = this.context.createOscillator(),
      envelope = this.context.createGain()
    const pool = group === 'music' ? this.musicNodes : this.effectNodes
    node.type = type
    node.detune.value = detune
    node.frequency.value = 440 * 2 ** ((midi - 69) / 12)
    envelope.gain.setValueAtTime(0.0001, at)
    envelope.gain.exponentialRampToValueAtTime(level, at + attack)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    const filter = this.context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = cutoff
    node.connect(filter)
    filter.connect(envelope)
    envelope.connect((group === 'music' ? this.music : this.effects)!)
    pool.add(node)
    node.onended = () => {
      pool.delete(node)
      node.disconnect()
      envelope.disconnect()
      filter.disconnect()
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
        const chord = chords[this.beat % chords.length]
        // Slow string swells and soft simultaneous piano chords; no high
        // arpeggio, short pulse loop, or game-console lead tone.
        for (const note of chord) {
          this.tone(
            note,
            this.nextBeat,
            6.2,
            0.09,
            'music',
            'sawtooth',
            1.1,
            680,
            -4,
          )
          this.tone(
            note,
            this.nextBeat,
            6.2,
            0.09,
            'music',
            'sawtooth',
            1.1,
            680,
            4,
          )
          this.tone(
            note + 12,
            this.nextBeat + 0.1,
            3.3,
            0.12,
            'music',
            'sine',
            0.03,
            1200,
          )
        }
        this.tone(chord[0] - 12, this.nextBeat, 5.2, 0.25, 'music', 'sine', 0.3)
        this.beat++
        this.nextBeat += 4.8
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
      for (const offset of [0, 0.58, 1.16]) this.taiko(now + offset, 0.62)
    } else {
      this.taiko(now, 1.05)
      this.noise(now + 0.04, 1.2, 0.18, 3500)
      for (const note of [50, 57, 62])
        this.tone(note, now, 1.25, 0.09, 'effect', 'sawtooth', 0.035, 1600)
    }
  }
  previewEffects = () => {
    this.stopEffects()
    this.cue('waiting')
    this.effectPreviewTimer = window.setTimeout(() => {
      this.effectPreviewTimer = undefined
      this.cue('reveal')
    }, 1800)
  }
  private taiko(at: number, duration: number) {
    if (!this.context || !this.effects) return
    // Rounded skin attack and low resonant modes, with enough mid-bass to
    // carry on phone speakers. No rapid noise ticks in the waiting cue.
    for (const [start, end, level] of [
      [100, 45, 0.75],
      [185, 105, 0.28],
      [255, 155, 0.12],
    ]) {
      const node = this.context.createOscillator()
      const gain = this.context.createGain()
      const filter = this.context.createBiquadFilter()
      node.type = 'sine'
      node.frequency.setValueAtTime(start, at)
      node.frequency.exponentialRampToValueAtTime(end, at + 0.12)
      filter.type = 'lowpass'
      filter.frequency.value = 480
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(level, at + 0.025)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
      node.connect(filter)
      filter.connect(gain)
      gain.connect(this.effects)
      this.effectNodes.add(node)
      node.onended = () => {
        this.effectNodes.delete(node)
        node.disconnect()
        filter.disconnect()
        gain.disconnect()
      }
      node.start(at)
      node.stop(at + duration + 0.02)
    }
  }
  private noise(at: number, duration: number, level: number, highpass: number) {
    if (!this.context || !this.effects) return
    const buffer = this.context.createBuffer(
      1,
      Math.ceil(this.context.sampleRate * duration),
      this.context.sampleRate,
    )
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const node = this.context.createBufferSource(),
      filter = this.context.createBiquadFilter(),
      gain = this.context.createGain()
    node.buffer = buffer
    filter.type = 'highpass'
    filter.frequency.value = highpass
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(level, at + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    node.connect(filter)
    filter.connect(gain)
    gain.connect(this.effects)
    this.effectNodes.add(node)
    node.onended = () => {
      this.effectNodes.delete(node)
      node.disconnect()
      filter.disconnect()
      gain.disconnect()
    }
    node.start(at)
    node.stop(at + duration)
  }
  speak(clauses: SpeechClause[]): {
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
      (!this.context && !this.voice) ||
      !clauses.length
    )
      return { active: false, finished: Promise.resolve(), cancel: () => {} }
    let ended = false,
      timer: number | undefined,
      watchdog: number | undefined
    let utterance: SpeechSynthesisUtterance | null = null
    let source: AudioBufferSourceNode | null = null
    let request: AbortController | null = null
    let nativeActive = false
    const prepared = new Map<string, Promise<AudioBuffer>>()
    if (this.context) {
      const context = this.context
      request = new AbortController()
      const signal = request.signal
      // Fetch all three parts together so a mobile connection doesn't insert
      // a network pause between the player's name and affiliation.
      for (const clause of clauses) {
        const path = (maleVoice.clips as Record<string, string>)[
          speechKey(clause)
        ]
        if (!path || prepared.has(path)) continue
        const load = async () => {
          const cached = this.speechCache.get(path)
          if (cached) return cached
          const response = await fetch(path, { signal })
          if (!response.ok) throw new Error('Voice clip unavailable')
          const buffer = await context.decodeAudioData(
            await response.arrayBuffer(),
          )
          if (!ended) {
            this.speechCache.set(path, buffer)
            if (this.speechCache.size > 48)
              this.speechCache.delete(this.speechCache.keys().next().value!)
          }
          return buffer
        }
        const pending = load()
        void pending.catch(() => {})
        prepared.set(path, pending)
      }
    }
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
      request?.abort()
      if (source) {
        source.onended = null
        try {
          source.stop()
        } catch {
          /* ended */
        }
        source.disconnect()
      }
      this.speaking = false
      if (this.music && this.context)
        this.music.gain.setTargetAtTime(0.17, this.context.currentTime, 0.2)
      if (this.cancelCurrentSpeech === cancel) this.cancelCurrentSpeech = null
      resolve()
    }
    const cancel = () => {
      complete()
      if (nativeActive) window.speechSynthesis.cancel()
    }
    const run = (index: number) => {
      if (ended) return
      if (index >= clauses.length) {
        complete()
        return
      }
      const clause = clauses[index]
      const advance = () => {
        window.clearTimeout(watchdog)
        if (!ended)
          timer = window.setTimeout(() => run(index + 1), clause.pauseAfterMs)
      }
      const native = () => {
        if (
          !this.voice ||
          !(typeof window.SpeechSynthesisUtterance === 'function')
        ) {
          this.publish({ voiceError: true })
          advance()
          return
        }
        nativeActive = true
        utterance = new SpeechSynthesisUtterance(clause.text)
        utterance.lang = 'ja-JP'
        utterance.voice = this.voice
        utterance.rate = clause.rate
        utterance.pitch = 1
        utterance.volume = Math.min(1, this.state.options.volume * 1.7)
        utterance.onend = advance
        utterance.onerror = complete
        try {
          window.speechSynthesis.speak(utterance)
        } catch {
          complete()
        }
      }
      // Fetch, decode and native engines all have a bounded completion path.
      watchdog = window.setTimeout(
        cancel,
        Math.min(25000, Math.max(12000, clause.text.length * 600)),
      )
      const path = (maleVoice.clips as Record<string, string>)[
        speechKey(clause)
      ]
      if (!path || !this.context || !this.narrationGain) {
        native()
        return
      }
      const context = this.context
      const gain = this.narrationGain
      const load = async () => {
        const buffer = await prepared.get(path)!
        if (ended || document.hidden) return
        source = context.createBufferSource()
        source.buffer = buffer
        source.connect(gain)
        source.onended = () => {
          source?.disconnect()
          source = null
          advance()
        }
        source.start()
      }
      void load().catch(() => {
        if (!ended) {
          this.publish({ voiceError: true })
          native()
        }
      })
    }
    this.cancelCurrentSpeech = cancel
    if (Boolean(window.speechSynthesis)) window.speechSynthesis.cancel()
    this.speaking = true
    if (this.music && this.context)
      this.music.gain.setTargetAtTime(0.025, this.context.currentTime, 0.12)
    run(0)
    return { active: true, finished, cancel }
  }
  stopSpeech = () => {
    this.cancelCurrentSpeech?.()
  }
  stopEffects = () => {
    window.clearTimeout(this.effectPreviewTimer)
    this.effectPreviewTimer = undefined
    this.stopNodes(this.effectNodes)
  }
  private stopNodes(pool: Set<AudioScheduledSourceNode>) {
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
