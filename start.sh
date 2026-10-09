#!/bin/bash
# 本机一键启动：先确保 Postgres 在跑，再起 api（3001）、worker、web（3000）。日志在 .run/ 下。
# 用法：./start.sh [stop]
cd "$(dirname "$0")"
DIR="$(pwd -P)"

mkdir -p .run
PG="/opt/homebrew/opt/postgresql@17/bin"
if ! "$PG/pg_isready" -h 127.0.0.1 -p 5432 -q; then
  echo "启动本地 PostgreSQL…"
  "$PG/pg_ctl" -D "$HOME/.aihot-test-pgdata" -o "-p 5432 -k /tmp" -l /tmp/aihot-pg.log start
  sleep 1
fi

# 三个服务用绝对路径启动，stop 才能按“本仓库的命令行”精确清掉没记进 pid 文件的残留，不误伤别的项目
API="$DIR/apps/api/src/main.ts"
WORKER="$DIR/apps/worker/src/main.ts"
WEB="$DIR/apps/web/server.ts"

stop_services() {
  for f in .run/*.pid; do [ -f "$f" ] && { kill "$(cat "$f")" 2>/dev/null; rm -f "$f"; }; done
  for s in "$API" "$WORKER" "$WEB"; do pkill -f "$s" 2>/dev/null; done
}

# 只看监听者：访客浏览器、反向探活的连接不算占用
ports_busy() { [ -n "$(lsof -ti :3000 -sTCP:LISTEN; lsof -ti :3001 -sTCP:LISTEN)" ]; }

if [ "$1" = "stop" ]; then
  stop_services
  for i in 1 2 3 4 5 6 7 8 9 10; do ports_busy || break; sleep 0.5; done
  if ports_busy; then
    echo "注意：3000/3001 仍被别的进程监听着（PID：$(lsof -ti :3000 -sTCP:LISTEN; lsof -ti :3001 -sTCP:LISTEN | tr '\n' ' ')），确认后自行处理"
  else
    echo "已停止 api / worker / web（数据库保持运行）"
  fi
  exit 0
fi

if curl -s -m 2 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
  echo "已在运行：http://127.0.0.1:3000"
  exit 0
fi

# 上次崩掉后留下的孤儿进程（比如 api 崩了 worker 还活着会双跑采集），先清掉再起
stop_services
sleep 1
if ports_busy; then
  echo "3000/3001 被别的进程监听，先处理再启动："
  lsof -i :3000 -i :3001 -sTCP:LISTEN
  exit 1
fi

nohup node --env-file=.env "$API"    > .run/api.log    2>&1 & echo $! > .run/api.pid
nohup node --env-file=.env "$WORKER" > .run/worker.log 2>&1 & echo $! > .run/worker.pid
nohup env WEB_HOST=0.0.0.0 API_BASE_URL=http://127.0.0.1:3001 node --env-file=.env "$WEB" > .run/web.log 2>&1 & echo $! > .run/web.pid
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -s -m 2 http://127.0.0.1:3000/api/health >/dev/null 2>&1 && break
  sleep 1
done
curl -s -m 5 http://127.0.0.1:3000/api/health >/dev/null && echo "已启动：http://127.0.0.1:3000 （后台：http://127.0.0.1:3000/admin，密码在 .env 的 ADMIN_PASSWORD）" \
  || { echo "启动失败，看日志：.run/api.log .run/web.log"; exit 1; }
echo "停止：./start.sh stop ；日志：tail -f .run/worker.log"
