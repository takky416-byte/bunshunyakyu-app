import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Download,
  Eye,
  Gamepad2,
  KeyRound,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Users,
} from 'lucide-react'
import {
  shiftDate,
  tokyoDate,
  type AnalyticsReport,
} from './analytics-contract'
import { teamById } from './data'
import './analytics-admin.css'

function datetime(value: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value))
}
function DailyChart({ rows }: { rows: AnalyticsReport['daily'] }) {
  const max = Math.max(
    2,
    Math.ceil(
      Math.max(0, ...rows.map((r) => Math.max(r.pageViews, r.starts))) / 2,
    ) * 2,
  )
  const x = (i: number) =>
    rows.length === 1 ? 360 : 40 + (i / (rows.length - 1)) * 650
  const y = (n: number) => 165 - (n / max) * 130
  const points = (key: 'pageViews' | 'starts') =>
    rows.map((r, i) => `${x(i)},${y(r[key])}`).join(' ')
  return (
    <svg
      viewBox="0 0 720 210"
      className="admin-chart"
      role="img"
      aria-label={`${rows[0]?.date}から${rows.at(-1)?.date}までのアクセス数とプレー開始回数。数値は下の日別集計表で確認できます。`}
    >
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line
            x1="40"
            x2="695"
            y1={y(max * f)}
            y2={y(max * f)}
            stroke="#e3e8da"
            strokeDasharray="3 5"
          />
          <text x="30" y={y(max * f) + 4} textAnchor="end">
            {Math.round(max * f)}
          </text>
        </g>
      ))}
      <polyline
        points={points('pageViews')}
        stroke="#9fae83"
        fill="none"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <polyline
        points={points('starts')}
        stroke="#315d43"
        fill="none"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {rows.length <= 31 &&
        rows.map((r, i) => (
          <circle key={r.date} cx={x(i)} cy={y(r.starts)} r="3" fill="#315d43">
            <title>
              {r.date} 開始{r.starts}回 / アクセス{r.pageViews}PV
            </title>
          </circle>
        ))}
      {[0, Math.floor((rows.length - 1) / 2), rows.length - 1]
        .filter((n, i, list) => list.indexOf(n) === i)
        .map((i) => (
          <text key={i} x={x(i)} y="194" textAnchor="middle">
            {rows[i]?.date.slice(5).replace('-', '/')}
          </text>
        ))}
    </svg>
  )
}
function exportCsv(report: AnalyticsReport) {
  const lines = [
    '日付（日本時間）,アクセス数PV,推定利用者数,プレー開始人数,開始回数,完了回数',
    ...report.daily.map((r) =>
      [
        r.date,
        r.pageViews,
        r.visitors,
        r.players,
        r.starts,
        r.completions,
      ].join(','),
    ),
  ]
  const url = URL.createObjectURL(
    new Blob(['\uFEFF' + lines.join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = `draft-analytics-${report.from}-${report.to}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export default function AnalyticsAdmin() {
  const today = tokyoDate()
  const [from, setFrom] = useState(shiftDate(today, -29))
  const [to, setTo] = useState(today)
  const [input, setInput] = useState('')
  const [key, setKey] = useState('')
  const [report, setReport] = useState<AnalyticsReport | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const refresh = useCallback(async () => {
    if (!key) return
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setLoading(true)
    setError('')
    try {
      const response = await fetch(
        `/api/analytics/admin/summary?${new URLSearchParams({ from, to })}`,
        {
          headers: { Authorization: `Bearer ${key}` },
          signal: request.signal,
          cache: 'no-store',
          credentials: 'omit',
        },
      )
      if (response.status === 401) {
        setKey('')
        setReport(null)
        throw new Error('管理キーを確認してください。')
      }
      if (!response.ok) {
        const value = await response.json().catch(() => null)
        throw new Error(
          value?.error ||
            '集計APIに接続できません。アプリのサーバーを起動してください。',
        )
      }
      const value: AnalyticsReport = await response.json()
      if (!request.signal.aborted) {
        setReport(value)
        setInput('')
      }
    } catch (e) {
      if (!request.signal.aborted)
        setError(
          e instanceof Error ? e.message : '集計を読み込めませんでした。',
        )
    } finally {
      if (!request.signal.aborted) setLoading(false)
    }
  }, [key, from, to])
  useEffect(() => {
    if (!key) return
    setReport(null)
    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, 30_000)
    return () => {
      window.clearInterval(timer)
      controller.current?.abort()
    }
  }, [key, refresh])
  function login(e: FormEvent) {
    e.preventDefault()
    setError('')
    setKey(input.trim())
  }
  function logout() {
    controller.current?.abort()
    setKey('')
    setInput('')
    setReport(null)
    setError('')
    setLoading(false)
  }
  const metrics = [
    {
      label: 'アクセス数',
      unit: 'PV',
      value: report?.totals.pageViews,
      icon: Eye,
      help: 'ページの読み込み回数。再読み込みも含みます。',
    },
    {
      label: '推定利用者数',
      unit: '人',
      value: report?.totals.visitors,
      icon: Users,
      help: '期間内にアクセスまたはプレーしたブラウザ識別IDの数。',
    },
    {
      label: 'プレー開始人数',
      unit: '人',
      value: report?.totals.players,
      icon: Gamepad2,
      help: '期間内にプレーを開始したブラウザ識別IDの数。',
    },
    {
      label: '開始回数',
      unit: '回',
      value: report?.totals.starts,
      icon: Activity,
      help: '「この球団ではじめる」を押して新しく始めた回数。再開は含みません。',
    },
    {
      label: '完了回数',
      unit: '回',
      value: report?.totals.completions,
      icon: CheckCircle2,
      help: '期間内に結果画面へ到達した回数。開始が期間外でも含みます。',
    },
  ]
  return (
    <div className="analytics-admin">
      <header className="admin-header">
        <a href="/" className="admin-brand">
          <span className="brand-icon">
            <span />
          </span>
          <span>
            現役ドラフトルーム<small>OWNER'S DASHBOARD</small>
          </span>
        </a>
        <a className="admin-back" href="/">
          <ArrowLeft size={15} />
          ゲームに戻る
        </a>
        {key && (
          <button className="admin-back" onClick={logout}>
            <LogOut size={15} />
            ログアウト
          </button>
        )}
      </header>
      <main className="admin-main">
        {!key ? (
          <section className="admin-login panel">
            <div className="admin-lock">
              <LockKeyhole size={27} />
            </div>
            <span className="eyebrow dark">PRIVATE / ANALYTICS</span>
            <h1>プレーヤーの動きを、知る。</h1>
            <p>
              アクセスとプレーの記録を確認する、
              <br />
              管理者専用のダッシュボードです。
            </p>
            <form onSubmit={login}>
              <label htmlFor="admin-key">管理キー</label>
              <input
                id="admin-key"
                type="password"
                autoComplete="current-password"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="管理キーを入力"
                required
              />
              {error && (
                <div className="admin-error" role="alert">
                  {error}
                </div>
              )}
              <button
                className="button primary"
                type="submit"
                disabled={!input.trim()}
              >
                <KeyRound size={16} />
                ダッシュボードを開く
              </button>
            </form>
            <small>管理キーは端末への保存やURLへの付加を行いません。</small>
          </section>
        ) : (
          <>
            <div className="admin-title">
              <div>
                <span className="eyebrow dark">KNOW YOUR PLAYERS</span>
                <h1>アクセスと、プレーの記録。</h1>
                <p>いつ、どれだけ遊ばれているか。日本時間で確認できます。</p>
              </div>
              <button
                className="button ghost"
                onClick={() => void refresh()}
                disabled={loading}
              >
                <RefreshCw
                  size={15}
                  className={loading ? 'admin-spinning' : ''}
                />
                {loading ? '更新中' : '最新に更新'}
              </button>
            </div>
            <div className="admin-period panel">
              <CalendarDays size={18} />
              <span>集計期間</span>
              <label>
                開始日
                <input
                  type="date"
                  aria-label="集計開始日"
                  min={shiftDate(today, -179)}
                  max={to || today}
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <span>—</span>
              <label>
                終了日
                <input
                  type="date"
                  aria-label="集計終了日"
                  min={from || shiftDate(today, -179)}
                  max={today}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
              <div className="admin-presets">
                {[7, 30, 90, 180].map((n) => (
                  <button
                    key={n}
                    className={
                      from === shiftDate(today, -(n - 1)) && to === today
                        ? 'selected'
                        : ''
                    }
                    onClick={() => {
                      setFrom(shiftDate(today, -(n - 1)))
                      setTo(today)
                    }}
                  >
                    {n}日
                  </button>
                ))}
              </div>
            </div>
            {error && (
              <div className="admin-error" role="alert">
                {error}
              </div>
            )}
            {!report ? (
              <div className="admin-loading" role="status">
                {loading
                  ? '記録を集計しています…'
                  : '集計期間を確認して、最新に更新してください。'}
              </div>
            ) : (
              <>
                <div className="admin-metrics">
                  {metrics.map((m) => (
                    <section
                      key={m.label}
                      className="panel admin-metric"
                      aria-label={m.label}
                    >
                      <span>
                        <m.icon size={16} />
                        {m.label}
                      </span>
                      <strong>
                        {m.value!.toLocaleString('ja-JP')}
                        <small>{m.unit}</small>
                      </strong>
                      <p>{m.help}</p>
                    </section>
                  ))}
                </div>
                {report.totals.visitors === 0 && (
                  <div className="admin-empty-notice">
                    この期間の記録はまだありません。ゲームへのアクセスやプレー開始後に表示されます。
                  </div>
                )}
                <div className="admin-chart-grid">
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>日別の利用状況</h2>
                        <p>
                          {report.from} — {report.to} / 日本時間
                        </p>
                      </div>
                      <span className="admin-legend">
                        <i />
                        アクセス数
                        <b />
                        開始回数
                      </span>
                    </div>
                    <DailyChart rows={report.daily} />
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>プレーされる時間帯</h2>
                        <p>{report.to} / 各時間帯のプレー開始人数</p>
                      </div>
                    </div>
                    <div
                      className="admin-hours"
                      role="img"
                      aria-label={`${report.to}の時間帯別プレー開始人数`}
                    >
                      {report.hourly.map((h) => (
                        <div
                          key={h.hour}
                          className="admin-hour"
                          title={`${h.hour}時：${h.players}人 / ${h.starts}回開始`}
                        >
                          <span
                            style={{
                              height: `${(h.players / Math.max(1, ...report.hourly.map((v) => v.players))) * 100}%`,
                            }}
                          >
                            <b>{h.players > 0 ? h.players : ''}</b>
                          </span>
                          <small>{h.hour % 3 === 0 ? h.hour : ''}</small>
                        </div>
                      ))}
                    </div>
                    <p className="admin-chart-note">
                      0〜23時。同じ人が別の時間帯に開始すると、それぞれに数えます。
                    </p>
                  </section>
                </div>
                <div className="admin-lower-grid">
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>選ばれた球団</h2>
                        <p>期間内に新しく開始されたプレー</p>
                      </div>
                    </div>
                    <div className="admin-team-list">
                      {[...report.teams]
                        .sort((a, b) => b.starts - a.starts)
                        .map((t) => (
                          <div key={t.team}>
                            <span
                              className="admin-team-dot"
                              style={{ background: teamById[t.team].color }}
                            />
                            <strong>{teamById[t.team].short}</strong>
                            <span className="admin-team-track">
                              <i
                                style={{
                                  width: `${(t.starts / Math.max(1, ...report.teams.map((r) => r.starts))) * 100}%`,
                                  background: teamById[t.team].color,
                                }}
                              />
                            </span>
                            <b>
                              {t.starts}
                              <small>回</small>
                            </b>
                          </div>
                        ))}
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>最近開始されたプレー</h2>
                        <p>期間内の直近50件 / 日本時間・受信時刻</p>
                      </div>
                    </div>
                    <div className="table-scroll admin-recent">
                      <table>
                        <thead>
                          <tr>
                            <th>開始日時</th>
                            <th>球団</th>
                            <th>完了日時</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.recentPlays.map((p, i) => (
                            <tr key={i}>
                              <td>{datetime(p.startedAt)}</td>
                              <td>{teamById[p.team].short}</td>
                              <td>
                                {p.completedAt ? (
                                  <span className="admin-completed">
                                    {datetime(p.completedAt)}
                                  </span>
                                ) : (
                                  <span className="admin-pending">未完了</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {report.recentPlays.length === 0 && (
                        <p className="admin-empty-table">
                          プレー開始の記録はまだありません。
                        </p>
                      )}
                    </div>
                  </section>
                </div>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>日別集計</h2>
                      <p>人数はブラウザ識別IDによる推定値です。</p>
                    </div>
                    <button
                      className="button ghost"
                      onClick={() => exportCsv(report)}
                    >
                      <Download size={15} />
                      CSVを保存
                    </button>
                  </div>
                  <div className="table-scroll admin-daily">
                    <table>
                      <thead>
                        <tr>
                          <th>日付</th>
                          <th>アクセス数</th>
                          <th>利用者数</th>
                          <th>プレー人数</th>
                          <th>開始回数</th>
                          <th>完了回数</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...report.daily].reverse().map((r) => (
                          <tr key={r.date}>
                            <td>{r.date}</td>
                            <td>{r.pageViews.toLocaleString()}</td>
                            <td>{r.visitors.toLocaleString()}</td>
                            <td>{r.players.toLocaleString()}</td>
                            <td>{r.starts.toLocaleString()}</td>
                            <td>{r.completions.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <div className="admin-notes">
                  <p>
                    <strong>数字の読み方</strong>
                    ：人数は実人数ではありません。同じ人でも端末・ブラウザ・データ削除によって別に数えます。日別人数の合計と期間全体の人数は一致しないことがあります。未完了には途中離脱・プレー中・計測停止・送信失敗も含まれます。
                  </p>
                  <p>
                    開始は球団決定時、完了は結果画面に到達した時に記録。既存ゲームの再開は新しい開始に数えません。ボットによる偽装や送信拒否による欠測を完全には除外できません。記録は直近180日分です。
                  </p>
                  <span>
                    最終集計：{datetime(report.generatedAt)} JST /
                    30秒ごとに更新
                  </span>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}
