# Handshake Web Wallet 要件定義書

## 1. 概要

### 1.1 目的

自宅サーバー上で稼働する Handshake フルノード `hsd` およびウォレットサービスに接続し、HNS と既に保有している Handshake Name を管理できる個人用 Web ウォレットを開発する。

既存の Bob Wallet に依存せず、最新の hsd 8.x 系を利用できることを目的とする。

### 1.2 利用形態

本システムは不特定多数向けの公開サービスではなく、運営者本人が利用するプライベートウォレットとする。

利用者は原則として1名とし、管理対象ウォレットも単一ウォレットとする。

### 1.3 基本方針

* hsd の起動、停止、更新、バックアップは運営者の責任とする
* Web ウォレットは hsd プロセスを直接管理しない
* Web ウォレットは既存の hsd / hs-wallet API に接続する
* 秘密鍵管理や署名処理は可能な限り hs-wallet に委譲する
* ブラウザーへ hsd API Key や Wallet API Key を露出させない
* インターネットから直接 hsd の RPC ポートへ接続させない
* 外出先のスマートフォンから安全に利用できる構成とする
* 既に保有している Name の管理に加え、新規 Name オークション(Open/Bid/Reveal/Redeem/Register)にも対応する(§27)

---

## 2. 対象範囲

### 2.1 初期版で対応する機能

* hsd ノードとの接続
* hs-wallet との接続
* 単一ウォレットの管理
* 既存ウォレットのインポートまたは復元
* HNS 残高表示
* HNS 送受信
* トランザクション履歴
* 保有 Name 一覧
* Name 詳細表示
* DNS Resource の表示と更新
* Name Renewal
* Name Transfer
* Name Finalize
* Name Revoke
* Name オークション開始(Open)
* Bid
* Reveal
* Redeem
* Register
* Name 利用可否(Availability)確認
* モバイルブラウザー対応
* 外部ネットワークからの安全なアクセス
* Docker Compose による配布

### 2.2 初期版で対応しない機能

* 予約済み Name(Reserved Name)のクレーム(Proof-of-Burn / DNSSEC)
* 他ウォレット・他者を含むオークション市況の閲覧(自ウォレットの Open/Bid/Reveal/Redeem のみを対象とする)
* 複数ウォレット
* 複数利用者
* Ledger
* Trezor
* マルチシグ
* Name 売買
* HNS 購入
* Fiat 換算
* hsd の起動・停止
* hsd の自動更新
* hsd データのバックアップ管理
* デスクトップアプリ
* Safari の正式対応

---

## 3. システム構成

### 3.1 全体構成

```text
外出先のブラウザー
Chrome / Firefox
        │
        │ HTTPS
        ▼
認証・アクセス制御層
VPN / Reverse Proxy / Access Proxy
        │
        ▼
Handshake Web Wallet
Frontend + Backend
        │
        ├── hsd Node API
        │
        └── hs-wallet API
                │
                ▼
        自宅サーバー上の hsd
```

### 3.2 コンポーネント

#### Handshake Web Wallet

本プロジェクトで開発するアプリケーション。

以下を担当する。

* Web UI
* 利用者認証
* セッション管理
* hsd API の抽象化
* hs-wallet API の抽象化
* API レスポンスの検証
* Name 状態の表示
* DNS Resource 編集
* トランザクション操作
* 通知および期限管理
* ローカル設定保存

#### hsd

運営者が別途構築および管理する。

以下は Web ウォレットの管轄外とする。

* hsd のインストール
* hsd の起動
* hsd の停止
* hsd のアップデート
* Blockchain データの保存
* Peer 接続
* Chain 同期
* hsd 自体の監視
* hsd データディレクトリのバックアップ

#### hs-wallet

ウォレット、秘密鍵、アドレス、トランザクションおよび Name 情報を管理する。

Web ウォレットは hs-wallet を信頼できる署名主体として扱う。

---

## 4. 配布・稼働環境

### 4.1 ホスト環境

初期版の正式対応環境は Linux とする。

想定環境：

* Ubuntu Server
* Debian
* その他 Docker Engine が利用可能な Linux

### 4.2 配布方式

Docker Compose を正式な配布方式とする。

```text
docker-compose.yml
├── wallet-web
├── wallet-server
└── wallet-database
```

フロントエンドとバックエンドを単一コンテナにまとめられる場合は、以下でもよい。

```text
docker-compose.yml
├── handshake-wallet
└── wallet-database
```

hsd は既存環境を利用するため、標準の Docker Compose 構成には含めない。

ただし、開発および検証用として hsd を含む別の Compose Profile を提供してもよい。

### 4.3 永続化対象

Web ウォレット側で永続化するもの：

* アプリ設定
* hsd 接続設定
* Wallet 接続設定
* 暗号化済み認証情報
* Name のローカルラベル
* Name のメモ
* 通知設定
* 既読通知
* セッション情報
* 最終取得した状態のキャッシュ
* 最後に確認したバックアップ日時

永続化しないもの：

* Seed phrase
* Private key
* xpriv
* Wallet passphrase
* 未暗号化の API Key
* 署名前トランザクション
* hsd Wallet DB のコピー

---

## 5. ネットワーク要件

### 5.1 外部アクセス

スマートフォンや外出先のPCからアクセスできること。

接続方式として、以下のいずれかを利用する。

推奨順：

1. Tailscale または WireGuard
2. Cloudflare Access 等の Identity-Aware Proxy
3. Reverse Proxy と強固なアプリ認証

ルーターのポート開放のみで Web ウォレットを直接インターネット公開する構成は推奨しない。

### 5.2 HTTPS

localhost 以外からアクセスする場合は HTTPS を必須とする。

HTTP 接続時は、ログインおよびウォレット操作を許可しない。

### 5.3 Listen Address

初期設定では、コンテナ内部またはプライベートネットワークにのみ bind する。

例：

```yaml
HOST: 0.0.0.0
PORT: 3000
TRUST_PROXY: true
```

外部公開範囲は Docker、Firewall、VPN、Reverse Proxy 側で制御する。

### 5.4 hsd 接続

hsd および hs-wallet の API は、Docker の内部ネットワークまたは LAN 内部からのみ接続可能とする。

ブラウザーから hsd API への直接接続は禁止する。

---

## 6. 対応クライアント

### 6.1 デスクトップ

正式対応：

* Google Chrome 最新版
* Mozilla Firefox 最新版

### 6.2 モバイル

対象：

* Android Chrome
* Android Firefox
* iOS Chrome
* iOS Firefox

iOS 上の Chrome および Firefox は WebKit ベースになるが、初期版では利用可能な範囲で対応する。

Safari 単体での正式な動作保証は初期版では行わない。

### 6.3 レスポンシブ対応

以下の画面幅を想定する。

* スマートフォン：360px以上
* タブレット：768px以上
* デスクトップ：1024px以上

すべての主要操作をスマートフォンから実行可能とする。

---

## 7. 認証要件

### 7.1 利用者モデル

利用者は単一ユーザーとする。

ユーザー登録機能は設けない。

初回起動時に管理者パスワードを設定する。

### 7.2 ログイン

* ID またはユーザー名
* パスワード
* セッション Cookie
* ログアウト
* 全セッション無効化
* ログイン失敗回数制限
* 一定回数失敗後の一時ロック

### 7.3 二要素認証

外部ネットワークから利用するため、TOTP による二要素認証を初期版に含めることを推奨する。

対応内容：

* TOTP 登録
* QR コード表示
* 確認コード検証
* リカバリーコード発行
* 二要素認証の無効化
* リカバリーコード再発行

VPN 内でのみ利用する場合は任意機能としてもよいが、アプリ側に実装可能な設計とする。

### 7.4 再認証

以下の操作時は再認証を要求する。

* HNS 送信
* DNS Resource 更新
* Renewal
* Transfer
* Finalize
* Revoke
* Wallet インポート
* 接続先変更
* API Key 変更
* バックアップ出力

再認証は管理者パスワードまたは TOTP で行う。

---

## 8. hsd 接続管理

### 8.1 接続設定

以下を設定可能とする。

* Node API URL
* Wallet API URL
* Node API Key
* Wallet API Key
* Wallet ID
* Network
* Timeout
* TLS 証明書検証有無
* 接続先表示名

### 8.2 対応 Network

* main
* testnet
* regtest
* simnet

初期設定は main とする。

### 8.3 接続確認

設定保存前に以下を確認する。

* Node API に接続できる
* Wallet API に接続できる
* 認証情報が正しい
* hsd バージョンが取得できる
* Node と Wallet の Network が一致する
* 指定した Wallet ID が存在する
* Wallet が利用可能である

### 8.4 対応バージョン

初期版では hsd 8.x 系を正式対応とする。

```text
>= 8.0.0
< 9.0.0
```

未検証バージョンでは警告を表示し、重大な互換性問題が予想される場合は書き込み操作を禁止できるようにする。

### 8.5 状態監視

定期的に以下を取得する。

* Node 接続状態
* Wallet 接続状態
* hsd バージョン
* Network
* Chain height
* Wallet height
* 同期進捗
* Peer 数
* Wallet lock 状態

書き込み操作前にはキャッシュを使用せず、最新状態を再取得する。

---

## 9. ウォレット要件

### 9.1 単一ウォレット

アプリ内で管理する Wallet ID は1つとする。

複数ウォレットの切り替えUIは提供しない。

Wallet ID の変更は管理画面からのみ可能とし、変更時には再認証を要求する。

### 9.2 既存ウォレット利用

既存の hsd Wallet が既に hs-wallet 上に存在する場合、その Wallet ID を指定して接続できること。

この方法を、最も安全な既存ウォレット移行方法として優先する。

### 9.3 ウォレットインポート

初期版では以下の方法を検討する。

優先順位：

1. 既存 Wallet ID への接続
2. Mnemonic による復元
3. hsd が正式に対応する Wallet backup からの復元
4. xpriv による復元

Wallet DB ファイルを Web UI にアップロードして直接配置する機能は、ファイル破損や hsd バージョン差の危険があるため、原則として提供しない。

必要な場合は、運営者が hs-wallet の CLI や正式な復元手順でインポートし、その後 Web ウォレットから Wallet ID を指定する。

### 9.4 Mnemonic インポート

* Mnemonic 入力
* 単語数検証
* 単語リスト検証
* Passphrase の任意入力
* Network 確認
* Wallet ID 指定
* Wallet password 設定
* 復元確認
* Rescan 開始

Mnemonic はブラウザー上で入力されるが、Web ウォレットの独自DBには保存しない。

サーバーログにも記録しない。

### 9.5 Wallet ロック

* Wallet lock 状態表示
* Wallet unlock
* Wallet lock
* Unlock 有効時間の設定
* 操作完了後の自動 lock
* アプリセッション終了時の lock

可能な限り、恒久的なアンロック状態を避ける。

---

## 10. ダッシュボード

### 10.1 表示項目

* Confirmed balance
* Unconfirmed balance
* Locked balance
* Spendable balance
* 保有 Name 数
* Renewal が近い Name 数
* Transfer 中の Name 数
* Finalize 可能な Name 数
* Node 同期状態
* Wallet 同期状態
* Wallet lock 状態
* 最新ブロック高
* Peer 数

### 10.2 クイック操作

* HNS を送る
* HNS を受け取る
* Name 一覧を開く
* Renewal 対象を確認
* 接続状態を確認

### 10.3 警告

* Node に接続できない
* Wallet に接続できない
* Node が未同期
* Wallet が未同期
* Node と Wallet の Network 不一致
* Wallet がロック中
* Renewal 期限接近
* Finalize 可能
* hsd バージョン非対応
* 最終バックアップから一定期間経過

---

## 11. HNS 受信

### 11.1 機能

* 新しい受信用アドレス取得
* QR コード表示
* アドレスコピー
* 過去の受信用アドレス一覧
* 使用済み状態表示
* アドレスラベル
* Network 表示

### 11.2 モバイル対応

* QR コードを画面幅に合わせる
* タップでコピー
* Web Share API による共有
* コピー完了表示
* 誤った Network のアドレスを明確に警告

---

## 12. HNS 送信

### 12.1 入力

* 送信先アドレス
* 送信額
* 手数料設定
* 任意ラベル
* 任意メモ

メモとラベルはローカルのみで保存し、ブロックチェーンには記録しない。

### 12.2 手数料

* 自動設定
* 手動 fee rate
* 推定手数料
* 最終送金額
* 残高差引後の見込み残高

### 12.3 確認画面

以下を必ず表示する。

* 送信先
* 金額
* 手数料
* 合計
* Network
* ウォレット名
* 送信後残高

### 12.4 安全対策

* アドレス形式検証
* Network 検証
* 残高不足検証
* Node 同期確認
* Wallet 同期確認
* Wallet unlock 確認
* 二重送信防止
* 連続クリック防止
* 高額送信時の追加確認
* ブロードキャスト処理の自動再試行禁止

通信エラーが発生した場合は、同じ送金を再実行する前にトランザクション履歴を確認する。

---

## 13. トランザクション履歴

### 13.1 表示

* Transaction ID
* 種別
* HNS 送信
* HNS 受信
* Name 操作
* 金額
* 手数料
* Timestamp
* Block height
* Confirmations
* Status
* Inputs
* Outputs
* Covenant

### 13.2 ステータス

* Pending
* Confirmed
* Replaced
* Conflicted
* Failed
* Unknown

### 13.3 Covenant 表示

以下を人間向けの表示に変換する。

* NONE
* OPEN
* BID
* REVEAL
* REDEEM
* REGISTER
* UPDATE
* RENEW
* TRANSFER
* FINALIZE
* REVOKE

既存履歴上の OPEN、BID、REVEAL 等の閲覧に加え、自ウォレットによるオークション操作(Open/Bid/Reveal/Redeem)も実行可能とする(§27)。

---

## 14. Name 一覧

### 14.1 規模

初期版では約100件の保有 Name を想定する。

将来的に1,000件程度まで対応可能な設計とする。

### 14.2 表示項目

* Name
* 状態
* Owner
* Renewal height
* Expiration height
* 残りブロック
* 推定残り期間
* Transfer 状態
* DNS Resource 概要
* ローカルラベル
* ローカルメモ
* 最終更新日時

### 14.3 フィルター

* すべて
* 所有中
* Renewal 推奨
* Transfer 中
* Finalize 可能
* Expired
* Revoked
* オークション関連

オークション関連 Name のうち、自ウォレットが Bid/Reveal 済みのものは §27 のアクション(Reveal/Redeem 等)にも遷移できる。

### 14.4 ソート

* Name
* 状態
* Renewal 期限
* Expiration
* 最終更新日時

### 14.5 検索

* Name 部分一致
* Name 完全一致
* ラベル
* メモ

---

## 15. Name 詳細

### 15.1 基本情報

* Name
* Name hash
* Current state
* Owner
* Owner address
* Block height
* Renewal height
* Expiration height
* 残りブロック
* 推定残り期間
* Transfer 状態
* Wallet 所有確認

### 15.2 DNS 情報

* 現在の Resource
* Resource のデコード表示
* Raw Resource
* 最終 UPDATE トランザクション
* DNS 設定変更履歴

### 15.3 操作

* DNS 設定編集
* Renewal
* Transfer
* Finalize
* Revoke
* ローカルラベル編集
* ローカルメモ編集

---

## 16. DNS Resource 管理

### 16.1 対応レコード

初期版では以下を対象とする。

* NS
* GLUE4
* GLUE6
* DS
* TXT
* SYNTH4
* SYNTH6

hsd が追加の Resource 型を返した場合、未対応として Raw 表示できること。

### 16.2 編集機能

* レコード追加
* レコード編集
* レコード削除
* 並び替え
* 現在値との比較
* Raw Resource プレビュー
* サイズ表示
* UPDATE トランザクション作成
* 手数料確認
* 実行確認

### 16.3 バリデーション

* NS ホスト名
* Glue 対象ホスト名
* IPv4
* IPv6
* DS key tag
* DS algorithm
* DS digest type
* DS digest
* TXT サイズ
* Resource 全体サイズ
* 重複レコード
* NS と GLUE の整合性

### 16.4 安全対策

* 変更前の Resource を表示
* 変更後の Resource を表示
* 差分表示
* 全レコード削除時に警告
* 最後の NS 削除時に警告
* 不正な Resource の送信禁止
* Name を再入力する確認オプション
* 更新後に Transaction ID を表示

---

## 17. Renewal

### 17.1 対象一覧

* Renewal 可能
* Renewal 推奨
* Expiration 接近
* Renewal 不要
* Renewal 不可

### 17.2 操作

* 個別 Renewal
* 複数選択 Renewal
* 全件 Renewal
* 手数料推定
* 実行確認
* 実行結果一覧

### 17.3 一括処理

約100件の Name を想定し、一括 Renewal を初期版に含める。

一括処理時は、すべてを単一の不透明な処理として扱わず、Name ごとの成功・失敗を確認できること。

結果例：

```text
example1/ Success
example2/ Success
example3/ Failed: Wallet locked
example4/ Skipped: Renewal not available
```

### 17.4 通知条件

以下のしきい値を設定可能とする。

* 残りブロック数
* 推定残り日数
* Expiration までの割合

---

## 18. Transfer

### 18.1 Transfer 開始

* 移管先アドレス入力
* アドレス形式検証
* Network 検証
* Transfer 手数料表示
* Lockup 期間説明
* Name 再入力確認
* 再認証
* Transfer 実行

### 18.2 Transfer 状態

* Transfer 開始済み
* Finalize 待ち
* Finalize 可能
* Finalize 完了
* Transfer 失敗

### 18.3 Finalize

* Finalize 可能時期表示
* 残りブロック表示
* 移管先再確認
* 再認証
* Finalize 実行
* Transaction ID 表示

---

## 19. Revoke

### 19.1 操作制限

Revoke は不可逆操作として扱う。

通常の操作メニューから一段階離れた「危険な操作」領域に配置する。

### 19.2 確認

* Revoke の影響説明
* 復元不能であることの表示
* 対象 Name の手入力
* 管理者パスワード再入力
* TOTP 再入力
* 最終確認
* 実行

---

## 20. 通知

### 20.1 アプリ内通知

* Renewal 期限接近
* Expiration 接近
* Finalize 可能
* Transfer 状態変更
* トランザクション確定
* トランザクション失敗
* Node 接続断
* Wallet 接続断
* Node 同期停止
* Wallet 同期遅延
* hsd バージョン非対応

### 20.2 外部通知

初期版では任意機能とする。

候補：

* Web Push
* ntfy
* Gotify
* Discord Webhook
* Email

外部通知には以下を含めない。

* Seed
* Private key
* Wallet password
* API Key
* 全残高
* 完全な内部エラー情報

---

## 21. セキュリティ要件

### 21.1 秘密情報

以下をブラウザーへ返さない。

* hsd API Key
* Wallet API Key
* サーバー環境変数
* Wallet password
* Private key
* xpriv

### 21.2 Cookie

* HttpOnly
* Secure
* SameSite=Strict
* 有効期限設定
* ローテーション可能なセッションID
* ログアウト時の即時無効化

### 21.3 CSRF

すべての書き込み操作に CSRF 対策を実施する。

### 21.4 Content Security Policy

原則として以下を適用する。

* 外部スクリプト禁止
* inline script 禁止
* iframe 埋め込み禁止
* 不要な外部通信禁止
* WebSocket 接続先制限
* API 接続先制限

### 21.5 RPC 制限

任意の RPC メソッドを実行できる汎用プロキシを実装しない。

各操作に専用のアプリケーションAPIを定義する。

例：

```text
GET  /api/node/status
GET  /api/wallet/balance
POST /api/wallet/send
GET  /api/names
GET  /api/names/:name
POST /api/names/:name/update
POST /api/names/:name/renew
POST /api/names/:name/transfer
POST /api/names/:name/finalize
POST /api/names/:name/revoke
```

### 21.6 ログ

ログへ出力しないもの：

* Mnemonic
* Private key
* xpriv
* Wallet password
* API Key
* Authorization header
* TOTP secret
* リカバリーコード

アドレス、Name、Transaction ID のログ出力は設定で無効化可能とする。

### 21.7 Rate Limit

特に以下へ厳しい Rate Limit を設定する。

* Login
* TOTP 検証
* Wallet unlock
* HNS 送信
* DNS 更新
* Renewal
* Transfer
* Finalize
* Revoke

---

## 22. 非機能要件

### 22.1 性能

* Name 100件を通常利用で遅延なく表示できる
* Name 1,000件まで拡張可能
* 一覧取得はキャッシュ可能
* 書き込み前は最新状態を再取得
* 取引履歴はページネーション
* 一括操作は進捗表示
* hsd API への同時リクエスト数を制限

### 22.2 可用性

* hsd 再起動後に自動再接続
* hs-wallet 再起動後に自動再接続
* 接続断をUIへ即時表示
* 読み取りAPIのみ限定的に自動Retry
* 書き込みAPIは自動Retryしない
* 一時的な API エラー時もアプリ全体を停止しない

### 22.3 データ整合性

* hsd / hs-wallet の状態を正とする
* 独自DBのキャッシュを正として扱わない
* Name 状態は定期的に再取得
* 操作前後に Name 状態を再確認
* Transaction ID を取得後、履歴と照合する

### 22.4 監視

最低限、以下のヘルスチェックを提供する。

```text
GET /health
GET /ready
```

`/health` は Web アプリ自体の稼働状態を返す。

`/ready` は以下を含める。

* Database 接続
* hsd 接続
* hs-wallet 接続
* Wallet 存在確認

認証なしのヘルスチェックには、残高、Name、Wallet ID 等を含めない。

---

## 23. 推奨技術構成

### 23.1 Monorepo

```text
apps/
├── web/
└── server/

packages/
├── domain/
├── hsd-client/
├── schemas/
├── ui/
└── config/

docker/
├── Dockerfile
└── compose.yaml
```

### 23.2 技術候補

* Frontend: React
* Web Framework: Next.js
* Backend: Fastify または Hono
* Language: TypeScript
* Validation: Zod
* Database: SQLite
* ORM: Drizzle ORM
* Authentication: 独自セッション認証
* Password hashing: Argon2id
* Testing: Vitest
* E2E: Playwright
* Deployment: Docker Compose
* Reverse Proxy: Caddy、Traefik、Nginxのいずれか

### 23.3 API Adapter

hsd のレスポンスをアプリ内部で直接利用せず、Adapter 層で変換する。

```text
UI
↓
Application API
↓
Wallet Service
↓
Handshake Client Interface
↓
HsdV8Adapter
↓
hsd / hs-wallet
```

内部モデル例：

```typescript
interface HandshakeNodeClient {
  getStatus(): Promise<NodeStatus>;
  getNetwork(): Promise<Network>;
  getVersion(): Promise<string>;
}

interface HandshakeWalletClient {
  getBalance(): Promise<WalletBalance>;
  getTransactions(query: TransactionQuery): Promise<TransactionPage>;
  getReceiveAddress(): Promise<string>;
  send(request: SendRequest): Promise<BroadcastResult>;
  getNames(): Promise<OwnedName[]>;
  getName(name: string): Promise<NameDetails>;
  updateName(request: UpdateNameRequest): Promise<BroadcastResult>;
  renewName(name: string): Promise<BroadcastResult>;
  transferName(request: TransferNameRequest): Promise<BroadcastResult>;
  finalizeName(name: string): Promise<BroadcastResult>;
  revokeName(name: string): Promise<BroadcastResult>;
}
```

---

## 24. Docker Compose 要件

### 24.1 必須設定

環境変数例：

```env
APP_URL=https://wallet.example.com
DATABASE_URL=/data/wallet.sqlite

HSD_NODE_URL=http://hsd-host:12037
HSD_NODE_API_KEY=...
HSD_WALLET_URL=http://hsd-host:12039
HSD_WALLET_API_KEY=...
HSD_WALLET_ID=primary
HSD_NETWORK=main

SESSION_SECRET=...
ENCRYPTION_KEY=...
TRUST_PROXY=true
```

### 24.2 Secret 管理

本番では `.env` の平文保存だけに依存せず、以下へ移行可能な構成とする。

* Docker Secrets
* systemd credentials
* SOPS
* 1Password CLI
* Bitwarden Secrets Manager

### 24.3 Volume

```yaml
volumes:
  - ./data:/app/data
```

Volume に保存するのは Web ウォレット独自データのみとする。

hsd の Chain DB と Wallet DB は別途管理する。

### 24.4 アップデート

```text
docker compose pull
docker compose up -d
```

で更新可能とする。

DB migration はコンテナ起動時に安全に実行する。

---

## 25. 初期リリース計画

### Phase 1: 基盤

* Docker Compose
* 管理者初期設定
* ログイン
* TOTP
* hsd 接続設定
* 接続テスト
* Node 状態
* Wallet 状態
* レスポンシブUI

### Phase 2: HNS ウォレット

* 残高
* 受信
* 送信
* 取引履歴
* Wallet lock / unlock
* 既存 Wallet ID 接続
* Mnemonic 復元

### Phase 3: Name 閲覧

* Name 一覧
* Name 検索
* Name 詳細
* DNS Resource 表示
* オークション履歴の閲覧
* ローカルラベルとメモ

### Phase 4: Name 管理

* DNS Resource 更新
* Renewal
* 一括 Renewal
* Transfer
* Finalize
* Revoke
* 通知

### Phase 5: 運用強化

* Web Push
* 外部通知
* 監査ログ
* バックアップ確認
* 互換性チェック
* 障害時の診断画面

### Phase 6: Name オークション

* Name 利用可否確認
* Open
* Bid
* Reveal
* Redeem
* Register
* Reveal 期限通知

---

## 26. 受け入れ条件

初期版は、以下を満たした場合に完成とする。

1. Linux 上で Docker Compose により起動できる
2. Chrome および Firefox からログインできる
3. スマートフォン表示で主要操作が利用できる
4. 自宅サーバー上の hsd 8.x に接続できる
5. 単一の既存 Wallet ID を利用できる
6. Mnemonic から Wallet を復元できる
7. HNS の残高を表示できる
8. HNS を送受信できる
9. Transaction 履歴を確認できる
10. 約100件の保有 Name を一覧表示できる
11. Name の DNS Resource を表示できる
12. DNS Resource を更新できる
13. 個別および一括 Renewal ができる
14. Transfer と Finalize ができる
15. Revoke に多段階確認がある
16. hsd API Key がブラウザーへ露出しない
17. 書き込み操作が自動再試行されない
18. Node または Wallet の切断を検出できる
19. インターネット経由では HTTPS が必須になる
20. シードや秘密鍵がアプリ独自DBおよびログへ保存されない
21. Name を Open し、Bid・Reveal・Redeem・Register を実行できる
22. Reveal 期限が近づいた際に通知される

---

## 27. Name オークション

### 27.1 Name 利用可否確認

* Name 入力による利用可否検索
* hsd `getnameinfo` を用いた確認(独自の予約 Name 一覧は保持しない)
* 結果区分:
  * Available(未 Open)
  * Reserved(予約済み Name。初期版では非対応であることを表示し、hsd 側のエラーに委ねる)
  * 既に Opening/Bidding/Revealing/Closed 状態(該当 Name の詳細画面へ誘導)

### 27.2 Open

* 対象 Name 入力・確認
* 手数料推定(Preview)
* Name 再入力確認
* 再認証
* 実行

### 27.3 Bid

* Bid 金額入力
* Lockup 金額入力(既定値は Bid と同額。任意で引き上げ可能なプライバシー用の詳細項目を提供する)
* Lockup が Bid 未満にならないことの検証
* Lockup は Reveal まで全額ロックされる旨の説明表示
* 手数料推定(Preview)
* Name 再入力確認
* 再認証
* 実行

### 27.4 Reveal

* 自ウォレットの未 Reveal Bid の表示
* Reveal 期限(残りブロック数)の表示
* Reveal を行わない場合 Lockup 全額が没収される旨の警告
* 手数料推定(Preview)
* 再認証
* 実行

### 27.5 Redeem

* 敗北した Bid の Lockup 回収
* 対象がない、または落札者である場合は hsd のエラーメッセージをそのまま表示する(本アプリ側では勝敗判定を独自に行わない)
* 手数料推定(Preview)
* 再認証
* 実行

### 27.6 Register

* Closed かつ未登録の Name に対して、既存の DNS Resource 編集画面(§16)を「Register」として流用する
* Resource 未設定のままでも登録のみ実行可能とする
* 実行結果は既存の Update と同じ Transaction ID 表示に従う

### 27.7 通知条件

* Reveal 期限接近を、既存の Renewal 通知(§17.4)と同様のしきい値方式で通知する
* 対象は自ウォレットが Bid 済みかつ未 Reveal の Name に限る
