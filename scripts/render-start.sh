#!/bin/bash
# Render 单服务（免费档）启动：迁移 → 种子 → 同容器内起 api/worker/web 三个进程。
# api 只绑容器内 localhost，公网只暴露 web 的 $PORT。
set -e

node scripts/migrate.ts
node scripts/seed.ts

API_HOST=127.0.0.1 API_PORT=3001 node apps/api/src/main.ts &
node apps/worker/src/main.ts &
exec env WEB_HOST=0.0.0.0 WEB_PORT=$PORT API_BASE_URL=http://127.0.0.1:3001 TRUST_PROXY=true node apps/web/server.ts
