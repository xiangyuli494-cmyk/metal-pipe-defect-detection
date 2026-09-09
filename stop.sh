#!/usr/bin/env bash
# 停止 start.sh 拉起的后端和前端进程
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

[ -f logs/backend.pid ]  && kill "$(cat logs/backend.pid)"  2>/dev/null && echo "后端已停止"
[ -f logs/frontend.pid ] && kill "$(cat logs/frontend.pid)" 2>/dev/null && echo "前端已停止"

# 兜底：根据端口杀进程
for PORT in 8002 3015; do
    PID=$(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null || true)
    [ -n "$PID" ] && kill $PID 2>/dev/null && echo "端口 $PORT 上的进程 $PID 已停止"
done

rm -f logs/backend.pid logs/frontend.pid
echo "完成"