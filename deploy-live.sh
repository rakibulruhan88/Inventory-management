#!/usr/bin/env bash
set -Eeuo pipefail
set +x

# Run from the checkout containing this script; never upload local data or .env.
step='[1/10] Local preflight'
trap 'code=$?; printf "DEPLOY FAILED: %s (exit %s)\n" "$step" "$code" >&2; exit "$code"' ERR
printf '%s\n' "$step"
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
for tool in git ssh; do command -v "$tool" >/dev/null; done
[[ "$(git branch --show-current)" == invoice-import ]] || { echo 'Expected branch invoice-import.' >&2; exit 1; }
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || {
  echo 'Commit all intended changes and resolve remaining local edits before deploying.' >&2
  git status --short
  exit 1
}
commit=$(git rev-parse --verify HEAD)
[[ "$commit" =~ ^[0-9a-f]{40}$ ]]
[[ -f package-lock.json && -f scripts/deploy-live-remote.sh && -f scripts/deploy-live-support.cjs ]]

step='[2/10] Push'
printf '%s\n' "$step"
git push origin HEAD:refs/heads/invoice-import
remote_commit=$(git ls-remote --exit-code origin refs/heads/invoice-import)
[[ "${remote_commit%%[[:space:]]*}" == "$commit" ]] || { echo 'Origin does not match the requested commit.' >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$commit" && -z "$(git status --porcelain --untracked-files=all)" ]]

step='Production deployment (see remote failed step below)'
# Send only the deployment runner over authenticated SSH, then pull committed code.
# A private temporary helper allows backup/preflight before the VPS checkout updates.
{
  cat <<'BOOTSTRAP'
set -Eeuo pipefail
set +x
umask 077
support_file=$(mktemp /tmp/afia-deploy-support.XXXXXXXX.cjs)
trap 'rm -f -- "$support_file"' EXIT
cat > "$support_file" <<'AFIA_DEPLOY_NODE_SUPPORT'
BOOTSTRAP
  cat scripts/deploy-live-support.cjs
  printf '\nAFIA_DEPLOY_NODE_SUPPORT\n'
  cat scripts/deploy-live-remote.sh
} | ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 \
  ubuntu@158.69.49.65 "bash -s -- '$commit'"
