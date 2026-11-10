#!/usr/bin/env bash
# Updates a Docker install of HandBrake Queue to what is on GitHub and rebuilds
# it. Only pushed commits are deployed, never local or uncommitted changes.
#
# On the server, in the folder you cloned:
#   scripts/deploy.sh --here
#
# From your computer, over SSH (the server pulls from GitHub itself):
#   scripts/deploy.sh <ssh-host> [remote-dir]
#
# <ssh-host> is anything ssh accepts (user@host or an alias from ~/.ssh/config).
# [remote-dir] is relative to the remote home folder (default: handbrake-ui).
# The first remote deploy clones the repository there.
#
# Environment (or put them in .deploy.env next to this repo's README, git-ignored):
#   DEPLOY_HOST, DEPLOY_DIR  defaults for <ssh-host> and [remote-dir]
#   BRANCH=main              branch to deploy
#   SSH_OPTS="-J jumphost"   extra ssh options (remote mode)
#   SSH_CONFIG=path          ssh config file to use (remote mode)
#   FORCE=1                  deploy even while a job is converting (it restarts from 0%)
#   REPO_URL                 repository to clone on first deploy
#                            (default: this checkout's origin)
#   DEPLOY_KEY               private key the server uses for GitHub, for a private
#                            repository or fork (default ~/.ssh/handbrake-ui-deploy,
#                            used only when it exists). A public repository needs none.
#
# The server's .env is created from .env.example once and never overwritten;
# data/ (database, logs, backups) is kept: both are git-ignored.
set -euo pipefail

# ------------------------------------------------------------------ on the server
# Runs inside the install folder. Args: branch, commit to deploy (empty = latest).
update_here() {
  local branch=$1 target=${2:-}
  local key=${DEPLOY_KEY:-$HOME/.ssh/handbrake-ui-deploy}

  [ -d .git ] || { echo "$PWD is not a git checkout" >&2; exit 1; }
  command -v docker >/dev/null || { echo "docker is not installed on $(hostname)" >&2; exit 1; }

  # Restarting the container stops a running encode (it is re-queued from 0%).
  if [ "${FORCE:-0}" != "1" ] && command -v curl >/dev/null; then
    local port active
    port=$(grep -s '^PORT=' .env | cut -d= -f2 || true)
    active=$(curl -s --max-time 5 "http://127.0.0.1:${port:-8095}/api/info" \
      | grep -o '"activeJobId":[0-9]*' | cut -d: -f2 || true)
    if [ -n "$active" ]; then
      echo "Job $active is converting right now; deploying would restart it from 0%." >&2
      echo "Wait for it to finish (or stop the queue), or run again with FORCE=1." >&2
      exit 1
    fi
  fi

  # A deploy key is only needed for an SSH remote (private repository or fork).
  if [ -f "$key" ] && git remote get-url origin | grep -q '^git@\|^ssh://'; then
    git config core.sshCommand "ssh -i $key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"
  fi

  echo "==> Fetching $branch"
  git fetch -q origin "+refs/heads/$branch:refs/remotes/origin/$branch"
  target=${target:-$(git rev-parse "origin/$branch")}
  git cat-file -e "$target^{commit}" 2>/dev/null || { echo "Commit $target is not on GitHub's $branch" >&2; exit 1; }
  if [ "$(git rev-parse HEAD 2>/dev/null)" = "$(git rev-parse "$target")" ]; then
    echo "==> Already at $(git log -1 --format='%h %s'); rebuilding anyway"
  fi
  git checkout -q -f -B "$branch" "$target"
  git branch -q --set-upstream-to="origin/$branch" "$branch"
  echo "==> Checked out $(git log -1 --format='%h %s')"

  echo "==> Building and starting"
  if [ ! -f .env ]; then
    cp .env.example .env
    echo "==> Created .env from .env.example: check it, then run this script again" >&2
    exit 1
  fi
  mkdir -p data
  docker compose up -d --build
  docker image prune -f >/dev/null
  docker compose ps
}

# Remote half of a deploy from another machine: clone on first use, then update.
if [ "${1:-}" = "--remote-step" ]; then
  shift
  DIR=$1 BRANCH=$2 TARGET=$3 REPO_URL=$4
  if [ ! -d ~/"$DIR"/.git ]; then
    key=${DEPLOY_KEY:-$HOME/.ssh/handbrake-ui-deploy}
    echo "==> First deploy: cloning $REPO_URL into ~/$DIR"
    mkdir -p ~/"$DIR" && cd ~/"$DIR"
    git init -q
    git remote add origin "$REPO_URL"
    if [ -f "$key" ] && echo "$REPO_URL" | grep -q '^git@\|^ssh://'; then
      git config core.sshCommand "ssh -i $key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"
    fi
  fi
  cd ~/"$DIR"
  update_here "$BRANCH" "$TARGET"
  exit 0
fi

cd "$(dirname "$0")/.."
[ -f .deploy.env ] && . ./.deploy.env
BRANCH="${BRANCH:-main}"

if [ "${1:-}" = "--here" ]; then
  update_here "$BRANCH" ""
  exit 0
fi

# ------------------------------------------------------------------ from another machine
HOST="${1:-${DEPLOY_HOST:-}}"
DIR="${2:-${DEPLOY_DIR:-handbrake-ui}}"
if [ -z "$HOST" ] || [ "${HOST#-}" != "$HOST" ]; then
  sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 1
fi
REPO_URL="${REPO_URL:-$(git remote get-url origin)}"

SSH=(ssh)
if [ -n "${SSH_CONFIG:-}" ]; then SSH+=(-F "$SSH_CONFIG"); fi
if [ -n "${SSH_OPTS:-}" ]; then
  read -r -a EXTRA <<< "$SSH_OPTS"
  SSH+=("${EXTRA[@]}")
fi

git fetch -q origin "$BRANCH"
TARGET=$(git rev-parse "origin/$BRANCH")
if [ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] && [ -n "$(git rev-list "origin/$BRANCH..HEAD")" ]; then
  echo "Your local $BRANCH has commits that are not on GitHub:" >&2
  git log --oneline "origin/$BRANCH..HEAD" >&2
  echo "Push them first (the server deploys origin/$BRANCH)." >&2
  exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Note: you have uncommitted changes; they are NOT deployed." >&2
fi
echo "==> Deploying origin/$BRANCH to $HOST:~/$DIR: $(git log -1 --format='%h %s (%cr)' "$TARGET")"

"${SSH[@]}" "$HOST" "FORCE=${FORCE:-0} DEPLOY_KEY=${DEPLOY_KEY:-} bash -s -- --remote-step '$DIR' '$BRANCH' '$TARGET' '$REPO_URL'" < "$0"
