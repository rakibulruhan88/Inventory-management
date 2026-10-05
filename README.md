# Afia Leather Inventory

Local-first inventory management for Afia Leather. The project is an npm workspace with a Vite/React frontend, a NestJS API, shared TypeScript contracts, Prisma, and PostgreSQL in Docker.

## Workspace

```text
apps/
  web/        React + Vite + TypeScript
  api/        NestJS + Prisma
packages/
  contracts/  API types shared with web and future mobile apps
```

## Start locally

```bash
npm install
docker compose up -d postgres
npm run db:migrate
npm run dev
```

- Web: http://localhost:5174
- API health: http://localhost:3000/api/health
- API docs: http://localhost:3000/api/docs
- PostgreSQL: localhost:5433 (container port 5432)

Ports 5174 and 5433 are used on the host so this project does not interfere with other local services already using 5173 and 5432.

## Useful checks

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## Current foundation

- Receive Stock supports searchable suppliers, creating a supplier from a mobile drawer, and unique containers.
- Existing item codes and color/size variants are searchable and reused instead of creating duplicate product masters.
- Every receipt keeps its own container batch with required Roll stock and optional Meter tracking.
- Products are sold only by Roll. Meter is optional and never blocks a Roll sale when it is blank or zero.
- Sale prices are manually entered per line. Invoice totals support discount, amount received, applied payment, due, and returned change.
- Completed sales open a branded A4 invoice that can be printed or downloaded as a true PDF.
- Inventory starts collapsed at item level and expands into color variants, rolls, meters, and container history, with safe edit/archive actions.
- Customers, containers, and sales now have searchable live screens. Customers and containers can be edited or safely archived.
- Live inventory totals are available from the API and refresh after stock is received.

Current API routes:

```text
GET  /api/health
GET  /api/inventory/summary
GET  /api/inventory/items?search=
GET  /api/products?search=
GET  /api/suppliers?search=
POST /api/suppliers
POST /api/purchases/receive
GET  /api/customers?search=
POST /api/customers
PATCH/DELETE /api/customers/:id
GET  /api/containers?search=
PATCH/DELETE /api/containers/:id
GET  /api/sales?search=
GET  /api/sales/:id
POST /api/sales
```

Run `npm run db:seed` once to add the included development purchases, multi-color stock, customers, containers, and Roll-based sales. The seed is idempotent.

Copy `.env.example` to `.env` when setting up the project on another machine. The checked-in example contains development-only defaults; production secrets must be supplied by the VPS environment.
# Afia Leather Inventory

Private store software built with React/Vite, NestJS and PostgreSQL/Prisma.

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and replace all password/secret placeholders.
3. Start PostgreSQL with `docker compose up -d`.
4. Apply migrations with `npm run db:migrate` (or `npm exec --workspace @afia/api -- prisma migrate deploy`).
5. Optionally load local starter data with `npm run db:seed`.
6. Start both apps with `npm run dev`.

Build for production with `npm run build`. Validate with `npm run typecheck`, `npm run lint`, and `npm test`.

## Owner login

Set `OWNER_BOOTSTRAP_USERNAME` and a strong `OWNER_BOOTSTRAP_PASSWORD` before the first API start. When no users exist, the API creates the first owner with a bcrypt hash. Remove the bootstrap password from the environment after the owner exists. There is no public registration.

Set a long random `JWT_SECRET` in production. The signed session is stored in an HTTP-only, same-site cookie. Every API except health and login is protected.

## Invoice email

Email is sent only by the API. For Gmail, enable two-step verification, create a Google App Password, and place it in `MAIL_APP_PASSWORD`—never in a `VITE_*` variable. Configure `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_USER`, `MAIL_FROM_NAME`, and `MAIL_FROM_EMAIL` as shown in `apps/api/.env.example`. Missing or invalid SMTP configuration never rolls back a completed sale; the failure is logged and shown clearly.

## PWA / iPhone

The production build generates a web app manifest and service worker. On iPhone, open the site in Safari, tap Share, choose **Add to Home Screen**, then tap **Add**. The app caches its shell for reliable loading but deliberately refuses sales, purchases, payments, and stock changes while offline.

## Accounting safety

Invoices retain customer, item/color, and store snapshots. Invoice numbers cannot be changed. Voiding a sale restores stock and reverses applied payments in one database transaction. Received purchases cannot be edited destructively; reversal is allowed only while their stock is untouched, otherwise use a recorded Stock Adjustment.
