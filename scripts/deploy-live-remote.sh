#!/usr/bin/env bash
# Bundled by deploy-live.sh; not a standalone entry point.
set -Eeuo pipefail
set +x
umask 077
project=/www/wwwroot/afia-inventory
backup_root=/home/ubuntu/backups/afia
storage=/var/lib/afia/invoice-import-storage
domain=https://inventory.alifaleather.com
expected_commit=${1:?Missing committed deployment SHA}
step='[3/10] Production backup'
database_backup='not completed'
documents_backup='not completed'
frontend_backup='not completed'
scratch=''
api_restart_attempted=false

fail() { printf '%s\n' "$*" >&2; return 1; }
support() { node "$support_file" "$@"; }
cleanup() {
  [[ -z "$scratch" ]] || rm -rf -- "$scratch"
  rm -f -- "$support_file"
}
failure() {
  local code=$1
  trap - ERR INT TERM HUP
  printf '\nDEPLOY FAILED: %s (exit %s)\n' "$step" "$code" >&2
  printf 'Database backup: %s\nDocuments backup: %s\nFrontend backup: %s\n' \
    "$database_backup" "$documents_backup" "$frontend_backup" >&2
  if [[ "$api_restart_attempted" == true || "$step" == '[10/10] Health verification' ]]; then
    support diagnostics || true
  fi
  printf 'Stopped. No automatic database restore/reset or code rollback was attempted.\n' >&2
  exit "$code"
}
trap cleanup EXIT
trap 'failure $?' ERR
trap 'failure 130' INT
trap 'failure 143' TERM
trap 'failure 129' HUP

printf '%s\n' "$step"
[[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]] || fail 'Invalid deployment SHA.'
cd -- "$project"
for tool in git npm npx node pm2 pg_dump pg_restore rsync tar curl flock sha256sum cmp; do
  command -v "$tool" >/dev/null || fail "Missing VPS tool: $tool"
done
[[ "$(git rev-parse --show-toplevel)" == "$project" ]] || fail 'Unexpected VPS checkout.'
[[ "$(git branch --show-current)" == invoice-import ]] || fail 'VPS must be on invoice-import.'
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || fail 'VPS checkout has uncommitted changes; inspect manually.'
[[ -f .env && -d "$storage" && ! -L "$storage" ]] || fail 'Production .env or private document directory is unavailable.'
[[ ! -L apps/web/dist && ! -L apps/web/dist-release ]] || fail 'Frontend output directories must not be symlinks.'
mkdir -p -- "$backup_root/database" "$backup_root/documents" "$backup_root/frontend"
chmod 700 "$backup_root" "$backup_root/database" "$backup_root/documents" "$backup_root/frontend"
exec 9>"$backup_root/deploy.lock"
flock -n 9 || fail 'Another deployment is running.'
scratch=$(mktemp -d "$backup_root/.deploy.XXXXXXXX")
support preflight
support env-snapshot "$scratch/env.json"
previous_commit=$(git rev-parse HEAD)
stamp="$(date -u +%Y%m%dT%H%M%SZ)-${expected_commit:0:12}-$$"
database_target="$backup_root/database/afia_inventory_prod-$stamp.dump"
documents_target="$backup_root/documents/invoice-import-storage-$stamp.tar.gz"
support database-backup "$database_target.partial" "$scratch"
[[ -s "$database_target.partial" ]]
pg_restore --list "$database_target.partial" >/dev/null
mv -- "$database_target.partial" "$database_target"
database_backup=$database_target
tar -czf "$documents_target.partial" -C /var/lib/afia invoice-import-storage
tar -tzf "$documents_target.partial" >/dev/null
mv -- "$documents_target.partial" "$documents_target"
documents_backup=$documents_target
sha256sum "$database_backup" "$documents_backup" > "$backup_root/database/deploy-$stamp.sha256"
printf 'Database backup: %s\nDocuments backup: %s\nPrevious commit: %s\n' \
  "$database_backup" "$documents_backup" "$previous_commit"
printf '%s\n' "$previous_commit" > "$backup_root/database/deploy-$stamp.previous-commit"

step='[4/10] Pull'
printf '%s\n' "$step"
git fetch origin
[[ "$(git rev-parse origin/invoice-import)" == "$expected_commit" ]] || fail 'Origin advanced since the local push; rerun deployment from the intended commit.'
# Reject tracked production secrets/artifacts in the incoming tree before Git touches them.
support tracked-safety "$expected_commit"
git pull --ff-only origin invoice-import
[[ "$(git rev-parse HEAD)" == "$expected_commit" ]] || fail 'VPS HEAD differs from the requested deployment.'
support env-verify "$scratch/env.json"

step='[5/10] Dependencies'
printf '%s\n' "$step"
# The API uses tsx at runtime, so development dependencies must remain installed.
support run npm ci --include=dev
support env-verify "$scratch/env.json"
support run npm run db:generate

step='[6/10] Database migration'
printf '%s\n' "$step"
support run npm exec --workspace @afia/api -- prisma migrate deploy
support run npm exec --workspace @afia/api -- prisma migrate status | tee "$backup_root/database/deploy-$stamp.migration-status.txt"

step='[7/10] Frontend build'
printf '%s\n' "$step"
cd apps/web
rm -rf -- dist-release
support run npx --no-install tsc -b
support run npx --no-install vite build --outDir dist-release
cd -- "$project"
support assets apps/web/dist-release/index.html > "$scratch/expected-assets.txt"
# Save the existing frontend before publishing; leave aaPanel's files in place.
if [[ -d apps/web/dist ]]; then
  frontend_target="$backup_root/frontend/dist-$stamp.tar.gz"
  tar -czf "$frontend_target.partial" -C apps/web dist
  tar -tzf "$frontend_target.partial" >/dev/null
  mv -- "$frontend_target.partial" "$frontend_target"
  frontend_backup=$frontend_target
fi
support env-verify "$scratch/env.json"

step='[8/10] Publish'
printf '%s\n' "$step"
mkdir -p apps/web/dist
# Excludes protect both sender and receiver; never use --delete-excluded.
# Copy assets first, then atomically replace index.html after the copy succeeds.
rsync -rlt --delay-updates --delete-delay \
  --exclude='/.well-known/' --exclude='/.user.ini' \
  --exclude='/404.html' --exclude='/502.html' --exclude='/index.html' \
  apps/web/dist-release/ apps/web/dist/
rsync -rt --delay-updates apps/web/dist-release/index.html apps/web/dist/
support assets apps/web/dist/index.html > "$scratch/published-assets.txt"
cmp "$scratch/expected-assets.txt" "$scratch/published-assets.txt"

step='[9/10] API restart'
printf '%s\n' "$step"
support env-verify "$scratch/env.json"
support preflight
api_restart_attempted=true
support run pm2 restart afia-api --update-env
support run pm2 save

step='[10/10] Health verification'
printf '%s\n' "$step"
deadline=$((SECONDS + 45))
sleep 2
healthy=false
while (( SECONDS < deadline )); do
  remaining=$((deadline - SECONDS))
  timeout=3
  (( remaining >= timeout )) || timeout=$remaining
  if curl --silent --fail --connect-timeout 2 --max-time "$timeout" \
    http://127.0.0.1:3000/api/health -o "$scratch/local-health.json" \
    && support health "$scratch/local-health.json"; then
    healthy=true
    break
  fi
  (( SECONDS + 2 < deadline )) || break
  sleep 2
done
[[ "$healthy" == true ]] || fail 'Local API did not become healthy within 45 seconds.'
curl --silent --show-error --fail --connect-timeout 5 --max-time 15 \
  "$domain/api/health" -o "$scratch/public-health.json"
support health "$scratch/public-health.json" || fail 'Public API returned an unexpected health response.'
http_code=$(curl --silent --show-error --connect-timeout 5 --max-time 15 \
  -H 'Cache-Control: no-cache' "$domain/" -o "$scratch/live-index.html" -w '%{http_code}')
[[ "$http_code" == 200 ]] || fail "Frontend returned HTTP $http_code; expected 200."
support assets "$scratch/live-index.html" > "$scratch/live-assets.txt"
cmp "$scratch/expected-assets.txt" "$scratch/live-assets.txt" || fail 'Live JS/CSS references differ from the release.'
# Also check that each main live asset is HTTP 200 and byte-identical.
while IFS= read -r asset; do
  http_code=$(curl --silent --show-error --connect-timeout 5 --max-time 15 \
    "$domain$asset" -o "$scratch/live-asset" -w '%{http_code}')
  [[ "$http_code" == 200 ]] || fail "Live asset returned HTTP $http_code."
  cmp "apps/web/dist-release$asset" "$scratch/live-asset" || fail 'Live asset contents differ from the release.'
done < "$scratch/expected-assets.txt"
support env-verify "$scratch/env.json"
printf '\nDEPLOY SUCCESS\nDeployed commit SHA: %s\nDatabase migration status: up to date (migrate status passed)\n' "$expected_commit"
printf 'Database backup: %s\nDocuments backup: %s\nFrontend backup: %s\n' "$database_backup" "$documents_backup" "$frontend_backup"
printf 'API health: local and public OK\nFrontend health: HTTP 200; release/published/live JS and CSS match\n'
