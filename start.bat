@echo off
chcp 65001 >nul
setlocal ENABLEDELAYEDEXPANSION
title 金属细管内壁缺陷检测系统 - 一键启动

echo ============================================
echo    金属细管内壁缺陷检测系统  一键启动
echo    Metal Pipe Defect Detection - Boot
echo ============================================
echo.

cd /d "%~dp0"

REM ---- 0. Python / Node / MySQL 自检 ----
echo [0/5] 环境自检...

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo    [ERROR] 未检测到 Python，请先安装 Python 3.8+
    pause & exit /b 1
)
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo    [ERROR] 未检测到 Node.js，请先安装 Node 18+
    pause & exit /b 1
)
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo    [WARN] 未检测到 pnpm，正在通过 npm 安装...
    call npm install -g pnpm
)
echo    环境检查通过

REM ---- 1. MySQL ----
echo.
echo [1/5] 检查 MySQL 服务...
set MYSQL_OK=0
for %%S in (MySQL80 MySQL MySQL57) do (
    sc query %%S 2>nul | findstr /i "RUNNING" >nul && (
        echo    MySQL(%%S) 已运行 && set MYSQL_OK=1
    )
)
if !MYSQL_OK!==0 (
    echo    [WARN] MySQL 未运行，尝试启动 MySQL80...
    net start MySQL80 >nul 2>&1
)

REM ---- 2. 初始化数据库（首次启动） ----
echo.
echo [2/5] 初始化数据库（仅首次）...
if exist "sql\init.sql" (
    if not exist "sql\.dbinit.done" (
        echo    正在导入 sql\init.sql ...
        for /f "tokens=*" %%P in ('where mysql ^| findstr /i mysql.exe') do set MYSQL_BIN=%%P
        if defined MYSQL_BIN (
            "%MYSQL_BIN%" -uroot -p123456 < sql\init.sql >nul 2>&1
            if !errorlevel!==0 (
                echo    数据库初始化完成 && type nul > sql\.dbinit.done
            ) else (
                echo    [WARN] 数据库初始化失败，请手动执行: mysql -uroot -p ^< sql\init.sql
            )
        ) else (
            echo    [WARN] 未找到 mysql.exe，跳过自动初始化
        )
    ) else (
        echo    数据库已初始化过，跳过
    )
)

REM ---- 3. 后端依赖 + 启动 ----
echo.
echo [3/5] 启动后端 :8002 ...
cd backend
if not exist "venv\Scripts\python.exe" (
    echo    创建 Python 虚拟环境...
    python -m venv venv || (echo    [ERROR] venv 创建失败 & pause & exit /b 1)
)
call venv\Scripts\activate.bat
echo    安装/更新 Python 依赖...
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple --quiet
if not exist ".env" (
    copy .env.example .env >nul
    powershell -NoProfile -Command "(Get-Content .env -Raw -Encoding UTF8) -replace '请改成你的密码','123456' | Set-Content .env -Encoding UTF8 -NoNewline"
    echo    已生成 backend\.env（默认 MySQL 密码 123456，与初始化脚本一致）
)
REM 模型权重放到 models\
if not exist "models\best.pt" if exist "..\models_weights\best.pt" (
    if not exist "models" mkdir models
    copy /Y "..\models_weights\best.pt" "models\best.pt" >nul
    copy /Y "..\models_weights\classes.txt" "models\classes.txt" >nul
    echo    已部署默认模型权重
)
cd ..

netstat -ano | findstr ":8002.*LISTENING" >nul
if %errorlevel%==0 (
    echo    后端已在运行
) else (
    start "后端 FastAPI :8002" /d "%~dp0backend" cmd /k "chcp 65001 >nul && set PYTHONUTF8=1 && venv\Scripts\python.exe -m uvicorn api.main:app --host 0.0.0.0 --port 8002"
    echo    后端启动中...
)

REM ---- 4. 前端依赖 + 启动 ----
echo.
echo [4/5] 启动前端 :3015 ...
cd frontend
if not exist "node_modules" (
    echo    安装前端依赖（约 1-2 分钟）...
    call pnpm install
)
cd ..

netstat -ano | findstr ":3015.*LISTENING" >nul
if %errorlevel%==0 (
    echo    前端已在运行
) else (
    start "前端 React :3015" /d "%~dp0frontend" cmd /k "pnpm run dev"
    echo    前端启动中...
)

REM ---- 5. 提示 ----
echo.
echo [5/5] 启动完成
echo    前端地址:  http://localhost:3015
echo    后端地址:  http://localhost:8002
echo    API 文档:  http://localhost:8002/docs
echo    默认账号:  admin / admin123
echo.
echo    关闭方式:  关掉弹出的两个黑色窗口
echo ============================================
echo.
timeout /t 5 >nul
start "" "http://localhost:3015"
pause