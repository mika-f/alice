# Handshake Web Wallet 実装計画書

本書は [01-SPECIFICATION.md](./01-SPECIFICATION.md) を実装に落とし込むための計画書である。
仕様書の Phase 1〜5(§25)と受け入れ条件(§26)をマイルストーンとして扱い、各マイルストーンの成果物・実装順序・技術的な決定事項を定義する。

---

## 1. 技術スタック(確定)

仕様書 §23.2 の候補から以下を採用する。

| 領域             | 採用                                              | 理由                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language         | TypeScript (strict)                               | 全レイヤー共通。仕様指定                                                                                                                                                                      |
| Backend          | **Hono** (Node.js runtime)                        | 軽量・型安全な RPC ライクなルーティング。Fastify より依存が少なく、単一コンテナ配布に向く                                                                                                     |
| Frontend         | **React 18 + Vite (SPA)**                         | 後述の CSP 要件(§21.4 inline script 禁止)を Next.js で満たすには nonce 運用が必要になり複雑化する。静的ビルドの SPA なら外部スクリプトファイルのみで構成でき、strict CSP をそのまま適用できる |
| Routing (FE)     | TanStack Router                                   | 型安全なルーティング                                                                                                                                                                          |
| Data fetching    | TanStack Query                                    | キャッシュ・自動再取得・接続断検知(§22.2)と相性が良い                                                                                                                                         |
| Validation       | Zod                                               | API 入出力・hsd レスポンス検証・環境変数検証に共通利用                                                                                                                                        |
| Database         | SQLite (better-sqlite3)                           | 単一ユーザー・単一プロセス前提。運用が最も軽い                                                                                                                                                |
| ORM / Migration  | Drizzle ORM + drizzle-kit                         | 仕様指定。起動時 migration(§24.4)                                                                                                                                                             |
| Password hashing | Argon2id (`@node-rs/argon2`)                      | 仕様指定                                                                                                                                                                                      |
| TOTP             | `otpauth`                                         | RFC 6238。QR は `qrcode` でサーバー側生成し data URI で返す                                                                                                                                   |
| Session          | 独自実装(DB バックドセッション + HttpOnly Cookie) | §21.2 の要件(ローテーション・全無効化)を満たすため外部ライブラリに依存しない                                                                                                                  |
| Testing          | Vitest                                            | 仕様指定                                                                                                                                                                                      |
| E2E              | Playwright                                        | 仕様指定。regtest の hsd を相手に実行                                                                                                                                                         |
| Deployment       | Docker Compose(単一アプリコンテナ + volume)       | §4.2 の簡易構成を採用。DB は SQLite のため database コンテナは不要                                                                                                                            |
| CSRF             | Double-submit + `Origin`/`Sec-Fetch-Site` 検証    | §21.3                                                                                                                                                                                         |

### 補足決定事項

- **フロントエンドとバックエンドは単一コンテナ**にまとめる(§4.2 で許容)。Hono が SPA の静的ファイルを配信する。compose 構成は `handshake-wallet` + volume のみ。
- **hsd クライアントは自作**する(`packages/hsd-client`)。`hs-client` は hsd 本体と密結合で型が弱いため、hsd 8.x の REST API を Zod スキーマで検証する薄いクライアントを実装する(§23.3 Adapter 方針と一致)。
- **接続設定は環境変数を初期値とし、DB 保存値で上書き可能**とする(§8.1 で UI からの変更が要求されるため)。API Key は `ENCRYPTION_KEY` による AES-256-GCM で暗号化して DB 保存する(§4.3)。

---

## 2. リポジトリ構成

仕様書 §23.1 に準拠する。

```text
alice-hns-wallet/
├── apps/
│   ├── web/                  # React SPA (Vite)
│   │   ├── src/
│   │   │   ├── routes/       # 画面 (dashboard, send, receive, names, settings, ...)
│   │   │   ├── components/
│   │   │   ├── api/          # server の API を叩く型付きクライアント
│   │   │   └── lib/
│   │   └── vite.config.ts
│   └── server/               # Hono アプリ
│       ├── src/
│       │   ├── routes/       # /api/* ルート定義(操作ごとに専用エンドポイント §21.5)
│       │   ├── services/     # WalletService, NameService, AuthService, NotificationService
│       │   ├── db/           # Drizzle schema, migrations
│       │   ├── middleware/   # auth, csrf, rate-limit, https-enforce, csp
│       │   └── index.ts
│       └── drizzle.config.ts
├── packages/
│   ├── domain/               # 内部モデル (NodeStatus, WalletBalance, OwnedName, ...) と純粋ロジック
│   ├── hsd-client/           # HandshakeNodeClient / HandshakeWalletClient IF + HsdV8Adapter
│   ├── schemas/              # API リクエスト/レスポンスの Zod スキーマ (web/server 共有)
│   └── config/               # tsconfig / eslint / prettier 共有設定
├── docker/
│   ├── Dockerfile            # multi-stage: web build → server build → runtime
│   ├── compose.yaml          # handshake-wallet + volume
│   └── compose.dev.yaml      # 開発用: hsd (regtest) を含む profile (§4.2)
├── docs/
└── package.json              # pnpm workspace
```

パッケージマネージャーは pnpm(workspace)を使用する。

---

## 3. アーキテクチャ

### 3.1 レイヤー構成(§23.3)

```text
apps/web (React SPA)
    │  fetch (cookie session, CSRF token)
    ▼
apps/server: routes (/api/*)        ← Zod で入力検証、認可、再認証チェック
    ▼
apps/server: services               ← ユースケース単位。書き込み前の状態再取得(§22.3)はここで強制
    ▼
packages/hsd-client: interface      ← HandshakeNodeClient / HandshakeWalletClient
    ▼
packages/hsd-client: HsdV8Adapter   ← hsd 8.x REST/RPC 呼び出し + Zod によるレスポンス検証
    ▼
hsd / hs-wallet (LAN / Docker network)
```

- ブラウザーは hsd に一切直接アクセスしない。API Key はサーバープロセスのみが保持する(§21.1)。
- 汎用 RPC プロキシは実装しない。操作ごとに専用ルートを定義する(§21.5)。
- `HsdV8Adapter` は hsd のレスポンスを必ず Zod で parse し、内部モデルに変換してから返す。未知フィールドは無視、必須フィールド欠落はエラーとして扱う。

### 3.2 hsd との通信

hsd 8.x の利用 API(いずれも REST、一部 RPC):

| 用途                         | エンドポイント                                          |
| ---------------------------- | ------------------------------------------------------- |
| Node 情報                    | `GET /` (version, network, chain height, peers)         |
| Wallet 情報                  | `GET /wallet/:id`, `GET /wallet/:id/balance`            |
| アドレス                     | `POST /wallet/:id/address`                              |
| 送金                         | `POST /wallet/:id/send`                                 |
| 履歴                         | `GET /wallet/:id/tx/history` (ページネーション)         |
| Name 一覧                    | `GET /wallet/:id/name`                                  |
| Name 詳細                    | `GET /wallet/:id/name/:name`, node 側 `rpc getnameinfo` |
| Resource                     | `rpc getnameresource` / `POST /wallet/:id/update`       |
| Renewal                      | `POST /wallet/:id/renewal`                              |
| Transfer / Finalize / Revoke | `POST /wallet/:id/transfer` / `/finalize` / `/revoke`   |
| Unlock / Lock                | `POST /wallet/:id/unlock`, `POST /wallet/:id/lock`      |
| Mnemonic 復元                | `PUT /wallet/:id` (mnemonic 指定) + `POST /rescan`      |

同時リクエスト数はクライアント内のセマフォで制限する(§22.1、初期値 4)。読み取りのみ限定的リトライ(1回、書き込みは一切リトライしない §22.2)。

### 3.3 状態監視

- サーバー側で 30 秒間隔のポーリングループを持ち、Node/Wallet の接続状態・高さ・同期状況をメモリキャッシュする(§8.5)。
- SPA へは `GET /api/status` のポーリング(TanStack Query, 15s)で配信する。初期版では WebSocket/SSE は使わない(CSP・Proxy 互換性を優先。Phase 5 で SSE 化を検討)。
- 書き込み操作(send / update / renew / transfer / finalize / revoke)の直前には service 層でキャッシュを使わず最新状態を再取得し、同期済み・unlock 済み・Network 一致を検証してから実行する(§8.5, §12.4)。

---

## 4. データモデル(SQLite / Drizzle)

§4.3 の永続化対象に対応する。

```text
settings          key-value。アプリ設定・通知しきい値・ログ設定・最終バックアップ確認日時
admin             1行のみ。username, password_hash(argon2id), totp_secret(暗号化), totp_enabled
recovery_codes    リカバリーコード(ハッシュ保存, 使用済みフラグ)
sessions          id(ランダム128bit+ローテーション), expires_at, last_seen, ip, user_agent, reauth_at
login_attempts    失敗回数制限・一時ロック用 (ip, count, locked_until)
connections       hsd 接続設定。node_url, wallet_url, api_key_enc(AES-256-GCM), wallet_id,
                  network, timeout, tls_verify, display_name
name_meta         name ごとのローカルラベル・メモ (§4.3, §14)
address_labels    受信アドレスのラベル (§11.1)
tx_meta           送金時のローカルラベル・メモ (§12.1)
notifications     アプリ内通知 (type, name, payload, created_at, read_at) (§20.1)
name_cache        Name 一覧の最終取得スナップショット(表示高速化用キャッシュ。正は常に hsd §22.3)
```

**保存しないもの**(§4.3, §21.6): mnemonic / private key / xpriv / wallet passphrase / 平文 API Key / 署名前 TX。mnemonic と wallet passphrase はリクエスト処理中のメモリのみに存在し、ログにも残さない(後述のログサニタイズ)。

---

## 5. アプリケーション API 設計

すべて `/api` 配下。書き込みは CSRF トークン必須。`🔐` は再認証(§7.4)必須。

```text
# 認証
POST /api/auth/setup            初回管理者設定(未設定時のみ)
POST /api/auth/login            (rate limit: 厳)
POST /api/auth/login/totp
POST /api/auth/logout
POST /api/auth/logout-all
POST /api/auth/reauth           パスワード or TOTP で再認証(sessions.reauth_at 更新)
GET  /api/auth/session
POST /api/auth/totp/enroll      🔐 QR(data URI) + シークレット
POST /api/auth/totp/verify      🔐
POST /api/auth/totp/disable     🔐
POST /api/auth/recovery/regen   🔐

# 接続管理
GET  /api/node/status           監視キャッシュ返却
GET  /api/connection
PUT  /api/connection            🔐 保存前に接続テスト(§8.3)を強制
POST /api/connection/test       接続・認証・version・network 一致・wallet 存在確認

# ウォレット
GET  /api/wallet/balance
GET  /api/wallet/transactions?cursor=&limit=
GET  /api/wallet/transactions/:txid
POST /api/wallet/receive-address
GET  /api/wallet/addresses
POST /api/wallet/send           🔐 (idempotency key で二重送信防止 §12.4)
POST /api/wallet/send/estimate  手数料見積り(dry-run)
POST /api/wallet/unlock         (rate limit: 厳)
POST /api/wallet/lock
POST /api/wallet/import/mnemonic 🔐

# Name
GET  /api/names                 ?filter=&sort=&q=
GET  /api/names/:name
GET  /api/names/:name/resource  現在値 + デコード + raw
POST /api/names/:name/update    🔐 UPDATE tx (Resource 差し替え)
POST /api/names/:name/update/preview  バリデーション + raw preview + 手数料見積り
POST /api/names/:name/renew     🔐
POST /api/names/renew-batch     🔐 複数/全件 Renewal。Name ごとの結果を返す (§17.3)
POST /api/names/:name/transfer  🔐
POST /api/names/:name/finalize  🔐
POST /api/names/:name/revoke    🔐 (パスワード + TOTP 両方 §19.2)
PUT  /api/names/:name/meta      ラベル・メモ

# 通知
GET  /api/notifications
POST /api/notifications/:id/read
PUT  /api/settings/notifications  しきい値設定 (§17.4)

# ヘルスチェック(認証不要・情報最小 §22.4)
GET  /health
GET  /ready
```

### 書き込み操作の共通フロー

1. セッション検証 → 再認証有効期限(既定 10 分)検証
2. CSRF 検証
3. Zod 入力検証
4. Rate limit(操作別 §21.7)
5. **最新状態の再取得**(Node/Wallet 同期・unlock・Network 一致・Name 状態)
6. hsd へ実行(自動リトライなし §12.4)
7. Transaction ID を履歴と照合して応答(§22.3)
8. 監査ログ(Phase 5)・通知登録

---

## 6. セキュリティ実装方針

| 要件               | 実装                                                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cookie (§21.2)     | `HttpOnly; Secure; SameSite=Strict; Path=/`。ログイン成功・再認証・権限昇格時にセッション ID ローテーション。logout-all は sessions 全削除                                                                     |
| HTTPS 強制 (§5.2)  | `TRUST_PROXY` 時は `X-Forwarded-Proto` を検証。localhost 以外からの HTTP はログイン・書き込み API を 403                                                                                                       |
| CSRF (§21.3)       | セッション紐付けトークンをレスポンスヘッダで配布、書き込み時に `X-CSRF-Token` 必須。加えて `Origin` / `Sec-Fetch-Site` 検証                                                                                    |
| CSP (§21.4)        | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'` + `X-Frame-Options: DENY`。Vite ビルドを inline script なしで構成 |
| Rate limit (§21.7) | メモリベースの sliding window。login / totp / unlock / 送信系に個別しきい値                                                                                                                                    |
| ログ (§21.6)       | pino + カスタム redact。`mnemonic`, `passphrase`, `apiKey`, `authorization`, `totp`, `recoveryCode` 等のキーを再帰的にマスク。アドレス・Name・TXID のログ出力は設定でオフ可能                                  |
| Secret (§24.2)     | 環境変数は `*_FILE` サフィックスをサポートし Docker Secrets / systemd credentials から読み込み可能にする                                                                                                       |
| 高額送信 (§12.4)   | しきい値(設定可能)超過時に金額の再入力確認を UI で要求                                                                                                                                                         |

---

## 7. 実装マイルストーン

仕様書 §25 の Phase をそのままマイルストーンとする。各 Phase の完了条件は対応する受け入れ条件(§26)のパスとする。

### Phase 0: 足場(Phase 1 の前提)

- [ ] pnpm workspace / monorepo 初期化(§2 の構成)
- [ ] `packages/config`(tsconfig, eslint, prettier)
- [ ] `packages/domain` の内部モデル定義(NodeStatus, WalletBalance, OwnedName, NameDetails, TransactionRecord, BroadcastResult, Network など)
- [ ] `packages/schemas` の API スキーマ骨格
- [ ] `packages/hsd-client`: インターフェース定義 + `HsdV8Adapter` の読み取り系(getStatus / getVersion / getNetwork / getBalance)
- [ ] Vitest セットアップ、regtest hsd を使う統合テスト基盤(`docker/compose.dev.yaml`)
- [ ] CI(GitHub Actions: lint / typecheck / test / docker build)

### Phase 1: 基盤

- [ ] Drizzle schema + 起動時 migration
- [ ] 初回セットアップフロー(管理者パスワード設定 §7.1)
- [ ] ログイン / ログアウト / 全セッション無効化 / 失敗ロック(§7.2)
- [ ] TOTP 登録・検証・リカバリーコード(§7.3)
- [ ] 再認証ミドルウェア(§7.4)
- [ ] セキュリティミドルウェア一式(Cookie, CSRF, CSP, HTTPS 強制, rate limit)
- [ ] 接続設定 CRUD + 接続テスト(§8.1–8.4、API Key 暗号化保存)
- [ ] hsd バージョンチェック(8.x 以外は警告、書き込み禁止オプション §8.4)
- [ ] 状態監視ループ + `GET /api/status`(§8.5)
- [ ] `/health` `/ready`(§22.4)
- [ ] SPA シェル: レイアウト、レスポンシブ(360px〜)、ログイン画面、設定画面、接続状態表示
- [ ] Dockerfile + compose.yaml(§24)

**完了条件**: 受け入れ条件 1, 2, 3(一部), 4, 16, 18, 19

### Phase 2: HNS ウォレット

- [ ] 残高表示(confirmed / unconfirmed / locked / spendable §10.1)
- [ ] ダッシュボード(表示項目・クイック操作・警告 §10)
- [ ] 受信: アドレス発行、QR、コピー、Web Share、アドレス一覧・ラベル(§11)
- [ ] 送信: 入力 → 手数料見積り → 確認画面 → 再認証 → 実行(§12)。idempotency key による二重送信防止、通信エラー時の履歴確認導線
- [ ] トランザクション履歴: ページネーション、種別/Covenant の人間向け表示、ステータス(§13)
- [ ] Wallet lock / unlock、unlock 有効時間、自動 lock(§9.5)
- [ ] 既存 Wallet ID 接続(Phase 1 の接続設定に含まれるが、ウォレット存在・利用可否検証を完成させる §9.2)
- [ ] Mnemonic 復元: 単語検証 → 復元 → rescan 進捗表示(§9.4)

**完了条件**: 受け入れ条件 5, 6, 7, 8, 9, 17, 20

### Phase 3: Name 閲覧

- [x] `getNames` / `getName` の Adapter 実装(wallet 一覧 + node の nameinfo を突合)
- [x] Name 一覧: 表示項目・フィルター・ソート・検索(§14)。100 件を 1 リクエストで取得し `name_cache` に保存、クライアント側でフィルター/ソート(1,000 件までこの方式で許容 §14.1)
- [x] Renewal/Expiration の残りブロック → 推定期間換算(domain 層の純関数)
- [x] Name 詳細: 基本情報・Transfer 状態・Wallet 所有確認(§15.1)
- [x] DNS Resource のデコード表示(NS/GLUE4/GLUE6/DS/TXT/SYNTH4/SYNTH6 + 未知型の Raw 表示 §16.1)
- [x] オークション履歴(OPEN/BID/REVEAL 等)の閲覧表示(§13.3)
- [x] ローカルラベル・メモの編集(§15.3)

**完了条件**: 受け入れ条件 10, 11

### Phase 4: Name 管理

- [ ] Resource エディター: レコード追加/編集/削除/並び替え、バリデーション(§16.3)、現在値との差分表示、raw preview、サイズ表示
- [ ] 安全対策: 全レコード削除警告・最後の NS 削除警告・Name 再入力オプション(§16.4)
- [ ] UPDATE 実行フロー(preview → 再認証 → 実行 → TXID 表示)
- [ ] Renewal: 対象分類(§17.1)、個別 Renewal
- [ ] 一括 Renewal: 逐次実行 + Name ごとの成功/失敗/スキップ結果、進捗表示(§17.2–17.3)
- [ ] Transfer: アドレス検証 → Lockup 説明 → Name 再入力 → 再認証 → 実行(§18.1)
- [ ] Transfer 状態追跡と Finalize(可能時期・残りブロック表示 §18.2–18.3)
- [ ] Revoke: 危険操作領域に隔離、影響説明 → Name 手入力 → パスワード + TOTP → 最終確認(§19)
- [ ] アプリ内通知: 監視ループから生成(Renewal 接近 / Finalize 可能 / Transfer 状態変化 / TX 確定・失敗 / 接続断 §20.1)、しきい値設定(§17.4)

**完了条件**: 受け入れ条件 12, 13, 14, 15

### Phase 5: 運用強化(初期リリース後)

- [ ] 外部通知(ntfy / Discord Webhook から着手、秘密情報のマスク §20.2)
- [ ] Web Push
- [ ] 監査ログ(書き込み操作の記録)
- [ ] バックアップ確認リマインダー(§10.3)
- [ ] 障害診断画面(接続・同期・バージョンの一括診断)
- [ ] 状態配信の SSE 化検討

---

## 8. テスト戦略

| レイヤー      | 方法                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| domain        | Vitest 単体テスト(残り期間計算、Resource バリデーション、金額計算は網羅的に)                                                               |
| hsd-client    | regtest の hsd コンテナに対する統合テスト。CI でも実行(compose.dev.yaml)                                                                   |
| server routes | Vitest + hsd-client のモック。認証・CSRF・再認証・rate limit・二重送信防止は必須ケース                                                     |
| E2E           | Playwright。regtest 環境でセットアップ → ログイン → 送金 → Name 表示 → Renewal のハッピーパス。Chrome / Firefox / モバイルビューポート(§6) |
| セキュリティ  | CSP ヘッダ・Cookie 属性・秘密情報がレスポンス/ログに出ないことの自動アサーション                                                           |

regtest では `rpc generatetoaddress` でブロック生成を制御し、Name のライフサイクル(auction 完了済み Name の作成)をテストフィクスチャとしてスクリプト化する。

---

## 9. リスクと対応

| リスク                                  | 対応                                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| hsd 8.x API の想定と実際の差異          | Phase 0 で regtest 実機に対する統合テストを最初に整備し、Adapter の仕様を実測で固める                                                                                                |
| Resource エンコード/デコードの正確性    | hsd の `hsd/lib/dns/resource` 相当の仕様を domain 層で再実装せず、可能な限り hsd の RPC(`getnameresource`)にデコードを委譲。エンコードのみ自前実装し、regtest でラウンドトリップ検証 |
| 一括 Renewal 中の wallet lock 失効      | バッチ開始前に unlock 残時間を確認し、不足時は再 unlock を要求。バッチは逐次実行で中断可能にする                                                                                     |
| 送金の二重実行                          | idempotency key + ブロードキャスト前後の履歴照合。通信エラー時は UI が履歴確認を強制                                                                                                 |
| Next.js を使わないことによる SSR 非対応 | 本アプリは認証必須の SPA であり SEO/初期表示要件がないため問題なし                                                                                                                   |

---

## 10. 想定スケジュール(目安)

| マイルストーン | 規模感                                                 |
| -------------- | ------------------------------------------------------ |
| Phase 0        | 基盤整備。regtest 統合テストまで含めて最初に完了させる |
| Phase 1        | 認証 + 接続管理。セキュリティ実装が大半                |
| Phase 2        | 送受信・履歴。送金フローの安全対策に比重               |
| Phase 3        | Name 閲覧。Resource デコードの検証に比重               |
| Phase 4        | Name 管理。最も操作種別が多く、E2E 拡充と並行          |
| Phase 5        | リリース後の継続改善                                   |

Phase 0〜4 完了時点で §26 の受け入れ条件 20 項目をすべて満たし、初期リリースとする。
