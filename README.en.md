# Alice HNS Wallet

_(日本語版は [README.md](README.md) を参照してください / For the Japanese version, see [README.md](README.md).)_

A personal-use web wallet that connects to a self-hosted Handshake (HNS) full node `hsd` 8.x + `hs-wallet`.

Developed to connect to the latest `hsd` without depending on the existing [Bob Wallet](https://github.com/kyokan/bob-wallet). It is intended for a single operator managing a single wallet. Private key management and signing are delegated entirely to `hs-wallet`; the `hsd` / `hs-wallet` API keys are never exposed to the browser.

See [docs/01-SPECIFICATION.md](docs/01-SPECIFICATION.md) for the full specification and [docs/02-IMPLEMENTATION-PLAN.md](docs/02-IMPLEMENTATION-PLAN.md) for the implementation phases.

> **Note:** Starting, stopping, upgrading, and backing up `hsd` itself is out of scope for this project. You must provide a running `hsd` node and `hs-wallet` separately.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Setup (Production / Docker Compose)](#setup-production--docker-compose)
- [Setup (Development)](#setup-development)
- [Environment Variables](#environment-variables)
- [Development Commands](#development-commands)
- [Maintenance](#maintenance)
- [Security Design](#security-design)
- [Unsupported Features](#unsupported-features)

## Features

### Authentication & Access Control

- Admin account creation via a first-run setup wizard
- Password login + TOTP two-factor authentication (with recovery codes)
- Re-authentication required before sensitive operations such as sending funds or Name actions
- Session management via HttpOnly / Secure / SameSite cookies, with CSRF double-submit tokens
- Per-route rate limiting

### hsd Connection Management

- Register and edit `hsd` Node / `hs-wallet` connection settings from the UI (with a connectivity check before saving)
- Hot-reloading connection manager — no restart required
- Periodic polling of Node / Wallet health, plus an on-demand diagnostics screen

### Wallet

- Management of a single wallet, with mnemonic import
- Lock / unlock the wallet
- Receive address issuance (QR code display & sharing)
- Sending funds (fee preview → confirmation → re-authentication, idempotency-key based duplicate-send prevention, automatic re-lock after sending)
- Paginated transaction history with covenant-type labels

### Name Management

- List of owned Names (filter, sort, search — all handled client-side)
- Name detail view; add/edit/delete/reorder DNS resource records (NS / GLUE4 / GLUE6 / DS / TXT / SYNTH4 / SYNTH6) with before/after diff display
- Renewal (individual or batch, with safe abort of batch processing when a lock is detected)
- Transfer / Finalize
- Revoke (a "danger zone" action requiring password + TOTP/recovery code re-entry)

### Name Auctions

- Open (start an auction) / Bid / Reveal / Redeem / Register
- Name availability check
- Notifications as the reveal deadline approaches

### Notifications

- Dashboard warnings and in-app notifications (renewal/expiration approaching, transfer state changes, send confirmed/failed, Node/Wallet disconnects, etc.)
- External notification integrations (ntfy / Discord webhook) — designed to never include sensitive data such as seeds, private keys, API keys, or full balances in notifications
- Audit log (records success/failure of every write operation; request bodies are not logged)

### Distribution

- Single-container distribution via Docker Compose
- A Compose profile bundling `hsd` regtest for development/testing is included

## Architecture

This is a monorepo built with pnpm workspaces.

```text
apps/
  server/   API server built with Hono (Node.js). Uses SQLite (better-sqlite3 + Drizzle ORM),
            Argon2 for password hashing, and TOTP (otpauth)
  web/      SPA built with Vite + React 18 + TanStack Router / Query
packages/
  domain/     Pure logic shared between frontend/backend: covenant, renewal, and DNS resource
              validation, etc.
  hsd-client/ Custom HTTP client for the hsd Node API / hs-wallet API
  schemas/    Zod schemas for API input/output
  config/     Shared tsconfig
```

The frontend uses a Vite + React SPA rather than Next.js. This is a deliberate design choice to keep the Content Security Policy simple (no external scripts, no inline scripts, etc.). Since `hsd-client` has no official documentation, it was implemented and verified by probing an actual regtest node.

## Requirements

- Node.js 22 or later (see [.nvmrc](.nvmrc))
- pnpm 10 (available via `corepack enable`)
- Docker / Docker Compose (used for production deployment and for running the development `hsd` regtest)
- A running `hsd` 8.x node and `hs-wallet` (out of scope for this project — provide separately)

## Setup (Production / Docker Compose)

1. Clone the repository.

   ```bash
   git clone https://github.com/mika-f/alice-hns-wallet.git
   cd alice-hns-wallet
   ```

2. Copy `docker/.env.example` to `docker/.env` and edit the values.

   ```bash
   cp docker/.env.example docker/.env
   ```

   Set `SESSION_SECRET` / `ENCRYPTION_KEY` to random values of at least 32 characters (e.g. `openssl rand -hex 32`).

3. Build and start the image.

   ```bash
   docker compose -f docker/compose.yaml up -d --build
   ```

4. The app listens on port `3000` inside the container (`docker/compose.yaml` publishes `3000:3000`). Do not expose it directly to the internet — use a VPN or reverse proxy (e.g. Traefik) for access control and HTTPS termination.

   `TRUST_PROXY=true` is set by default, and CSRF verification etc. is based on the public URL configured in `APP_URL`. Make sure `APP_URL` matches the actual URL (the real `https://` URL) that the browser accesses behind the reverse proxy.

5. On first access, the setup wizard will appear, allowing you to create the admin account and enable TOTP.

## Setup (Development)

1. Install dependencies.

   ```bash
   pnpm install
   ```

2. Start the regtest `hsd` used for development/testing.

   ```bash
   docker compose -f docker/compose.dev.yaml --profile hsd up -d --wait
   ```

3. Copy `apps/server/.env.example` to `apps/server/.env` and configure the connection info for the regtest `hsd` (`HSD_NODE_URL=http://127.0.0.1:14037`, `HSD_WALLET_URL=http://127.0.0.1:14039`, and an API key such as `devkey`).

4. Start the server and frontend (run in parallel, in separate terminals).

   ```bash
   pnpm dev:server
   pnpm dev:web
   ```

5. Open `http://localhost:5173` in your browser (Vite dev server; API requests are proxied to `apps/server`).

## Environment Variables

| Variable                                | Description                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`                               | The app's public URL (used for CSRF verification and link generation)                                                           |
| `HOST` / `PORT`                         | The server's listen address / port                                                                                              |
| `TRUST_PROXY`                           | Set to `true` when running behind a reverse proxy                                                                               |
| `DATABASE_URL`                          | Path to the SQLite file                                                                                                         |
| `HSD_NODE_URL` / `HSD_NODE_API_KEY`     | Endpoint and API key for the hsd Node HTTP API                                                                                  |
| `HSD_WALLET_URL` / `HSD_WALLET_API_KEY` | Endpoint and API key for the hs-wallet HTTP API                                                                                 |
| `HSD_WALLET_ID`                         | The Wallet ID to manage                                                                                                         |
| `HSD_NETWORK`                           | `main` / `testnet` / `regtest` / `simnet`                                                                                       |
| `SESSION_SECRET`                        | Secret used to sign sessions (32+ characters)                                                                                   |
| `ENCRYPTION_KEY`                        | Encryption key for sensitive data stored in the DB, such as connection settings and external notification URLs (32+ characters) |

The `hsd` connection settings can also be changed from the UI (`/settings/connection`) after setup; the environment variables serve only as their initial values.

## Development Commands

| Command                                                       | Description                                             |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| `pnpm lint`                                                   | ESLint                                                  |
| `pnpm format` / `pnpm format:write`                           | Prettier check / auto-format                            |
| `pnpm typecheck`                                              | Type-check all packages                                 |
| `pnpm test`                                                   | Unit tests (Vitest)                                     |
| `pnpm --filter @alice-hns-wallet/hsd-client test:integration` | `hsd-client` integration tests (requires regtest `hsd`) |
| `pnpm --filter @alice-hns-wallet/server test:integration`     | Server integration tests (requires regtest `hsd`)       |
| `pnpm build`                                                  | Build all packages                                      |

Integration tests require the regtest `hsd` to be running (`docker compose -f docker/compose.dev.yaml --profile hsd up -d --wait`). CI ([.github/workflows/ci.yaml](.github/workflows/ci.yaml)) runs lint / format / typecheck / unit tests / integration tests / Docker image build.

## Maintenance

- **DB migrations**: Migration SQL is managed under `apps/server/src/db/migrations` and applied automatically on server startup (`apps/server/src/index.ts`). After changing the schema, generate a new migration with `pnpm --filter @alice-hns-wallet/server db:generate`.
- **Data persistence**: In production, the SQLite file is volume-mounted at `docker/data` (`/app/data` inside the container). Back up this directory (seeds/mnemonics are held by the wallet side and are never stored in this app's DB).
- **Operating hsd**: Starting, stopping, upgrading, and backing up chain data for `hsd` is the operator's responsibility; this app is not involved.
- **Updating dependencies**: After any update involving `pnpm-lock.yaml`, run `pnpm install` → `pnpm typecheck` → `pnpm test` to verify.

## Security Design

- The `hsd` API key, wallet API key, server environment variables, wallet password, private key, and xpriv are never returned to the browser.
- No generic proxy for arbitrary RPC calls is implemented; a dedicated API endpoint is defined for each operation.
- Logs never contain the mnemonic, private key, xpriv, wallet password, API key, `Authorization` header, TOTP secret, or recovery codes.
- Especially strict rate limits are applied to login, TOTP verification, wallet unlock, sending funds, DNS updates, renewal, transfer, finalize, and revoke.

See [docs/01-SPECIFICATION.md §21](docs/01-SPECIFICATION.md) for details.

## Unsupported Features

The initial release excludes the following (see [docs/01-SPECIFICATION.md §2.2](docs/01-SPECIFICATION.md) for details):

- Claiming reserved names (Proof-of-Burn / DNSSEC)
- Viewing auction market activity from other wallets/users (only your own wallet's Open/Bid/Reveal/Redeem)
- Multiple wallets or multiple users
- Ledger / Trezor / multisig
- Name trading, HNS purchases, or fiat conversion
- Starting, stopping, auto-updating, or backing up `hsd` itself
- Desktop app or official Safari support
- Web Push notifications (the `push_subscriptions` table exists in the schema but is unused)
