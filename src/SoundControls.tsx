import { useEffect, useSyncExternalStore } from 'react'
import { SlidersHorizontal, Volume2, VolumeX } from 'lucide-react'
import { DraftSound } from './draftSound'
import './sound.css'
import { speechSample } from './draftSpeech'

export function SoundControls({
  sound,
  onSettings,
}: {
  sound: DraftSound
  onSettings: () => void
}) {
  const { options, ready } = useSyncExternalStore(
    sound.subscribe,
    sound.getSnapshot,
  )
  return (
    <div className="sound-controls">
      <button
        className="sound-toggle"
        aria-label="サウンドのオン・オフ"
        aria-pressed={options.enabled}
        onClick={sound.toggle}
      >
        {options.enabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
        {options.enabled && !ready
          ? '音を再開'
          : `音：${options.enabled ? 'オン' : 'オフ'}`}
      </button>
      <button
        className="sound-settings-button"
        aria-label="サウンド設定"
        onClick={onSettings}
      >
        <SlidersHorizontal size={16} />
      </button>
    </div>
  )
}

export function SoundSettings({ sound }: { sound: DraftSound }) {
  const { options, ready, voiceStatus, audioSupported, voiceError } =
    useSyncExternalStore(sound.subscribe, sound.getSnapshot)
  useEffect(
    () => () => {
      sound.stopSpeech()
      sound.stopEffects()
    },
    [sound],
  )
  return (
    <div className="sound-settings">
      <p>BGM・効果音・指名の読み上げを切り替えられます。</p>
      <label className="sound-option sound-master">
        <span>
          <strong>サウンド</strong>
          <small>オフにすると、すべての音が止まります。</small>
        </span>
        <input
          type="checkbox"
          checked={options.enabled}
          onChange={(e) => sound.setOptions({ enabled: e.target.checked })}
        />
      </label>
      <div className="sound-options">
        {(
          [
            ['bgm', 'BGM', '落ち着いたピアノと弦楽器の響き'],
            ['effects', '効果音', '大太鼓の合図と、指名決定の音'],
            [
              'narration',
              '指名の読み上げ',
              '獲得球団は略称、所属球団は正式名で案内',
            ],
          ] as const
        ).map(([key, title, description]) => (
          <label className="sound-option" key={key}>
            <span>
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
            <input
              type="checkbox"
              checked={options[key]}
              onChange={(e) => sound.setOptions({ [key]: e.target.checked })}
              disabled={
                key === 'narration'
                  ? voiceStatus === 'unsupported' ||
                    voiceStatus === 'unavailable'
                  : !audioSupported
              }
            />
          </label>
        ))}
      </div>
      <label className="sound-volume" htmlFor="sound-volume">
        <span>
          音量 <b>{Math.round(options.volume * 100)}%</b>
        </span>
        <input
          id="sound-volume"
          type="range"
          min="0"
          max="100"
          value={Math.round(options.volume * 100)}
          onChange={(e) =>
            sound.setOptions({ volume: Number(e.target.value) / 100 })
          }
        />
      </label>
      <button
        className="button ghost"
        disabled={
          !options.enabled ||
          !options.narration ||
          !ready ||
          voiceStatus !== 'available' ||
          !options.volume
        }
        onClick={() => {
          sound.stopEffects()
          sound.speak(speechSample())
        }}
      >
        読み上げを試す
      </button>
      <button
        className="button ghost"
        disabled={
          !options.enabled || !options.effects || !ready || !options.volume
        }
        onClick={() => {
          sound.stopSpeech()
          sound.previewEffects()
        }}
      >
        効果音を試す
      </button>
      <div className="sound-help" role="status">
        {!audioSupported && (
          <p>このブラウザではBGM・効果音を利用できません。</p>
        )}
        {voiceStatus === 'loading' && (
          <p>日本語の読み上げ音声を確認しています。</p>
        )}
        {(voiceStatus === 'unsupported' || voiceStatus === 'unavailable') && (
          <p>
            この端末では読み上げ音声を再生できません。対応する端末・ブラウザでお試しください。
          </p>
        )}
        {options.enabled && !ready && (
          <p>
            音を開始するには
            <button onClick={sound.activate}>ここを押してください</button>。
          </p>
        )}
        <p>
          読み上げは自然な男性アナウンスです。名前も他の部分と同じ速さで読み、苗字と名前を区切ります。選手名とポジションの間にも少し間を置きます。
        </p>
        {voiceError && (
          <p>
            一部の音声を読み込めませんでした。通信状況をご確認のうえ、もう一度お試しください。
          </p>
        )}
        <p>
          読み上げ中は自動送りを待機します。スキップ・消音・別のタブへの移動で音声は止まります。設定はこのブラウザに保存されます。
        </p>
      </div>
    </div>
  )
}
