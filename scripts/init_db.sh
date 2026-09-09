#!/usr/bin/env bash
# 数据库一键初始化：mysql -uroot -p < sql/init.sql 的封装
set -e
DB_NAME=${DB_NAME:-metal_defect_detection}
MYSQL_USER=${MYSQL_USER:-root}

if ! command -v mysql >/dev/null 2>&1; then
    echo "[ERROR] 未找到 mysql 命令行客户端"; exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$SCRIPT_DIR/../sql/init.sql"

[ -f "$SQL_FILE" ] || { echo "[ERROR] 未找到 $SQL_FILE"; exit 1; }

echo "==> 即将初始化数据库 $DB_NAME"
read -s -p "请输入 MySQL 密码: " MYSQL_PWD; echo
mysql -u"$MYSQL_USER" -p"$MYSQL_PWD" < "$SQL_FILE"
echo "==> 完成"