# 無料枠での本番公開

GitHubにソースを保存し、**Cloudflare Workers Free＋Static Assets＋D1 Free**にゲームと集計APIを配置する。無料の `workers.dev` アドレスでHTTPS配信でき、独自ドメインは不要。GitHubリポジトリを公開に変更する必要もない。

2026-10-24に本番公開済み。ゲーム：[https://geneki-draft-room.takky416.workers.dev](https://geneki-draft-room.takky416.workers.dev)。管理画面は同じURLの `/admin`。プレーヤーにはCloudflare認証もアカウント登録も不要。

D1の初期化、管理キーのWorker Secret登録、公開アセットのビルド一致、HTTPSと認証付きAPI、開始・完了の記録、重複送信の排除、日本時間の集計を確認した。再デプロイ後も管理キーと記録が維持されることを確認し、検証用ブラウザIDの記録だけを削除済み。画面内の操作ボタン配置、文字の重なり・折り返し修正、テキストコピー、CPUの一軍戦力・ルーキー・直近上位指名の保護を更新。指名の自動送り・一時停止・タブ非表示時の停止、指名球団ごとのメイン・サブ配色を追加。年齢・プロ年数の表示と公式記録の照合を追加。第2巡の候補・希望順位への年俸と年齢の併記、末尾1文字の折り返し修正、コピー全文の事前表示を追加。BGM・効果音・端末の日本語音声による指名読み上げ、個別切替と音量調整を追加。男性の静的音声587本、名前だけ低速の読み上げ、巡・守備位置の明示的な読み、ピアノ・弦のBGM、強い効果音、第2巡の1件ずつの発表へ更新。前回のブラウザ試験37件を確認済み。今回はさらに低い声・強い名前の低速化・獲得球団の略称と名前の前の間・大太鼓の待機音を調整し、単体試験61件と関連ブラウザ試験8件が成功。データ試験15件も成功。実Web AudioでBGM・強い決定音・男性MP3のデコードと出力を確認。音声再生順・自動送りの待機・キャンセルは制御可能な音声時計でも検証した。管理キーは `.local-data/cloudflare-admin.key` の非公開ファイルに保持し、ソースや本文へ掲載しない。作業環境のChromiumは公開HTTPS証明書の信頼設定が合わず、公開URLを直接使うブラウザ試験は未実施。同じアプリの操作試験と、証明書検証を有効にした公開HTTPS/API試験で検証する。

## 費用と上限

Workersの静的アセット配信は無料で、API実行にはFreeプランの1日100,000リクエスト等の上限がある。D1にも読み取り・書き込み・容量の無料枠がある。**有料プランへ変更しない**運用とし、上限に達した際のエラーを許容する。料金体系は変更され得るため、作成時の公式画面も確認する。

集計サービスがエラーになってもゲームは継続できる。未送信イベントはブラウザ内で再送を試すが、欠測はあり得る。独自ドメイン、有料プラン、追加ストレージはこの構成に含めない。

- [Workers公式料金](https://developers.cloudflare.com/workers/platform/pricing/)
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
