import { useEffect, useState } from 'react'
import {
  privacyStatus,
  setAnalyticsEnabled,
  subscribePrivacy,
} from './analytics'
import './privacy.css'

export default function PrivacySettings() {
  const [status, setStatus] = useState(privacyStatus)
  useEffect(() => subscribePrivacy(() => setStatus(privacyStatus())), [])
  return (
    <div className="privacy-settings">
      <p>
        サービスの改善のため、アクセスとプレー開始・完了の時刻、選択した球団、ランダムに発行した識別IDを記録します。日時はサーバー受信時刻を日本時間で集計します。
      </p>
      <p>
        氏名・メールアドレス・IPアドレス・プレー中の選手の選択内容は、このアプリの集計データベースに保存しません。公開先のサーバーログは、この計測とは別です。
      </p>
      <p>
        ルームの進行には別途、ニックネーム・チャット・選手の選択内容をサーバーに一時保存します。これらは集計データベースには含めず、ルームの期限後に削除します。計測を停止しても、ルームの同期に必要な通信は行います。
      </p>
      <p>
        識別IDは同じブラウザからの再訪を区別するために使います。別端末・別ブラウザやブラウザデータの削除で別の利用者として数えるため、人数は推定値です。記録は直近180日分を保持します。
      </p>
      <label className="privacy-toggle">
        <input
          type="checkbox"
          checked={status === 'enabled'}
          disabled={status === 'browser'}
          onChange={(e) => {
            setAnalyticsEnabled(e.target.checked)
            setStatus(privacyStatus())
          }}
        />
        <span>
          <strong>利用状況の計測を許可する</strong>
          <small>
            {status === 'browser'
              ? 'ブラウザのDNT／GPC設定に従って計測を停止しています。'
              : status === 'enabled'
                ? 'アクセス・プレーの利用状況を送信します。'
                : 'このブラウザからの計測を停止しています。'}
          </small>
        </span>
      </label>
      <p className="small-print">
        停止すると、このブラウザの識別IDと未送信ログを削除します。すでにサーバーが受信した記録は消えません。停止中でもゲームをプレーできます。
      </p>
    </div>
  )
}
