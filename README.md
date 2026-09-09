# 金属细管内壁缺陷检测系统

> 基于 YOLO 深度学习的金属细管内壁缺陷智能检测系统 · 单张/批量/摄像头/视频四种检测模式 · 内置 RBAC · 数据可视化

![status](https://img.shields.io/badge/status-stable-brightgreen)
![python](https://img.shields.io/badge/python-3.8%2B-blue)
![node](https://img.shields.io/badge/node-18%2B-green)
![license](https://img.shields.io/badge/license-MIT-lightgrey)

本项目针对金属细管（管径 4–20mm）内壁微缺陷（凸起、焊缝、划痕、腐蚀等）难以肉眼/普通相机观察的痛点，提出"内窥镜图像采集 + YOLO 目标检测 + Web 可视化"的一体化方案。前端 React + TypeScript，后端 Python FastAPI，AI 推理基于 Ultralytics YOLO，数据库默认 MySQL，可一键切换至 Supabase。

---

## 目录

- [项目亮点](#项目亮点)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
  - [环境要求](#环境要求)
  - [一键启动（Windows）](#一键启动windows)
  - [一键启动（Linux/macOS）](#一键启动linuxmacos)
  - [手动启动](#手动启动)
- [数据库初始化](#数据库初始化)
- [模型权重说明](#模型权重说明)
- [默认账号](#默认账号)
- [核心功能](#核心功能)
- [API 速览](#api-速览)
- [测试](#测试)
- [部署](#部署)
- [常见问题 FAQ](#常见问题-faq)
- [致谢与许可证](#致谢与许可证)

---

## 项目亮点

- **多模态检测**：单张图片 / 批量图片 / 摄像头实时 / 视频文件 四种模式同一套后端。
- **工业级 AI 推理**：默认 `best.pt` 自训练权重（凸起、焊缝 2 类），支持任意 YOLO `.pt` / `.onnx` / `.pb` 热切换。
- **完整 RBAC**：`admin` / `operator` / `viewer` 三级权限 + JWT access/refresh 双 Token。
- **数据可视化**：Recharts 实时绘制每日统计、缺陷分布、模型准确率曲线。
- **可扩展存储**：本地 MySQL 与 Supabase 云数据库自动切换（仅改 `.env`）。
- **离线即可跑**：所有依赖本地，不依赖外网 API。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 18 + TypeScript + React Router v6 |
| 构建工具 | Webpack 5 + Babel 7 |
| 样式方案 | Tailwind CSS + CSS 变量 + Framer Motion |
| 图表库 | Recharts |
| 后端框架 | Python FastAPI + Uvicorn |
| AI 推理 | Ultralytics YOLO (YOLOv11 / YOLO26) + PyTorch |
| 数据库 | MySQL 8.x (默认) / PostgreSQL (Supabase) |
| 鉴权 | JWT (python-jose) + bcrypt 密码哈希 |

---

## 项目结构

```
metal-pipe-defect-detection/
├── README.md                 # 你正在看的总览
├── start.bat                 # Windows 一键启动
├── start.sh                  # Linux / macOS 一键启动
├── LICENSE
├── .gitignore
│
├── backend/                  # Python 后端（FastAPI）
│   ├── api/
│   │   ├── main.py           # 主入口：所有 HTTP 路由
│   │   ├── auth.py           # JWT + RBAC
│   │   └── video.py          # 视频检测路由
│   ├── services/
│   │   ├── model_service.py  # 加载/推理 YOLO 等模型
│   │   ├── detection_service.py
│   │   ├── database_service.py
│   │   ├── camera_service.py
│   │   └── video_detector.py
│   ├── config/database.py    # MySQL/Supabase 自动切换
│   ├── classes.txt           # 缺陷类别（默认：凸起、焊缝）
│   ├── requirements.txt
│   └── .env.example          # 环境变量模板
│
├── frontend/                 # React 前端
│   ├── src/
│   │   ├── App.tsx           # 路由根
│   │   ├── index.tsx
│   │   ├── pages/            # Login/Single/Batch/Camera/History/Statistics/Profile/Users/Settings
│   │   ├── components/Layout.tsx
│   │   ├── contexts/AuthContext.tsx
│   │   └── services/
│   │       ├── ApiService.ts
│   │       ├── LocalStorageService.ts
│   │       └── VideoDetectionService.ts
│   ├── public/
│   ├── package.json
│   ├── webpack.config.js
│   ├── tsconfig.json
│   ├── tailwind.config.js
│   └── postcss.config.js
│
├── sql/
│   ├── mysql_schema.sql      # MySQL 库表结构（幂等）
│   └── init.sql              # 同上 + 默认用户种子（密码已 bcrypt 哈希）
│
├── models_weights/
│   ├── best.pt               # 自训练 YOLO 权重（凸起 / 焊缝）
│   ├── classes.txt           # 类别文件
│   ├── README.md             # 模型说明 + 下载链接（如有）
│   └── yolo26n.pt            # YOLO26 预训练（可选，用于再训练）
│
├── scripts/
│   ├── init_db.sh            # 数据库初始化
│   ├── reset_mysql_pwd.ps1   # Windows 重置 MySQL 密码
│   └── nginx.conf.example    # 生产环境 Nginx 反向代理示例
│
├── tests/
│   ├── smoke_test_api.py     # 登录 → 加载模型 → 单张预测 冒烟测试
│   ├── test_video_detect.py  # 视频检测 API 测试
│   ├── train_yolo26.py       # YOLO26 训练脚本（参考）
│   ├── train_yolov11.py      # YOLOv11 训练脚本（参考）
│   ├── yolo数据集格式转化.py     # Labelme JSON → YOLO txt
│   ├── 批量图片处理流水线.py     # 图像预处理（顶帽变换 + 圆形掩码）
│   └── 文件夹图片批量处理.py     # 文件夹级批量处理
│
└── docs/
    ├── 应用方案.pdf          # 完整应用方案（背景/痛点/方案/功能/前景）
    ├── 用户操作手册.md       # 详细使用说明
    ├── 视频旁白脚本.md       # 演示视频旁白
    └── 架构图.png            # 系统架构图（如有）
```

---

## 快速开始

### 环境要求

| 组件 | 版本要求 | 备注 |
|---|---|---|
| Python | ≥ 3.8 | 推荐 3.10 |
| Node.js | ≥ 18 | 推荐 20 LTS |
| pnpm | ≥ 8 | 或 `npm i -g pnpm` |
| MySQL | ≥ 5.7 | 推荐 8.0 |
| 显存 | ≥ 4 GB | 仅训练需要；推理 CPU 即可 |

### 一键启动（Windows）

```cmd
:: 双击或右键以管理员身份运行
start.bat
```

脚本会自动：① 检查 MySQL 服务；② 创建 venv 装依赖；③ 执行 `sql/init.sql` 初始化库表；④ 拉起后端 `:8002`；⑤ 拉起前端 `:3015`。

启动后浏览器访问 `http://localhost:3015`，账号 `admin / admin123`。

### 一键启动（Linux/macOS）

```bash
chmod +x start.sh
./start.sh
```

启动后浏览器访问 `http://localhost:3015`。

### 手动启动

如果你想完全掌控每一步：

```bash
# 1) 后端
cd backend
python -m venv venv
# Windows: venv\Scripts\activate   | macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # 编辑数据库密码与模型路径
python -m uvicorn api.main:app --host 0.0.0.0 --port 8002 --reload

# 2) 前端（新开一个终端）
cd frontend
pnpm install
pnpm run dev                # 默认 :3015
```

---

## 数据库初始化

`sql/init.sql` 会在不存在时创建库 `metal_defect_detection` 与 12 张表，并插入 3 个默认账号：

| 用户名 | 密码 | 角色 |
|---|---|---|
| admin | admin123 | admin |
| operator | operator123 | operator |
| viewer | viewer123 | viewer |

执行命令：

```bash
# Linux/macOS
mysql -uroot -p < sql/init.sql

# Windows（PowerShell）
Get-Content sql/init.sql | mysql -uroot -p
```

完成后在 `backend/.env` 中设置：

```env
DB_TYPE=mysql
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_DATABASE=metal_defect_detection
MYSQL_USER=root
MYSQL_PASSWORD=你的密码
```

---

## 模型权重说明

`models_weights/best.pt` 是已经训练好的 2 类缺陷权重：

```
凸起   焊缝
```

直接放到 `backend/models/best.pt`，或在 `.env` 中指定 `MODEL_PATH` 指向任意 `.pt` 文件。

如需重新训练：

```bash
cd tests
python train_yolo26.py        # 编辑 data=... 为你的数据集 yaml
```

数据集组织方式（YOLO 标准）：

```
final_dataset/
├── images/train/  *.jpg|*.png|*.bmp
├── images/val/    *.jpg|*.png|*.bmp
├── labels/train/  *.txt    # class x y w h (归一化)
├── labels/val/    *.txt
└── data.yaml
```

---

## 默认账号

| 用户名 | 密码 | 角色 |
|---|---|---|
| admin | admin123 | 管理员（全部权限） |
| operator | operator123 | 操作员（可执行检测） |
| viewer | viewer123 | 查看员（仅查看历史统计） |

> ⚠️ 部署到生产前请 `UPDATE users SET password_hash=...` 修改默认密码。

---

## 核心功能

### 1. 单张图片检测

上传 1 张内窥镜截图，AI 自动框出缺陷位置、类别、置信度，结果图直接叠加到原图上。

### 2. 批量图片检测

选择文件夹或拖拽多张图片，后台并发推理，进度条实时刷新，完成后可一键导出 CSV / JSON 报告。

### 3. 摄像头实时检测

支持 USB 内窥镜 / 工业相机接入，前端显示视频流叠加检测框，可设置告警阈值自动保存可疑帧。

### 4. 视频文件检测

上传 mp4/avi/mov，按可配置帧间隔抽帧检测，输出含检测时间戳的 JSON + 可视化视频。

### 5. 历史记录管理

时间区间、检测类型、用户多条件筛选；记录详情可重新查看原图 + 结果图 + 缺陷列表。

### 6. 数据统计分析

Recharts 折线图展示每日检测量、饼图展示缺陷类别分布，管理员可下钻到操作员维度。

### 7. 用户与权限管理

`admin` 可新建/禁用/重置密码、修改角色；操作日志自动写入 `operation_logs`。

### 8. 模型管理

Web 端上传 `.pt`/`.onnx`/`.pb`，热切换激活模型；可重命名、删除、编辑类别名。

### 9. AI 在系统中的核心作用

| 模块 | AI 作用 |
|---|---|
| 单张/批量检测 | YOLO 推理 → 框 + 类别 + 置信度 |
| 视频检测 | 抽帧 + YOLO + 时间戳聚合 |
| 摄像头告警 | 流式推理 → 实时阈值告警 |
| 质量趋势 | 历史检测结果 → 缺陷率统计 |
| 数据回流 | 人工复核后的图片可加入数据集继续训练 |

---

## API 速览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 用户名密码登录，返回 access/refresh token |
| POST | `/api/auth/refresh` | 用 refresh token 换新 access token |
| GET  | `/api/model/status` | 当前激活模型状态 |
| POST | `/api/model/load` | 切换/激活模型 |
| POST | `/api/model/predict` | 单张图片检测（multipart） |
| POST | `/api/model/predict-batch` | 批量检测 |
| POST | `/api/video/detect` | 视频检测 |
| GET  | `/api/detection-records` | 检测记录列表（支持筛选 / 分页） |
| GET  | `/api/detection-records/export` | 导出 CSV |
| GET  | `/api/statistics` | 统计概览 |
| GET  | `/api/statistics/daily` | 每日统计 |
| GET  | `/api/users` / `POST` / `PUT` / `DELETE` | 用户管理（admin） |
| GET  | `/api/settings` / `PUT /api/settings/{key}` | 系统设置 |

完整 OpenAPI 文档：启动后端后访问 `http://localhost:8002/docs`。

---

## 测试

```bash
# 冒烟测试：登录 → 加载模型 → 单张预测
python tests/smoke_test_api.py

# 视频检测测试
python tests/test_video_detect.py
```

`smoke_test_api.py` 默认使用 `admin/admin123`，要求后端已经启动且 `best.pt` 已就位。

---

## 部署

### 生产环境 Nginx 反向代理

参见 `scripts/nginx.conf.example`，典型配置：

```nginx
server {
    listen 80;
    server_name defect.example.com;

    location / {
        root /var/www/metal-pipe-defect-detection/frontend/dist;
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 前端打包

```bash
cd frontend && pnpm run build   # 产物在 frontend/dist/
```

### 后端进程守护（systemd 示例）

```ini
# /etc/systemd/system/defect-detection.service
[Unit]
Description=Metal Pipe Defect Detection Backend
After=network.target mysql.service

[Service]
WorkingDirectory=/opt/metal-pipe-defect-detection/backend
ExecStart=/opt/metal-pipe-defect-detection/backend/venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8002 --workers 2
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

---

## 常见问题 FAQ

**Q1 启动报 `ModuleNotFoundError: ultralytics`？**
A: 在 backend venv 中 `pip install ultralytics torch torchvision`，或运行 `start.bat` / `start.sh` 让它自动装。

**Q2 摄像头检测黑屏？**
A: 浏览器需 HTTPS 或 `http://localhost`，否则 navigator.mediaDevices 不可用。

**Q3 想换 GPU？**
A: 安装对应 CUDA 版本的 torch，然后在 `start.sh` 里把 `device=cpu` 改为 `device=0`。

**Q4 模型切换不生效？**
A: Web 端点击「激活」后，后端需重启或在「模型管理」中点击「重新加载」。

**Q5 数据库密码忘了？**
A: Windows 下执行 `scripts/reset_mysql_pwd.ps1`（需管理员）；Linux 下用 `mysqld --skip-grant-tables`。

**Q6 上传文件大小限制？**
A: 默认 10MB，修改 `sql/mysql_schema.sql` 中 `max_file_size` 行即可。

---

## 致谢与许可证

- [Ultralytics YOLO](https://github.com/ultralytics/ultralytics) — AI 推理引擎
- [FastAPI](https://fastapi.tiangolo.com/) — 后端框架
- [React](https://react.dev/) + [Tailwind](https://tailwindcss.com/) — 前端

本项目以 **MIT License** 发布，详见 [LICENSE](./LICENSE)。