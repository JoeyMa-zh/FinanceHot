#!/bin/bash
# 本机一键启动：先确保 Postgres 在跑，再起 api（3001）、worker、web（3000）。日志在 .run/ 下。
# 用法：./start.sh [stop]
cd "$(dirname "$0")"

mkdir -p .run
PG="/opt/homebrew/opt/postgresql@17/bin"
if ! "$PG/pg_isready" -h 127.0.0.1 -p 5432 -q; then
  echo "启动本地 PostgreSQL…"
  "$PG/pg_ctl" -D "$HOME/.aihot-test-pgdata" -o "-p 5432 -k /tmp" -l /tmp/aihot-pg.log start
  sleep 1
fi

if [ "$1" = "stop" ]; then
  for f in .run/*.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null && rm "$f"; done
  echo "已停止 api / worker / web（数据库保持运行）"
  exit 0
fi

if curl -s -m 2 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
  echo "已在运行：http://127.0.0.1:3000"
  exit 0
fi

nohup node --env-file=.env apps/api/src/main.ts    > .run/api.log    2>&1 & echo $! > .run/api.pid
nohup node --env-file=.env apps/worker/src/main.ts > .run/worker.log 2>&1 & echo $! > .run/worker.pid
nohup env WEB_HOST=0.0.0.0 API_BASE_URL=http://127.0.0.1:3001 node --env-file=.env apps/web/server.ts > .run/web.log 2>&1 & echo $! > .run/web.pid
sleep 4
curl -s -m 5 http://127.0.0.1:3000/api/health >/dev/null && echo "已启动：http://127.0.0.1:3000 （后台：http://127.0.0.1:3000/admin，密码在 .env 的 ADMIN_PASSWORD）" \
  || { echo "启动失败，看日志：.run/api.log .run/web.log"; exit 1; }
echo "停止：./start.sh stop ；日志：tail -f .run/worker.log"
