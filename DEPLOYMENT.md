# Production deployment

From your Mac checkout on `invoice-import`, commit the intended changes, resolve
any remaining edits, then run:

```sh
./deploy-live.sh
```

The script pushes that exact commit to `origin/invoice-import` and deploys to
`ubuntu@158.69.49.65:/www/wwwroot/afia-inventory`. It refuses a dirty/wrong-branch
checkout, a failed push, concurrent deployment, or a different incoming commit.
This includes untracked files unless ignored. Commit the deployment scripts with
your normal Git workflow before the first run. The script never commits for you.

Local validation: `npm run typecheck`, `npm test`, `git diff --check`, and
`node --test scripts/deploy-live.test.cjs`. Deployment tests simulate VPS commands
in temporary directories and never contact production.

The VPS needs working noninteractive Git credentials, an already trusted SSH host
key on your Mac, and `git`, Bash, Node/npm/npx, PM2, PostgreSQL client tools,
`rsync`, `tar`, `curl`, `flock`, `sha256sum`, and `cmp` on its PATH. Use the existing
Node version compatible with the project (at least Node 22.13); do not upgrade
dependencies as part of deployment. PostgreSQL client tools must support the
server version. The `ubuntu` account needs read access to private storage and
write access to the project/frontend and `/home/ubuntu/backups/afia`.

The root VPS `.env` must target the **existing local PostgreSQL database
`afia_inventory_prod`**. Any API `.env`, PM2 or shell database override must match
it. The existing single PM2 `afia-api` process must run
`npm run start --workspace @afia/api` with project-root working directory and
`INVOICE_IMPORT_STORAGE_ROOT=/var/lib/afia/invoice-import-storage` from its
environment or production `.env`. The script verifies these prerequisites and
does not replace the PM2 definition or switch to `start:prod`.

The ten stages back up production, fast-forward Git, install locked dependencies
with `npm ci --include=dev` (the current API requires `tsx`), generate Prisma,
apply migrations, build in `apps/web/dist-release`, publish with aaPanel exclusions,
restart the existing API, and verify local/public health. All existing root,
API and frontend `.env` files are fingerprinted and checked for changes. The
script does not copy local `.env`, data, documents, Nginx or SSL files.

The frontend copy preserves `.well-known/`, `.user.ini`, `404.html` and `502.html`,
copies assets before replacing `index.html`, and never builds into live `dist`.
After an initial delay, local API readiness retries for up to 45 seconds. Public
API JSON must match the health service; frontend HTML must return HTTP 200. Main
hashed JS/CSS references must match release, published and live HTML; live main
asset contents are also compared with the release. This does not replace your
manual browser checks, including installed PWA/service-worker behavior.

## Database migrations

Create and review migrations locally, commit them with the application, and use
the same deploy command. Every deployment runs:

```sh
npm run db:generate
npm exec --workspace @afia/api -- prisma migrate deploy
npm exec --workspace @afia/api -- prisma migrate status
```

Only committed pending migrations are applied; the status command must succeed
before frontend publication or API restart. Review migration SQL for data loss,
locks and compatibility with the still-running API. The script cannot make
destructive migration SQL safe. Follow `docs/locked-requirements.md`, including
the customer-phone audit and explicit duplicate resolution if that migration is
pending. Never edit already-applied migrations. A production database reset is
**not** part of normal deployment. Do not use `migrate dev`, seed, `db push`,
reset/drop, or automatic migration resolution on the VPS.

## Backups and failure behavior

Before changing production code/dependencies/schema, timestamped private backups
are written to:

- `/home/ubuntu/backups/afia/database/afia_inventory_prod-<timestamp>-<sha>-<pid>.dump`
- `/home/ubuntu/backups/afia/documents/invoice-import-storage-<timestamp>-<sha>-<pid>.tar.gz`

The database backup is custom-format `pg_dump`, with `.env` parsed as data and a
temporary mode-0600 password file (deleted afterward). No password goes into the
command arguments or terminal output. Archives are checked with `pg_restore
--list` and `tar -tzf`, then renamed from `.partial`. This is an integrity check,
not a full restore rehearsal. Failed/incomplete archives retain `.partial` names.
Both completed backup paths are printed; checksum, prior commit and migration
status files accompany the database backup. Before publication, an additional
frontend archive is saved under `/home/ubuntu/backups/afia/frontend/`.

Every failure exits nonzero with its stage and completed backup paths. Migration
failure stops before publication/restart; frontend build failure leaves current
live `dist` untouched. Restart/health failures show PM2 status and the last 50
log lines with known secrets redacted. A successful run prints `DEPLOY SUCCESS`,
commit, migration status, backup filenames and health results. Lost SSH or a
partial publication requires inspection; no automatic rollback/reset runs.

## Rollback precautions and remaining limits

Keep the printed previous commit and backup paths. First diagnose the failed
stage and check migration status and PM2. After a migration has been applied,
rolling code back is safe only if that code supports the current schema. Prefer
a reviewed forward fix. Do not blindly restore the pre-deploy database: it would
discard sales/payments/uploads made afterward. Rehearse restoration to a separate
database and private document directory; production restoration needs an explicit
maintenance/recovery plan and coordinated database/documents recovery.

For a frontend-only rollback, inspect the archived `dist`, restore to a temporary
directory, and publish with the same four aaPanel exclusions and assets-first
ordering. Do not extract blindly over the live directory or change protected files.
API rollback must reinstall the matching lockfile, regenerate Prisma and retain
the existing PM2 `npm run start` runtime, followed by health checks.

This in-place workflow leaves the old API running during installation/migrations,
so use backward-compatible migrations and a quiet deployment window. Database
and document backups are sequential, not one atomic snapshot; concurrent writes
can prevent a fully consistent recovery pair. Pause business writes/uploads for
a coordinated recovery point. Publication is not an atomic directory switch;
interruptions can leave mixed files, and already-open clients can reference old
assets. Rerun after inspection or restore the saved frontend with exclusions.
Server-side checks do not invalidate browser/PWA/CDN caches.

Backups remain on the same VPS with no automatic pruning. Monitor free space,
arrange separate off-server copies and test restoration; filesystem/role/global
PostgreSQL configuration is not captured by this single-database dump. Commands
retain normal TLS/SSH verification. Never use `npm audit fix --force` as deployment
repair. `.gitignore` prevents new release/backup/env/PDF artifacts from being
added accidentally; it does not untrack any files already in Git.
