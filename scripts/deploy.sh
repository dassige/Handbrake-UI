#!/usr/bin/env bash
# Deploys what is on GitHub to a Docker host: the host fetches the branch with
# its own read-only deploy key, checks out the exact commit chosen here, and
# rebuilds with docker compose. Local, uncommitted or unpushed changes are never
# deployed.
#
#   scripts/deploy.sh [ssh-alias] [remote-dir]
#
# Defaults: asus-serv-1, ~/SW/handbrake-ui. Uses ../keys/ssh_config when present.
# Environment:
#   BRANCH=main          branch to deploy
#   SSH_OPTS="-J rasp-web"  extra ssh options, e.g. a jump host from outside the LAN
#   FORCE=1              deploy even while a job is converting (it restarts from 0%)
#   REPO_URL, DEPLOY_KEY repository and key path on the host
#     (default git@github.com:dassige/Handbrake-UI.git, ~/.ssh/handbrake-ui-deploy)
#
# The host needs git and the deploy key (read-only, added in GitHub → Settings →
# Deploy keys). The first run turns an existing copied folder into a checkout in
# place. The remote .env is created from .env.example once and never overwritten;
# data/ (database, logs, backups) is kept: both are in .gitignore.
set -euo pipefail

HOST="${1:-asus-serv-1}"
DIR="${2:-SW/handbrake-ui}"
BRANCH="${BRANCH:-main}"
REPO_URL="${REPO_URL:-git@github.com:dassige/Handbrake-UI.git}"
DEPLOY_KEY="${DEPLOY_KEY:-}"
cd "$(dirname "$0")/.."

SSH=(ssh)
[ -f ../keys/ssh_config ] && SSH=(ssh -F ../keys/ssh_config)
if [ -n "${SSH_OPTS:-}" ]; then
  read -r -a EXTRA <<< "$SSH_OPTS"
  SSH+=("${EXTRA[@]}")
fi

# ---------------------------------------------------------------- what to deploy
git fetch -q origin "$BRANCH"
TARGET=$(git rev-parse "origin/$BRANCH")
if [ -n "$(git rev-list "origin/$BRANCH..HEAD" 2>/dev/null)" ] && [ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ]; then
  echo "Your local $BRANCH has commits that are not on GitHub:" >&2
  git log --oneline "origin/$BRANCH..HEAD" >&2
  echo "Push them first (the server deploys origin/$BRANCH)." >&2
  exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Note: you have uncommitted changes; they are NOT deployed." >&2
fi
echo "==> Deploying origin/$BRANCH: $(git log -1 --format='%h %s (%cr)' "$TARGET")"

# ---------------------------------------------------------------- safety
# Restarting the container stops a running encode (it is re-queued from 0%).
if [ "${FORCE:-0}" != "1" ]; then
  ACTIVE=$("${SSH[@]}" "$HOST" "cd ~/$DIR 2>/dev/null && port=\$(grep -s '^PORT=' .env | cut -d= -f2); \
    curl -s --max-time 5 http://127.0.0.1:\${port:-8095}/api/info | grep -o '\"activeJobId\":[0-9]*' | cut -d: -f2" || true)
  if [ -n "$ACTIVE" ]; then
    echo "Job $ACTIVE is converting right now; deploying would restart it from 0%." >&2
    echo "Wait for it to finish (or pause the queue), or run again with FORCE=1." >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------- on the host
"${SSH[@]}" "$HOST" bash -s -- "$DIR" "$BRANCH" "$TARGET" "$REPO_URL" "$DEPLOY_KEY" <<'REMOTE'
set -euo pipefail
DIR=$1 BRANCH=$2 TARGET=$3 REPO_URL=$4 KEY=${5:-$HOME/.ssh/handbrake-ui-deploy}
[ -f "$KEY" ] || { echo "Deploy key $KEY not found on $(hostname)" >&2; exit 1; }
mkdir -p ~/"$DIR" && cd ~/"$DIR"

if [ ! -d .git ]; then
  echo "==> First git deploy: turning $PWD into a checkout"
  git init -q
  git remote add origin "$REPO_URL"
fi
git remote set-url origin "$REPO_URL"
# The deploy key is used for this repository only.
git config core.sshCommand "ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"

echo "==> Fetching $BRANCH"
git fetch -q origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
git cat-file -e "$TARGET^{commit}" 2>/dev/null || { echo "Commit $TARGET is not on GitHub's $BRANCH" >&2; exit 1; }
git checkout -q -f -B "$BRANCH" "$TARGET"
echo "==> Checked out $(git log -1 --format='%h %s')"

echo "==> Building and starting"
[ -f .env ] || cp .env.example .env
mkdir -p data
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps
REMOTE
