# Alice HNS Wallet

_(For the English version, see [README.en.md](README.en.md) / 英語版は [README.en.md](README.en.md) を参照してください。)_

自宅で稼働する Handshake (HNS) フルノード `hsd` 8.x 系 + `hs-wallet` に接続する、個人利用専用の Web ウォレットです。

既存の [Bob Wallet](https://github.com/kyokan/bob-wallet) に依存せず、最新の hsd に接続できることを目的として開発しています。想定利用者は運営者本人 1 名のみ、管理対象は単一ウォレットです。秘密鍵の管理・署名処理は hs-wallet に委譲し、hsd / hs-wallet の API Key はブラウザーへ一切露出しません。

仕様の詳細は [docs/01-SPECIFICATION.md](docs/01-SPECIFICATION.md)、実装フェーズの詳細は [docs/02-IMPLEMENTATION-PLAN.md](docs/02-IMPLEMENTATION-PLAN.md) を参照してください。

> **Note:** hsd 自体の起動・停止・更新・データバックアップは本プロジェクトの管轄外です。稼働中の hsd ノードと hs-wallet を別途用意してください。

## 目次

- [機能](#機能)
- [アーキテクチャ](#アーキテクチャ)
- [必要環境](#必要環境)
- [セットアップ（本番運用 / Docker Compose）](#セットアップ本番運用--docker-compose)
- [セットアップ（開発環境）](#セットアップ開発環境)
- [環境変数](#環境変数)
- [開発コマンド](#開発コマンド)
- [メンテナンス](#メンテナンス)
- [セキュリティ設計](#セキュリティ設計)
- [非対応機能](#非対応機能)

## 機能

### 認証・アクセス制御

- 初回セットアップウィザードによる管理者アカウント作成
- パスワードログイン + TOTP による二要素認証（リカバリーコード対応）
- 送金・Name 操作などの重要操作前に再認証を要求
- HttpOnly / Secure / SameSite Cookie によるセッション管理、CSRF 二重送信トークン
- ルート単位のレート制限

### hsd 接続管理

- hsd Node / hs-wallet への接続設定を UI から登録・編集（保存前の疎通確認つき）
- 再起動不要でホットリロードされる接続マネージャー
- 定期ポーリングによる Node / Wallet の稼働状態監視、オンデマンド診断画面

### ウォレット

- 単一ウォレットの管理、Mnemonic インポート
- ウォレットのロック / アンロック
- 受信アドレス発行（QR コード表示・共有）
- 送金（手数料プレビュー → 確認 → 再認証、Idempotency Key による二重送信防止、送金後の自動再ロック）
- ページング対応のトランザクション履歴（Covenant 種別のラベル表示）

### Name 管理

- 保有 Name 一覧（フィルタ・ソート・検索、すべてクライアント側処理）
- Name 詳細表示、DNS Resource（NS / GLUE4 / GLUE6 / DS / TXT / SYNTH4 / SYNTH6）の追加・編集・削除・並び替え、変更前後の差分表示
- Renewal（個別・一括、ロック検知時は一括処理を安全に中断）
- Transfer / Finalize
- Revoke（パスワード + TOTP/リカバリーコードの再入力を必須とする Danger Zone）

### Name オークション

- Open（オークション開始）/ Bid / Reveal / Redeem / Register
- Name の利用可否（Availability）確認
- Reveal 期限接近時の通知

### 通知

- ダッシュボードの警告表示、アプリ内通知（更新期限・失効接近、Transfer 状態変化、送金確定/失敗、Node/Wallet 接続断など）
- 外部通知連携（ntfy / Discord Webhook） — Seed・秘密鍵・API Key・完全な残高などの機微情報は通知に含めない設計
- 監査ログ（すべての書き込み系操作の成功・失敗を記録、リクエストボディは記録しない）

### 配布

- Docker Compose によるシングルコンテナ配布
- 開発・検証用に hsd regtest を含む Compose Profile を同梱

## アーキテクチャ

pnpm workspaces によるモノレポ構成です。

```text
apps/
  server/   Hono 製 API サーバー（Node.js）。SQLite（better-sqlite3 + Drizzle ORM）、
            Argon2 によるパスワードハッシュ、TOTP（otpauth）を利用
  web/      Vite + React 18 + TanStack Router / Query による SPA
packages/
  domain/     Covenant・Renewal・DNS Resource バリデーションなど、フロント/バックエンド共有の純粋ロジック
  hsd-client/ hsd Node API / hs-wallet API 用の自作 HTTP クライアント
  schemas/    API 入出力用の Zod スキーマ
  config/     共有 tsconfig
```

フロントエンドは Next.js ではなく Vite + React の SPA を採用しています。これは Content Security Policy（外部スクリプト禁止・inline script 禁止など）をシンプルに保つための設計判断です。hsd-client は公式ドキュメントが存在しないため、実際の regtest ノードに対してプロービングしながら実装・検証しています。

## 必要環境

- Node.js 22 以上（[.nvmrc](.nvmrc) 参照）
- pnpm 10（`corepack enable` で利用可能）
- Docker / Docker Compose（本番運用、および開発用 hsd regtest の起動に利用）
- 稼働中の hsd 8.x ノードおよび hs-wallet（本プロジェクトの管轄外・別途用意）

## セットアップ（本番運用 / Docker Compose）

1. リポジトリを取得します。

   ```bash
   git clone https://github.com/mika-f/alice-hns-wallet.git
   cd alice-hns-wallet
   ```

2. `docker/.env.example` を `docker/.env` にコピーし、値を編集します。

   ```bash
   cp docker/.env.example docker/.env
   ```

   `SESSION_SECRET` / `ENCRYPTION_KEY` はランダムな 32 文字以上の値を設定してください（例: `openssl rand -hex 32`）。

3. イメージをビルドして起動します。

   ```bash
   docker compose -f docker/compose.yaml up -d --build
   ```

4. アプリはコンテナ内の `3000` 番ポートで待ち受けます（`docker/compose.yaml` では `3000:3000` を公開）。インターネットには直接公開せず、VPN や Reverse Proxy（Traefik など）でアクセス制御と HTTPS 終端を行ってください。

   `TRUST_PROXY=true` が既定で設定されており、CSRF 検証などは `APP_URL` に設定した公開 URL を基準に行われます。リバースプロキシ配下で実際にブラウザーからアクセスする URL（`https://` の実 URL）と `APP_URL` を必ず一致させてください。

5. 初回アクセス時にセットアップウィザードが表示されるので、管理者アカウントの作成と TOTP の有効化を行います。

## セットアップ（開発環境）

1. 依存関係をインストールします。

   ```bash
   pnpm install
   ```

2. 開発・検証用の regtest hsd を起動します。

   ```bash
   docker compose -f docker/compose.dev.yaml --profile hsd up -d --wait
   ```

3. `apps/server/.env.example` を `apps/server/.env` にコピーし、regtest hsd の接続情報を設定します（`HSD_NODE_URL=http://127.0.0.1:14037`、`HSD_WALLET_URL=http://127.0.0.1:14039`、API Key は `devkey` など）。

4. サーバーとフロントエンドをそれぞれ起動します（別ターミナルで並行実行）。

   ```bash
   pnpm dev:server
   pnpm dev:web
   ```

5. ブラウザーで `http://localhost:5173` を開きます（Vite dev server。API リクエストは `apps/server` へプロキシされます）。

## 環境変数

| 変数                                    | 説明                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `APP_URL`                               | アプリの公開 URL（CSRF 検証・リンク生成に使用）                               |
| `HOST` / `PORT`                         | サーバーの Listen アドレス / ポート                                           |
| `TRUST_PROXY`                           | リバースプロキシ配下で稼働する場合 `true`                                     |
| `DATABASE_URL`                          | SQLite ファイルのパス                                                         |
| `HSD_NODE_URL` / `HSD_NODE_API_KEY`     | hsd Node HTTP API の接続先・API Key                                           |
| `HSD_WALLET_URL` / `HSD_WALLET_API_KEY` | hs-wallet HTTP API の接続先・API Key                                          |
| `HSD_WALLET_ID`                         | 管理対象の Wallet ID                                                          |
| `HSD_NETWORK`                           | `main` / `testnet` / `regtest` / `simnet`                                     |
| `SESSION_SECRET`                        | セッション署名用シークレット（32 文字以上）                                   |
| `ENCRYPTION_KEY`                        | DB に保存する機微情報（接続設定・外部通知 URL 等）の暗号化キー（32 文字以上） |

hsd 接続設定はセットアップ後に UI（`/settings/connection`）からも変更でき、環境変数はその初期値として扱われます。

## 開発コマンド

| コマンド                                                      | 内容                                      |
| ------------------------------------------------------------- | ----------------------------------------- |
| `pnpm lint`                                                   | ESLint                                    |
| `pnpm format` / `pnpm format:write`                           | Prettier チェック / 自動整形              |
| `pnpm typecheck`                                              | 全パッケージの型チェック                  |
| `pnpm test`                                                   | 単体テスト（Vitest）                      |
| `pnpm --filter @alice-hns-wallet/hsd-client test:integration` | hsd-client の結合テスト（要 regtest hsd） |
| `pnpm --filter @alice-hns-wallet/server test:integration`     | server の結合テスト（要 regtest hsd）     |
| `pnpm build`                                                  | 各パッケージのビルド                      |

結合テストは regtest hsd（`docker compose -f docker/compose.dev.yaml --profile hsd up -d --wait`）が起動している必要があります。CI（[.github/workflows/ci.yaml](.github/workflows/ci.yaml)）では lint / format / typecheck / 単体テスト / 結合テスト / Docker イメージビルドを実行しています。

## メンテナンス

- **DB マイグレーション**: `apps/server/src/db/migrations` にマイグレーション SQL を管理しており、サーバー起動時（`apps/server/src/index.ts`）に自動適用されます。スキーマを変更した場合は `pnpm --filter @alice-hns-wallet/server db:generate` で新しいマイグレーションを生成してください。
- **データの永続化**: 本番運用では SQLite ファイルを `docker/data`（コンテナ内 `/app/data`）にボリュームマウントしています。バックアップはこのディレクトリを対象に行ってください（Seed / Mnemonic はウォレット側が保持し、本アプリの DB には保存されません）。
- **hsd 側の運用**: hsd の起動・停止・更新・チェーンデータのバックアップは運営者の責任範囲であり、本アプリは関与しません。
- **依存関係の更新**: `pnpm-lock.yaml` を伴う更新後は `pnpm install` → `pnpm typecheck` → `pnpm test` を実行して確認してください。

## セキュリティ設計

- hsd API Key / Wallet API Key / サーバー環境変数 / Wallet password / Private key / xpriv はブラウザーへ返却しません。
- 任意の RPC を中継する汎用プロキシは実装せず、操作ごとに専用の API エンドポイントを定義しています。
- ログには Mnemonic・Private key・xpriv・Wallet password・API Key・Authorization ヘッダー・TOTP シークレット・リカバリーコードを出力しません。
- Login・TOTP 検証・Wallet unlock・送金・DNS 更新・Renewal・Transfer・Finalize・Revoke には特に厳しいレート制限を設定しています。

詳細は [docs/01-SPECIFICATION.md §21](docs/01-SPECIFICATION.md) を参照してください。

## 非対応機能

初期版では以下を対象外としています（詳細は [docs/01-SPECIFICATION.md §2.2](docs/01-SPECIFICATION.md)）。

- 予約済み Name（Reserved Name）のクレーム（Proof-of-Burn / DNSSEC）
- 他ウォレット・他者を含むオークション市況の閲覧（自ウォレットの Open/Bid/Reveal/Redeem のみ）
- 複数ウォレット・複数利用者
- Ledger / Trezor / マルチシグ
- Name 売買・HNS 購入・Fiat 換算
- hsd の起動・停止・自動更新・データバックアップ管理
- デスクトップアプリ、Safari の正式対応
- Web Push 通知（`push_subscriptions` テーブルはスキーマ上存在しますが未使用です）
