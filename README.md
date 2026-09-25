# MIRACLE TOPUP

Backend-first game top-up portfolio with a plain **HTML + CSS + vanilla JavaScript** storefront and admin interface. The server is **Node.js / Express**, with **PostgreSQL on Neon** as the intended persistent database and **Drizzle** schema migrations.

## Current status

- Implemented and tested locally: registration, hashed passwords, server-side sessions, CSRF protection, public catalog/articles, device-local cart, server-priced checkout, order ownership, idempotent simulated payments, durable fulfillment queue, supplier simulation balance/ledger, admin price controls, articles, and audit logs.
- **Neon database provisioned and migrated (2026-09-25).** Project `miracle-gaming`, AWS Singapore, PostgreSQL 18. Verified through Neon SQL Editor: 12 application tables, 4 games, 5 products, 1 article and 1 Drizzle migration. Direct application-to-Neon connectivity remains unverified: this workspace returns DNS error `EAI_AGAIN`. The website is not deployed yet.
- Source repository: `arkhenmmiracle/miracle-gaming`. No unrelated repository was modified.
- Payment and fulfillment are **simulation only**. There is no real payment QR code, live supplier, nickname validation, or real diamond delivery.
- The optional local demo uses PGlite (local PostgreSQL), explicitly labelled in the UI. It is not Neon and is forbidden with `NODE_ENV=production`.

## Requirements

Node.js 22.16+ (Node 24 recommended), npm, a new Neon database. No React or Next.js.

## Run the local demonstration

```sh
npm ci
npm run demo:init
npm run demo
```

Open `http://localhost:3000`. Create a customer account in the UI (password minimum 12 characters). Choose a game, enter ID/server, add to cart, checkout and click **Simulasikan Pembayaran Berhasil**. The worker processes one queued order every 3 seconds; use **Periksa Status** to refresh.

The catalog contains 4 games and 5 example products. Original AI-generated imagery is illustrative, not official game artwork. Prices are examples.

The `demo:*` scripts use POSIX environment assignment. In Windows PowerShell:

```powershell
$env:LOCAL_DEMO='true'
node db/migrate.js
node db/seed.js
node src/server.js
```

## Connect Neon

1. Use the dedicated `miracle-gaming` Neon project (`tiny-lab-90182510`), branch `production` (`br-flat-unit-b3p0tx01`), database `neondb`. For a separate installation, create a new project.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL` to the pooled Neon URL and `DATABASE_URL_UNPOOLED` to the direct URL. Keep TLS enabled as provided by Neon.
4. Set `APP_ORIGIN` to the exact frontend origin; set `LOCAL_DEMO=false`.
5. Run:

```sh
npm run db:migrate
npm run db:seed
npm start
```

Secrets belong in server environment variables, never in `public/`, GitHub, screenshots, or chat. `.env` and `.local-db/` are git-ignored. Data in the local demo is not automatically copied to Neon.

### Initial database setup fallback

The initial setup was applied through Neon SQL Editor because this workspace could not resolve the database host and the connector lacked project context. The SQL was exported from the committed Drizzle migration, including its original hash/timestamp journal, plus `db/seed.js`, and executed in one transaction. Subsequent `npm run db:migrate` runs recognize it as already applied.

For a **new, empty database only**, generate the same bootstrap SQL:

```sh
node scripts/export-neon-bootstrap.js > neon-bootstrap.sql
```

Do not rerun this bootstrap on the existing database. Use normal Drizzle migrations for later changes. The bootstrap was also verified locally by applying it to an empty PGlite database and then running the standard migrator without duplicate schema creation.

## Create an administrator

Set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` (12–72 characters) in a private environment or `.env`. Then:

```sh
npm run admin:create
```

For local demo also set `LOCAL_DEMO=true`. This command creates a new account; it does not silently promote an existing customer. Remove `ADMIN_PASSWORD` from the environment afterwards. There is no seeded administrator or default password. Sign in and open **Dashboard Admin** in the account dropdown.

## Architecture

```text
HTML / CSS / browser JavaScript
             |
      same-origin REST API
             |
     Node.js / Express server
             |
     Neon PostgreSQL database
             |
   durable fulfillment_jobs queue
             |
      simulation worker
```

- Anonymous users browse catalog and articles and prepare a local cart.
- Checkout and order history require a session.
- Sessions use random 256-bit cookies; only a SHA-256 hash is stored. Cookies are HttpOnly, SameSite=Lax and Secure under HTTPS production.
- Every mutation checks the exact Origin; authenticated mutations also require a session-bound CSRF token.
- Registration always creates a customer. Admin APIs check the database-backed role on every request.
- Checkout snapshots current prices, product names/codes, cost and ID destination inside a transaction. Client-submitted amounts are ignored.
- Checkout idempotency keys are scoped to the customer and bound to the request body.
- Payment confirmation and queue insertion are one transaction. Duplicate simulated payments do not create duplicate jobs.
- Fulfillment locks the job, order, and supplier balance. Debit, ledger entry and completion are atomic in the **simulation adapter**. A unique ledger order reference prevents duplicate debits.
- Insufficient balance puts the job on hold. An admin adds simulated balance and explicitly retries it. Successful/uncertain orders cannot be blindly retried.
- Internal admin notes are written only to audit logs, not customer-visible order events.
- Order history is capped at 100 customer / 200 admin rows in this first slice. Production pagination is a follow-up.

## Main API endpoints

| Method | Endpoint | Access |
|---|---|---|
| GET | `/api/health`, `/api/catalog`, `/api/articles`, `/api/session` | Public |
| POST | `/api/auth/register`, `/api/auth/login` | Public; rate limited + Origin |
| POST | `/api/auth/logout` | Customer |
| PATCH | `/api/profile` | Customer |
| POST | `/api/orders` | Customer + Idempotency-Key |
| GET | `/api/orders`, `/api/orders/:id` | Owner only |
| POST | `/api/orders/:id/simulate-payment` | Owner; simulation only |
| GET | `/api/admin/dashboard`, `/api/admin/orders`, `/api/admin/orders/:id` | Admin |
| POST | `/api/admin/orders/:id/retry`, `/api/admin/orders/:id/notes` | Admin |
| GET/PATCH | `/api/admin/products`, `/api/admin/products/:id` | Admin |
| GET/POST | `/api/admin/supplier`, `/api/admin/supplier/deposit` | Admin; deposit simulated |
| GET/POST | `/api/admin/articles` | Admin |
| GET | `/api/admin/audit` | Admin |

Use the CSRF value from `/api/session` as `X-CSRF-Token`. Use the configured `APP_ORIGIN` as `Origin` for mutations. Cookies authenticate the browser.

## Testing

```sh
npm test
```

Integration tests run real PostgreSQL queries in an isolated in-memory PGlite database. They cover authorization/IDOR, role injection, CSRF, server-side pricing, required destination data, checkout idempotency, duplicate payments, single fulfillment/debit, low-balance hold/retry/audit, expiry and logout. These tests do not prove connectivity to Neon or a live provider.

## Before real money

A live provider adapter and payment adapter have **not** been implemented. Server startup refuses non-simulation provider modes. Production work still requires verified/signed webhooks, event deduplication, outbox dispatch and provider reconciliation on timeouts, partial fulfillment handling, refunds, verified product availability and price synchronization, account recovery/email verification, stronger admin authentication, centralized rate limiting, monitoring, backup/recovery, and deployment review. Never replace uncertain provider outcomes with a forced success button.

The implemented admin slice does not yet include the previously mocked banner/promo editor, customer management or refund UI. Those menus are not shown as functional controls.

## GitHub

Repository: https://github.com/arkhenmmiracle/miracle-gaming

```sh
git clone https://github.com/arkhenmmiracle/miracle-gaming.git
cd miracle-gaming
npm ci
```

GitHub Pages alone cannot run this backend. Deploy to a Node.js-capable host and configure the same-origin app with Neon server credentials.
