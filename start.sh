#!/usr/bin/env bash
# ==========================================================
# 金属细管内壁缺陷检测系统 - Linux/macOS 一键启动
# ==========================================================
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# 颜色
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail()  { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

echo "============================================="
echo " 金属细管内壁缺陷检测系统  一键启动"
echo "============================================="

# ---------- 0. 自检 ----------
info "[0/5] 环境自检"
command_exists python3 || fail "未安装 python3，请先安装 Python 3.8+"
command_exists node    || fail "未安装 node，请先安装 Node 18+"
command_exists pnpm    || { warn "未安装 pnpm，正在安装..."; npm install -g pnpm; }
command_exists mysql   || warn "未找到 mysql CLI，数据库初始化请手动执行"

# ---------- 1. MySQL ----------
info "[1/5] 检查 MySQL 服务"
if command_exists systemctl; then
    systemctl is-active --quiet mysql 2>/dev/null || systemctl is-active --quiet mysqld 2>/dev/null \
        || warn "MySQL 服务未运行，请手动启动"
else
    warn "非 systemd 系统，请手动确认 MySQL 已启动"
fi
ok "MySQL 检查完成"

# ---------- 2. 初始化数据库 ----------
info "[2/5] 初始化数据库（仅首次）"
if [ -f sql/init.sql ] && [ ! -f sql/.dbinit.done ]; then
    if command_exists mysql; then
        mysql -uroot -p123456 < sql/init.sql && ok "数据库初始化完成" && touch sql/.dbinit.done || warn "数据库初始化失败，请手动执行: mysql -uroot -p < sql/init.sql"
    fi
else
    ok "数据库已初始化或无需初始化"
fi

# ---------- 3. 后端 ----------
info "[3/5] 启动后端 :8002"
cd backend
[ -d venv ] || python3 -m venv venv
# shellcheck disable=SC1091
source venv/bin/activate
info "安装/更新 Python 依赖..."
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple --quiet

[ -f .env ] || cp .env.example .env

mkdir -p models
[ -f models/best.pt ] || [ -f ../models_weights/best.pt ] && cp -n ../models_weights/best.pt models/best.pt 2>/dev/null || true
[ -f models/classes.txt ] || [ -f ../models_weights/classes.txt ] && cp -n ../models_weights/classes.txt models/classes.txt 2>/dev/null || true

cd "$ROOT"

if lsof -iTCP:8002 -sTCP:LISTEN >/dev/null 2>&1; then
    ok "后端 :8002 已在运行"
else
    nohup bash -c "cd '$ROOT/backend' && source venv/bin/activate && python -m uvicorn api.main:app --host 0.0.0.0 --port 8002" \
        > logs/backend.log 2>&1 &
    echo $! > logs/backend.pid
    ok "后端已后台启动，PID=$(cat logs/backend.pid)"
fi

# ---------- 4. 前端 ----------
info "[4/5] 启动前端 :3015"
cd frontend
[ -d node_modules ] || pnpm install
cd "$ROOT"

if lsof -iTCP:3015 -sTCP:LISTEN >/dev/null 2>&1; then
    ok "前端 :3015 已在运行"
else
    nohup bash -c "cd '$ROOT/frontend' && pnpm run dev" > logs/frontend.log 2>&1 &
    echo $! > logs/frontend.pid
    ok "前端已后台启动，PID=$(cat logs/frontend.pid)"
fi

# ---------- 5. 收尾 ----------
mkdir -p logs
echo
echo "============================================="
ok "启动完成！"
echo "  前端: http://localhost:3015"
echo "  后端: http://localhost:8002"
echo "  文档: http://localhost:8002/docs"
echo "  账号: admin / admin123"
echo "  日志: logs/backend.log  logs/frontend.log"
echo "  停止: ./stop.sh"
echo "============================================="
sleep 2
if command_exists xdg-open; then xdg-open http://localhost:3015; fi
if command_exists open;   then open   http://localhost:3015; fi