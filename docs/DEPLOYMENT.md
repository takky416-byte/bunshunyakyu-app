# 無料枠での本番公開

GitHubにソースを保存し、**Cloudflare Workers Free＋Static Assets＋SQLite Durable Objects＋D1 Free**にゲームと集計APIを配置する。無料の `workers.dev` アドレスでHTTPS配信でき、独自ドメインは不要。GitHubリポジトリを公開に変更する必要もない。

2026-10-24に本番公開済み。ゲーム：[https://geneki-draft-room.takky416.workers.dev](https://geneki-draft-room.takky416.workers.dev)。管理画面は同じURLの `/admin`。プレーヤーにはCloudflare認証もアカウント登録も不要。

管理キーは`.local-data/cloudflare-admin.key`の非公開ファイルに保持し、ソースや本文へ掲載しない。ルームはWorkerの`ROOMS`バインディングを使い、`DraftRoom`のSQLiteクラスをWranglerのマイグレーションで追加する。既存のD1と管理キーは維持する。構成と遊び方は[ROOMS.md](ROOMS.md)を参照。

作業環境のChromiumは公開HTTPS証明書の信頼設定が合わないため、ブラウザ操作はローカル環境で試験し、公開HTTPS/APIは証明書検証を有効にして確認する。Cloudflareのローカルランタイムでも、ルーム作成・参加、認証済みWebSocket、チャット、開始、非公開の状態配信、再接続・退出を検証する。

## 費用と上限

Workersの静的アセット配信は無料で、API実行にはFreeプランの1日100,000リクエスト等の上限がある。D1にも読み取り・書き込み・容量の無料枠がある。**有料プランへ変更しない**運用とし、上限に達した際のエラーを許容する。SQLiteストレージのDurable ObjectsはWorkers Freeで使用でき、1日100,000リクエストなどの無料枠がある。WebSocket Hibernationとアラームを使い、待機中の常駐タイマーを避ける。料金体系は変更され得るため、作成時の公式画面も確認する。

集計サービスがエラーになってもゲームは継続できる。ルームの進行にはWorkersとDurable Objectsが必要なため、それらの障害時は再接続を待つ。未送信イベントはブラウザ内で再送を試すが、欠測はあり得る。独自ドメイン、有料プラン、追加ストレージはこの構成に含めない。

- [Workers公式料金](https://developers.cloudflare.com/workers/platform/pricing/)
- [Durable Objects公式料金・無料枠](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [D1公式料金・無料枠](https://developers.cloudflare.com/d1/platform/pricing/)

## 初回公開の準備

Cloudflare無料アカウントのアカウントIDとAPIトークンが必要。トークンは対象アカウントに限定し、`Account / Workers Scripts / Edit` と `Account / D1 / Edit` を付与する。初回の `workers.dev` サブドメインはCloudflareのWorkers & Pages画面で設定する。アカウント設定やトークンの権限により、追加の初期設定を求められる場合がある。

Codexから公開する場合は、環境設定で `CLOUDFLARE_ACCOUNT_ID` と秘密値 `CLOUDFLARE_API_TOKEN`（送信先 `api.cloudflare.com`）を設定する。値をチャット・GitHubのファイル・公開URLへ書かない。自分のPCから公開する場合も、安全なプロセス環境変数またはGit管理外の `.env.local` を使う。

Node.js 24を用い、リポジトリのルートで実行する。

```sh
npm ci --include=dev --no-audit --no-fund
npm run build
npm test
npm run test:data
npm run cloudflare:check
```

`cloudflare:check` はビルド成果物とWorkerのドライランで、外部サービスを作成しない。Wranglerの作業用設定・ログはGit管理外の `.cache/` に置く。

## D1作成と公開

認証を設定したプロセスで、まずD1を1つ作成する。

```sh
npm run cloudflare:create-db
```

出力された本物の `database_id` を次のコマンドへ渡す。IDは秘密値ではない。`wrangler.jsonc` のプレースホルダーが残っている間は、本番公開コマンドが停止する。

```sh
npm run cloudflare:configure -- <database_id>
npm run cloudflare:migrate
npm run cloudflare:deploy
npm run cloudflare:admin-key
```

`cloudflare:admin-key` は暗号学的乱数で本番管理キーを生成し、CloudflareのWorker Secret `ANALYTICS_ADMIN_KEY` にアップロードする。キーを標準出力へ表示しない。所有者用の控えはGit管理外の `.local-data/cloudflare-admin.key` に権限600で保持する。既存ファイルを再実行で上書きしない。初回デプロイからSecretの登録が終わるまで管理APIは503で閉じている。

本番のキーはローカル試験用 `.dev.vars` と別。フロントのビルドにキーを含めない。公開URLの `/admin` で、所有者が安全に確認した本番キーを入力する。管理キーは画面メモリだけに保持する。

## 公開後の確認

1. デプロイで発行された実際のHTTPS URLを確認し、ゲームと `/admin` を開く。
2. `/api/analytics/health` が200、認証なしの `/api/analytics/admin/summary` が401であることを確認する。
3. 球団選択から結果までプレーし、管理画面で開始・完了が1回ずつ増えること、日本時間の日時、CSVを確認する。再読み込みで開始・完了を増やさない。
4. モバイル幅で操作し、計測停止後もゲームが進むことを確認する。
5. 再デプロイ後もD1の集計とWorker Secretが残ることを確認する。ローカルDBのテスト記録は本番D1へ移さない。

D1はWorkerの再配置と独立した保存先。DB自体を削除するとデータも失われる。バックアップ・復元にはD1のエクスポート等を使い、取得ファイルを公開アセットやGitへ入れない。

## 更新

通常はテストとビルド後、`npm run cloudflare:migrate`、`npm run cloudflare:deploy` を手動で実行する。管理キーは更新のたびに再生成しない。

2026-10-29の戦力外情報更新は公開反映済み。アプリのソースは`312b06f`、本番Workerバージョンは`3ca9bd9f-8859-4a51-9a7f-fe013872abaf`。本番APIで個別確認した57名の候補提出を拒否し、12球団の候補に報道反映済み175名が含まれないことを確認した。公開トップとフロントエンド11ファイル、旧版互換を含む読み上げ音声9ファイルもビルド成果物と一致し、集計APIと管理認証も確認済み。

この公開では、本番Worker名での`assets-upload-session`がHTTP 500／10013になったため、同じアカウントの別名でアセットのアップロードセッションを作成した。全配信ファイルのマニフェストを登録し、要求されたファイルを小分けのmultipartで転送した後、完了JWTを使って元のWorker名へ通常のビルドをバージョン登録し、100%へ切り替えた。公開URL・D1・Durable Objectの名前空間・管理用Secret・`/api/*`のルーティングを保持している。静的ファイルをWorkerコードに埋め込む回避策は本番では使っていない。実行スクリプト・検証結果・非公開の取得応答は作業環境のGit管理外`.cache/departures-2026-10-29/`に記録し、認証情報やアップロードJWTをGitへ追加しない。

任意でGitHub Actionsの `Deploy free Cloudflare app` を手動実行できる。`wrangler.jsonc` に実際のD1 IDを反映し、GitHubの `production` 環境のSecretsに `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を設定する。初回管理キー登録は別途必要。自動デプロイは行わない。非公開リポジトリではActionsにも無料実行時間の上限があるため、利用する場合はGitHubの課金設定を確認する。ローカルからの公開にActionsは必要ない。

## ローカルでCloudflare構成を確認

```sh
npm run build
npm run cloudflare:key:local
npm run cloudflare:migrate:local
npm run cloudflare:dev
```

ポート8787で静的アセットとWorker APIを実行し、D1はGit管理外の `.wrangler/` に保存する。管理キーは権限600の `.dev.vars` に一度だけ生成する。本番アカウント・トークンは不要。定期削除のCronはローカルで自動実行されないため、WranglerのローカルScheduledイベントを使って確認する。

GitHub Pagesは静的ファイルの配信のみなので、この集計API・D1と同じ構成をそのまま配置することはできない。Node.js＋SQLite版の `npm start` も引き続き利用できるが、外部で動かす際には別途永続ディスクが必要。
