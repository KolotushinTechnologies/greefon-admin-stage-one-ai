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
sleep 3
curl -fsS "http://127.0.0.1:3890/health" || {
  echo "WARN: health check failed, последние логи api:" >&2
  docker compose -f "$COMPOSE_FILE" logs --tail=40 api >&2 || true
  exit 1
}
echo
echo "==> ok"
docker compose -f "$COMPOSE_FILE" ps
