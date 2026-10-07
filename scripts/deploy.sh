#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/greefon-admin-stage-one-ai}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BRANCH="${DEPLOY_BRANCH:-main}"

cd "$APP_DIR"

if [[ ! -f .env ]]; then
  echo "ERROR: $APP_DIR/.env отсутствует. Создай вручную до деплоя." >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "ERROR: нет $COMPOSE_FILE в $APP_DIR" >&2
  exit 1
fi

echo "==> git fetch/reset $BRANCH"
git fetch --prune origin
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> docker compose build/up ($COMPOSE_FILE)"
docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans

echo "==> health"
ok=0
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:3890/health" >/tmp/greefon-health.json 2>/dev/null; then
    cat /tmp/greefon-health.json
    echo
    ok=1
    break
  fi
  echo "waiting health ($i/30)..."
  sleep 2
done
if [[ "$ok" -ne 1 ]]; then
  echo "ERROR: health check failed, последние логи api:" >&2
  docker compose -f "$COMPOSE_FILE" logs --tail=80 api >&2 || true
  exit 1
fi
echo "==> ok"
docker compose -f "$COMPOSE_FILE" ps
