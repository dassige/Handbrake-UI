#!/usr/bin/env bash
# Copies the project to a Docker host and (re)starts it with docker compose.
#
#   scripts/deploy.sh [ssh-alias] [remote-dir]
#
# Defaults: asus-serv-1, ~/SW/handbrake-ui. Uses ../keys/ssh_config when present.
# The remote .env is created from .env.example on the first deploy and never
# overwritten afterwards; data/ (database, logs) is kept.
set -euo pipefail

HOST="${1:-asus-serv-1}"
DIR="${2:-SW/handbrake-ui}"
cd "$(dirname "$0")/.."

SSH=(ssh)
[ -f ../keys/ssh_config ] && SSH=(ssh -F ../keys/ssh_config)

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

echo "==> Copying to $HOST:~/$DIR"
tar czf - \
  --exclude=./HandBrake --exclude=./data --exclude=./.git --exclude='*/node_modules' \
  --exclude='*/dist' --exclude=./.env --exclude=./AdvancedRenamer --exclude=./todo.txt \
  Dockerfile docker-compose.yml .dockerignore .env.example README.md server web \
  | "${SSH[@]}" "$HOST" "mkdir -p ~/$DIR && tar xzf - -C ~/$DIR"

echo "==> Building and starting"
"${SSH[@]}" "$HOST" "cd ~/$DIR && { [ -f .env ] || cp .env.example .env; } && mkdir -p data \
  && docker compose up -d --build && docker image prune -f >/dev/null && docker compose ps"
