"""
FastAPI后端服务主入口
支持云数据库(Supabase)和本地MySQL切换
"""
import os
import re
import sys
import base64
import shutil
from pathlib import Path
from dotenv import load_dotenv

# 添加项目根目录到Python路径
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

# 加载 .env 文件
env_path = project_root / "backend" / ".env"
if env_path.exists():
    load_dotenv(env_path)
    print(f"✅ 已加载环境变量文件: {env_path}")
else:
    print(f"⚠️ 环境变量文件不存在: {env_path}")

from fastapi import FastAPI, HTTPException, Depends, File, UploadFile, BackgroundTasks, Form, Header, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime

from api.auth import (
    get_current_user,
    require_role,
    create_access_token,
    create_refresh_token,
    verify_token,
)
import uuid
import json

from backend.config.database import db_manager
from backend.services.detection_service import DetectionService
from backend.services.model_service import ModelService
from backend.services.database_service import db_service

app = FastAPI(
    title="金属细管内壁缺陷检测系统 API",
    description="支持云数据库和本地MySQL的缺陷检测后端服务",
    version="1.0.0"
)

# CORS配置
# 生产环境请通过环境变量 CORS_ORIGINS 指定白名单（逗号分隔），例如
#   CORS_ORIGINS=http://localhost:3015,http://127.0.0.1:3015
# 本项目使用 Authorization: Bearer <token> 传递身份，不依赖 Cookie，
# 因此不再开启 allow_credentials（与 allow_origins=["*"] 同时使用本身就是非法组合）。
_cors_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 创建上传目录（按检测类型分类）
UPLOAD_DIR = project_root / "uploads"
# 分类子目录
SINGLE_DIR = UPLOAD_DIR / "single"
BATCH_DIR = UPLOAD_DIR / "batch"
CAMERA_DIR = UPLOAD_DIR / "camera"
for d in [UPLOAD_DIR, SINGLE_DIR, BATCH_DIR, CAMERA_DIR]:
    d.mkdir(exist_ok=True)

# 挂载静态文件目录用于访问上传的图片
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


def get_upload_subdir(detection_type: str, batch_id: str = None) -> Path:
    """根据检测类型返回对应的上传子目录路径"""
    if detection_type == 'single':
        return SINGLE_DIR
    elif detection_type == 'batch':
        # 每个批次一个子文件夹，用batch_id或时间戳命名
        batch_subdir = batch_id or datetime.now().strftime('%Y%m%d_%H%M%S')
        target_dir = BATCH_DIR / batch_subdir
        target_dir.mkdir(exist_ok=True)
        return target_dir
    elif detection_type in ('camera', 'video'):
        # 按日期分子目录
        date_dir = datetime.now().strftime('%Y-%m-%d')
        target_dir = CAMERA_DIR / date_dir
        target_dir.mkdir(exist_ok=True)
        return target_dir
    return UPLOAD_DIR

# 服务实例
detection_service = DetectionService()
model_service = ModelService()


@app.on_event("startup")
async def _auto_load_default_model():
    """启动时自动加载默认模型权重。

    修复前：服务启动后模型一直是未加载状态，`/api/model/predict` 会把
    "模型未加载" 包装成 200 + 0 缺陷返回，用户以为检测成功，实际什么都没跑。
    """
    # 优先使用仓库自带的权重（clone 即可运行，不依赖外部绝对路径），
    # 其次才是环境变量 MODEL_PATH 指定的外部权重
    candidates = [
        project_root / "models_weights" / "best.pt",
        project_root / "backend" / "models_weights" / "best.pt",
        project_root / "models" / "best.pt",
    ]
    # 环境变量指定的外部权重作为兜底
    env_path = os.environ.get('MODEL_PATH', '')
    if env_path:
        candidates.append(Path(env_path))
    for cand in candidates:
        try:
            if cand and cand.exists():
                res = model_service.load_model(str(cand))
                if res.get('success'):
                    print(f"✅ 启动时自动加载模型成功: {cand}")
                    return
                print(f"⚠️ 自动加载模型失败 {cand}: {res.get('message')}")
        except Exception as e:
            print(f"⚠️ 自动加载模型异常 {cand}: {e}")
    print("⚠️ 未找到可用的默认模型权重，检测功能不可用；"
          "请在「模型管理」中手动加载，或设置环境变量 MODEL_PATH 指向 .pt 文件")


def _match_batch_id(value, batch_id) -> bool:
    """批量任务ID 既有自增整数也有 UUID 字符串，比较时统一按字符串处理。

    修复前 `batch_id: int` 的类型声明会让 UUID 批次直接 422，
    导致「批量检测详情」页面永远打不开。
    """
    if value is None or batch_id is None:
        return False
    return str(value) == str(batch_id)


def _resolve_user_id(user_id, current_user: dict):
    """把请求参数里的 user_id 收敛到当前登录用户，防止越权查看/操作他人数据。

    规则：
    - 管理员：可以显式指定 user_id（不传则视为查询全部 / 自身，由调用方决定）
    - 其他角色：一律强制使用 JWT 里的 user_id，忽略外部传入值
    """
    if current_user.get("role") == "admin" and user_id:
        return int(user_id) if str(user_id).isdigit() else user_id
    uid = current_user.get("user_id")
    return int(uid) if uid and str(uid).isdigit() else None


# ============ 数据模型 ============

class LoginRequest(BaseModel):
    username: str
    password: str


class DetectionRequest(BaseModel):
    user_id: Optional[str] = None
    username: Optional[str] = None
    confidence_threshold: float = 0.5
    iou_threshold: float = 0.45


class BatchDetectionRequest(BaseModel):
    user_id: Optional[str] = None
    batch_name: str
    confidence_threshold: float = 0.5
    iou_threshold: float = 0.45


class CameraLogRequest(BaseModel):
    user_id: Optional[str] = None
    source_type: str  # 'camera' 或 'video'
    source_name: str
    defect_type: str
    confidence: float
    severity: str = 'info'
    message: str
    bbox: Optional[Dict[str, float]] = None
    image_url: Optional[str] = None


class SaveLogsRequest(BaseModel):
    log_ids: List[str]
    user_id: Optional[str] = None


# ============ API路由 ============

@app.get("/")
async def root():
    """根路径"""
    return {
        "message": "金属细管内壁缺陷检测系统 API",
        "version": "1.0.0",
        "database_type": db_manager.config.type
    }


@app.get("/health")
async def health_check():
    """健康检查"""
    return {
        "status": "healthy",
        "database_type": db_manager.config.type,
        "timestamp": datetime.now().isoformat()
    }


# ============ 认证API ============

@app.post("/api/auth/login")
async def login(request: LoginRequest):
    """用户登录验证，返回 JWT token"""
    try:
        if not db_service.is_connected():
            raise HTTPException(status_code=500, detail="数据库未连接")

        user = db_service.authenticate_user(request.username, request.password)
        if not user:
            raise HTTPException(status_code=401, detail="用户名或密码错误")

        # 生成 JWT token
        token_data = {
            "sub": str(user['id']),
            "username": user['username'],
            "role": user['role'],
        }
        access_token = create_access_token(token_data)
        refresh_token = create_refresh_token(token_data)

        return {
            "success": True,
            "data": {
                "id": user['id'],
                "username": user['username'],
                "displayName": user.get('full_name') or user['username'],
                "role": user['role'],
                "email": user.get('email'),
                "phone": user.get('phone'),
                "department": user.get('department'),
                "avatarUrl": user.get('avatar_url') if user.get('avatar_url') else None,
                "is_active": bool(user.get('is_active', True)),
                "access_token": access_token,
                "refresh_token": refresh_token,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ 登录异常: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class RefreshRequest(BaseModel):
    refresh_token: str


@app.post("/api/auth/refresh")
async def refresh_token(request: RefreshRequest):
    """刷新 access token"""
    try:
        payload = verify_token(request.refresh_token, expected_type="refresh")
        new_token_data = {
            "sub": payload.get("sub"),
            "username": payload.get("username"),
            "role": payload.get("role"),
        }
        access_token = create_access_token(new_token_data)
        return {"success": True, "data": {"access_token": access_token}}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ 检测记录API ============

@app.get("/api/detection-records")
async def get_detection_records(
    user_id: Optional[str] = None,
    detection_type: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """获取检测记录列表"""
    try:
        # admin 可指定 username，其他角色只看自己的
        filter_username = user_id if current_user["role"] == "admin" and user_id else current_user["username"]
        records = await detection_service.get_detection_records(
            user_id=filter_username,
            detection_type=detection_type,
            limit=limit,
            offset=offset
        )
        return {"success": True, "data": records}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ 数据导出API ============
# 注意：/export 必须注册在 /api/detection-records/{record_id} 之前，
# 否则 "export" 会被当作 record_id 命中上面的路由，导出接口永远返回 404。

@app.get("/api/detection-records/export")
async def export_detection_records(
    detection_type: Optional[str] = None,
    format: str = 'csv',
    user_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """
    导出检测记录数据
    - format: csv 或 json
    - 非管理员只能导出自己的记录
    """
    try:
        # admin 可指定 username，其他角色强制导出自己的
        filter_username = user_id if current_user["role"] == "admin" and user_id else current_user["username"]
        records = await detection_service.get_detection_records(
            user_id=filter_username,
            detection_type=detection_type,
            limit=10000  # 导出大量记录
        )

        if format == 'json':
            # 返回JSON格式
            return {
                "success": True,
                "data": records,
                "count": len(records)
            }
        else:
            # 返回CSV格式
            import csv
            import io

            output = io.StringIO()

            # CSV列定义
            fieldnames = [
                'id', 'detection_id', 'username', 'original_filename',
                'detection_type', 'defect_count', 'confidence',
                'processing_time', 'status', 'created_at',
                'image_url', 'result_image_url'
            ]

            writer = csv.DictWriter(output, fieldnames=fieldnames)
            writer.writeheader()

            for record in records:
                row = {
                    'id': record.get('id', ''),
                    'detection_id': record.get('detection_id', ''),
                    'username': record.get('username', ''),
                    'original_filename': record.get('original_filename', ''),
                    'detection_type': record.get('detection_type', ''),
                    'defect_count': record.get('defect_count', 0),
                    'confidence': record.get('confidence', 0),
                    'processing_time': record.get('processing_time', 0),
                    'status': record.get('status', ''),
                    'created_at': record.get('created_at', ''),
                    'image_url': record.get('image_url', ''),
                    'result_image_url': record.get('result_image_url', '')
                }
                writer.writerow(row)

            csv_content = output.getvalue()

            # 返回CSV文件
            from fastapi.responses import StreamingResponse

            return StreamingResponse(
                io.StringIO(csv_content),
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename=detection_records_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"}
            )
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/detection-records/{record_id}")
async def get_detection_record(record_id: str, current_user: dict = Depends(get_current_user)):
    """获取单个检测记录详情"""
    try:
        record = await detection_service.get_detection_record(record_id)
        if not record:
            raise HTTPException(status_code=404, detail="记录不存在")
        return {"success": True, "data": record}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/detection-records")
async def create_detection_record(
    request: DetectionRequest,
    current_user: dict = Depends(require_role("admin", "operator")),
):
    """创建检测记录"""
    try:
        record = await detection_service.create_detection_record(request.dict())
        return {"success": True, "data": record}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/detection-records/{record_id}/image")
async def upload_detection_image(
    record_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(require_role("admin", "operator")),
):
    """上传检测图片"""
    try:
        result = await detection_service.process_image(record_id, file)
        return {"success": True, "data": result}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/detection-records/{record_id}")
async def delete_detection_record(
    record_id: str,
    current_user: dict = Depends(require_role("admin", "operator")),
):
    """删除检测记录"""
    try:
        await detection_service.delete_detection_record(record_id)
        return {"success": True, "message": "记录已删除"}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ 批量检测API ============

@app.get("/api/batch-detections")
async def get_batch_detections(
    user_id: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """获取批量检测任务列表"""
    try:
        filter_user_id = user_id if current_user["role"] == "admin" and user_id else current_user["user_id"]
        batches = await detection_service.get_batch_detections(
            user_id=filter_user_id,
            limit=limit,
            offset=offset
        )
        return {"success": True, "data": batches}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/batch-detections")
async def create_batch_detection(
    request: BatchDetectionRequest,
    current_user: dict = Depends(require_role("admin", "operator")),
):
    """创建批量检测任务"""
    try:
        data = request.dict()
        # 归属一律取自 JWT，忽略请求体里可能伪造的 user_id
        data['user_id'] = current_user["user_id"]
        data['username'] = current_user["username"]
        batch = await detection_service.create_batch_detection(data)
        return {"success": True, "data": batch}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/batch-detections/{batch_id}/upload")
async def upload_batch_files(
    batch_id: str,
    files: List[UploadFile] = File(...),
    current_user: dict = Depends(require_role("admin", "operator")),
):
    """上传批量检测文件"""
    try:
        result = await detection_service.process_batch_files(batch_id, files)
        return {"success": True, "data": result}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/batch-detections/{batch_id}/status")
async def get_batch_status(
    batch_id: str,
    current_user: dict = Depends(get_current_user),
):
    """获取批量检测任务状态"""
    try:
        status = await detection_service.get_batch_status(batch_id)
        return {"success": True, "data": status}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ 摄像头检测日志API ============

@app.get("/api/camera-logs")
async def get_camera_logs(
    user_id: Optional[str] = None,
    source_type: Optional[str] = None,
    saved_only: bool = False,
    limit: int = 100,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """获取摄像头检测日志"""
    try:
        filter_user_id = user_id if current_user["role"] == "admin" and user_id else current_user["user_id"]
        logs = await detection_service.get_camera_logs(
            user_id=filter_user_id,
            source_type=source_type,
            saved_only=saved_only,
            limit=limit,
            offset=offset
        )
        return {"success": True, "data": logs}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/camera-logs")
async def create_camera_log(
    request: Optional[CameraLogRequest] = None,
    source_type: Optional[str] = Form(None),
    source_name: Optional[str] = Form(None),
    defect_type: Optional[str] = Form(None),
    confidence: Optional[float] = Form(0.0),
    severity: str = Form('info'),
    message: str = Form(''),
    bbox: Optional[str] = Form(None),
    user_id: Optional[str] = Form(None),
    image: Optional[UploadFile] = File(None),
    current_user: dict = Depends(require_role("admin", "operator")),
):
    """创建摄像头检测日志（支持JSON和FormData两种格式）"""
    try:
        # 使用 JWT token 中的用户 ID
        uid = current_user["user_id"]
        # 处理图片上传
        image_url = None
        if image:
            camera_subdir = get_upload_subdir(source_type or 'camera')
            unique_filename = f"{uuid.uuid4().hex}_{image.filename or 'capture.png'}"
            img_path = camera_subdir / unique_filename

            file_content = await image.read()
            with open(img_path, "wb") as f:
                f.write(file_content)

            rel_path = img_path.relative_to(UPLOAD_DIR)
            image_url = f"/uploads/{rel_path.as_posix()}"

        # 构建日志数据
        log_data = {
            'user_id': uid,
            'source_type': source_type or (request.source_type if request else 'camera'),
            'source_name': source_name or (request.source_name if request else ''),
            'defect_type': defect_type or (request.defect_type if request else 'unknown'),
            'confidence': confidence if confidence else (request.confidence if request else 0),
            'severity': severity,
            'message': message or (request.message if request else ''),
            'image_url': image_url
        }

        # 解析bbox
        if bbox:
            import json as json_mod
            try:
                log_data['bbox'] = json_mod.loads(bbox)
            except:
                pass
        elif request and request.bbox:
            log_data['bbox'] = request.bbox

        log = await detection_service.create_camera_log(log_data)
        return {"success": True, "data": log}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/camera-logs/save")
async def save_camera_logs(
    request: SaveLogsRequest,
    current_user: dict = Depends(require_role("admin", "operator")),
):
    """保存选中的摄像头检测日志"""
    try:
        result = await detection_service.save_camera_logs(request.log_ids, current_user["user_id"])
        return {"success": True, "data": result}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/camera-logs/{log_id}")
async def delete_camera_log(
    log_id: str,
    current_user: dict = Depends(require_role("admin", "operator")),
):
    """删除摄像头检测日志"""
    try:
        await detection_service.delete_camera_log(log_id)
        return {"success": True, "message": "日志已删除"}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ 统计API ============

@app.get("/api/statistics")
async def get_statistics(
    user_id: Optional[int] = None,
    days: int = 7,
    current_user: dict = Depends(get_current_user),
):
    """获取统计信息 - 包含单张、批量、摄像头检测的分别统计"""
    try:
        if not db_service.is_connected():
            raise HTTPException(status_code=500, detail="数据库未连接")

        from datetime import datetime, timedelta

        # 非管理员只能看自己的数据
        if current_user["role"] != "admin":
            filter_user_id = int(current_user["user_id"])
        else:
            filter_user_id = user_id

        # 获取检测记录（按用户过滤）
        all_records = db_service.get_detection_records(filter_user_id, None, 10000)
        
        # 分别统计单张、批量、摄像头检测
        single_records = [r for r in all_records if r.get('detection_type') == 'single']
        batch_records = [r for r in all_records if r.get('detection_type') == 'batch']
        camera_records = [r for r in all_records if r.get('detection_type') == 'camera']
        
        # 计算各类型统计
        def calc_stats(records):
            total = len(records)
            defects = sum(r.get('defect_count', 0) for r in records)
            avg_time = sum(r.get('processing_time', 0) for r in records) / total if total else 0
            return {'total': total, 'defects': defects, 'avg_time': avg_time}
        
        single_stats = calc_stats(single_records)
        batch_stats = calc_stats(batch_records)
        camera_stats = calc_stats(camera_records)
        
        # 按缺陷类型统计
        defect_types = {}
        for record in all_records:
            details = record.get('defect_details', [])
            if isinstance(details, list):
                for defect in details:
                    defect_type = defect.get('class', '未知')
                    defect_types[defect_type] = defect_types.get(defect_type, 0) + 1
        
        # 按日期统计
        end_date = datetime.now().date()
        start_date = end_date - timedelta(days=days-1)
        
        date_stats = {}
        current_date = start_date
        while current_date <= end_date:
            date_str = current_date.strftime("%Y-%m-%d")
            date_stats[date_str] = {"date": date_str, "single": 0, "batch": 0, "camera": 0, "total": 0, "defects": 0}
            current_date += timedelta(days=1)
        
        for record in all_records:
            created_at = record.get('created_at')
            if created_at:
                try:
                    if isinstance(created_at, str):
                        record_date = datetime.fromisoformat(created_at.replace('Z', '+00:00')).date()
                    else:
                        record_date = created_at.date()
                    
                    date_str = record_date.strftime("%Y-%m-%d")
                    if date_str in date_stats:
                        dtype = record.get('detection_type', 'single')
                        if dtype in date_stats[date_str]:
                            date_stats[date_str][dtype] += 1
                        date_stats[date_str]["total"] += 1
                        date_stats[date_str]["defects"] += record.get('defect_count', 0)
                except:
                    pass
        
        return {
            "success": True,
            "data": {
                "single": {
                    "count": single_stats['total'],
                    "defects": single_stats['defects'],
                    "avg_defects": single_stats['defects'] / single_stats['total'] if single_stats['total'] else 0,
                    "avg_time": single_stats['avg_time']
                },
                "batch": {
                    "count": batch_stats['total'],
                    "defects": batch_stats['defects'],
                    "avg_defects": batch_stats['defects'] / batch_stats['total'] if batch_stats['total'] else 0,
                    "avg_time": batch_stats['avg_time']
                },
                "camera": {
                    "count": camera_stats['total'],
                    "defects": camera_stats['defects'],
                    "avg_defects": camera_stats['defects'] / camera_stats['total'] if camera_stats['total'] else 0,
                    "avg_time": camera_stats['avg_time']
                },
                "total_detections": len(all_records),
                "total_defects": sum(r.get('defect_count', 0) for r in all_records),
                "defect_types": [{"type": k, "count": v} for k, v in defect_types.items()],
                "daily_stats": list(date_stats.values())
            }
        }
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/statistics/daily")
async def get_daily_statistics(
    user_id: Optional[str] = None,
    days: int = 7,
    current_user: dict = Depends(get_current_user),
):
    """获取每日统计数据"""
    try:
        filter_user_id = user_id if current_user["role"] == "admin" and user_id else current_user["user_id"]
        stats = await detection_service.get_daily_statistics(filter_user_id, days)
        return {"success": True, "data": stats}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/statistics/defect-types")
async def get_defect_type_statistics(
    user_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """获取缺陷类型统计"""
    try:
        filter_user_id = user_id if current_user["role"] == "admin" and user_id else current_user["user_id"]
        stats = await detection_service.get_defect_type_statistics(filter_user_id)
        return {"success": True, "data": stats}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ 系统设置API ============

@app.get("/api/settings")
async def get_settings(current_user: dict = Depends(get_current_user)):
    """获取系统设置"""
    try:
        settings = await detection_service.get_settings()
        return {"success": True, "data": settings}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/settings/{key}")
async def get_setting(key: str, current_user: dict = Depends(get_current_user)):
    """获取单个设置"""
    try:
        setting = await detection_service.get_setting(key)
        return {"success": True, "data": setting}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/settings/{key}")
async def update_setting(
    key: str,
    value: Dict[str, Any],
    current_user: dict = Depends(require_role("admin")),
):
    """更新设置"""
    try:
        setting = await detection_service.update_setting(key, value.get('value'))
        return {"success": True, "data": setting}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ AI模型API ============

@app.get("/api/model/status")
async def get_model_status(current_user: dict = Depends(get_current_user)):
    """获取AI模型状态"""
    try:
        status = model_service.get_status()
        return {"success": True, "data": status}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class LoadModelRequest(BaseModel):
    model_path: Optional[str] = None

@app.post("/api/model/load")
async def load_model(
    model_path: Optional[str] = None,
    body: Optional[LoadModelRequest] = None,
    current_user: dict = Depends(require_role("admin")),
):
    """加载AI模型 - 支持query参数和JSON body"""
    try:
        # 优先使用body中的model_path，否则使用query参数
        actual_model_path = model_path
        if actual_model_path is None and body and body.model_path:
            actual_model_path = body.model_path
        if actual_model_path is None:
            raise HTTPException(status_code=400, detail="model_path is required")
        result = model_service.load_model(actual_model_path)

        # 模型加载成功后，如果模型目录没有classes.txt，从模型内部读出类别名写入
        if result.get('success') and model_service.class_names:
            pt_file = Path(actual_model_path)
            if not pt_file.name.endswith('.pt'):
                # 可能是指向目录的路径，尝试找到pt文件
                if pt_file.is_dir():
                    candidates = list(pt_file.glob('*.pt'))
                    if candidates:
                        pt_file = candidates[0]
            model_dir = pt_file.parent
            classes_file = model_dir / 'classes.txt'
            if not classes_file.exists():
                try:
                    with open(classes_file, 'w', encoding='utf-8') as f:
                        f.write('\n'.join(model_service.class_names))
                except Exception:
                    pass  # 写文件失败不影响模型加载

        return {"success": True, "data": result}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 模型上传目录
MODELS_DIR = Path(__file__).parent.parent / "models"

# 从环境变量读取外部模型配置
EXTERNAL_MODEL_PATH = os.environ.get('MODEL_PATH', '')
EXTERNAL_MODEL_NAME = os.environ.get('MODEL_NAME', '金属内壁缺陷检测模型')


def read_classes_from_file(classes_file_path: str) -> tuple:
    """读取类别文件"""
    class_names = []
    class_count = 0
    try:
        with open(classes_file_path, 'r', encoding='utf-8') as f:
            class_names = [line.strip() for line in f.readlines() if line.strip()]
            class_count = len(class_names)
    except:
        pass
    return class_names, class_count


@app.get("/api/models")
async def get_available_models(current_user: dict = Depends(get_current_user)):
    """获取可用模型列表"""
    try:
        models = []
        
        # 1. 检查环境变量中的外部模型
        if EXTERNAL_MODEL_PATH and Path(EXTERNAL_MODEL_PATH).exists():
            pt_file = Path(EXTERNAL_MODEL_PATH)
            model_dir = pt_file.parent
            classes_file = model_dir / "classes.txt"
            
            class_names, class_count = read_classes_from_file(str(classes_file)) if classes_file.exists() else ([], 0)
            
            # 尝试从父目录查找 classes.txt
            if not classes_file.exists():
                classes_file = model_dir.parent / "classes.txt"
                if classes_file.exists():
                    class_names, class_count = read_classes_from_file(str(classes_file))
            
            models.append({
                'name': EXTERNAL_MODEL_NAME,
                'path': str(model_dir),
                'pt_file': str(pt_file),
                'has_classes': classes_file.exists(),
                'classes_path': str(classes_file) if classes_file.exists() else None,
                'class_names': class_names,
                'class_count': class_count
            })
        
        # 2. 扫描 backend/models 目录
        if MODELS_DIR.exists():
            for model_dir in MODELS_DIR.iterdir():
                if model_dir.is_dir():
                    # 查找.pt文件
                    pt_files = list(model_dir.glob("*.pt"))
                    classes_file = model_dir / "classes.txt"
                    config_file = model_dir / "config.yaml"

                    model_info = {
                        'name': model_dir.name,
                        'path': str(model_dir),
                        'pt_file': str(pt_files[0]) if pt_files else None,
                        'has_classes': classes_file.exists(),
                        'classes_path': str(classes_file) if classes_file.exists() else None,
                        'has_config': config_file.exists(),
                        'config_path': str(config_file) if config_file.exists() else None
                    }

                    # 读取类别信息
                    if classes_file.exists():
                        with open(classes_file, 'r') as f:
                            model_info['class_names'] = [line.strip() for line in f.readlines() if line.strip()]
                        model_info['class_count'] = len(model_info['class_names'])
                    else:
                        # 如果模型已加载到内存，从内存获取类别名
                        if model_service.is_loaded and model_service.model_path:
                            loaded_pt = Path(model_service.model_path)
                            if loaded_pt.parent == model_dir or str(loaded_pt) == str(pt_files[0] if pt_files else ''):
                                model_info['class_names'] = model_service.class_names
                                model_info['class_count'] = len(model_service.class_names)
                            else:
                                model_info['class_names'] = []
                                model_info['class_count'] = 0
                        else:
                            model_info['class_names'] = []
                            model_info['class_count'] = 0

                    models.append(model_info)

        return {"success": True, "data": models}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/models/upload")
async def upload_model(
    model_file: UploadFile = File(...),
    classes_file: Optional[UploadFile] = File(None),
    model_name: Optional[str] = Form(None),
    current_user: dict = Depends(require_role("admin", "operator")),
):
    """上传YOLO模型文件

    上传要求：
    1. 模型文件必须是 .pt 格式（YOLO26训练结果）
    2. 类别文件必须是 .txt 格式，每行一个类别名称（可选）
    3. 上传后模型会自动保存到 /backend/models/{model_name}/ 目录
    4. 目前仅支持 YOLO26 训练出来的模型
    """
    try:
        # 验证文件类型
        if not model_file.filename.endswith('.pt'):
            raise HTTPException(status_code=400, detail="模型文件必须是 .pt 格式")

        # 生成模型目录名
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        if model_name and model_name.strip():
            # 使用用户提供的名称，sanitize 替换非法文件名字符
            safe_name = re.sub(r'[<>:"/\\|?*\s]+', '_', model_name.strip())
            if not safe_name or safe_name == '_':
                safe_name = f"model_{timestamp}"
            # 附加时间戳避免重名
            model_dir_name = f"{safe_name}_{timestamp}"
        else:
            model_dir_name = f"model_{timestamp}"
        model_dir = MODELS_DIR / model_dir_name
        model_dir.mkdir(parents=True, exist_ok=True)

        # 保存模型文件
        model_path = model_dir / "model.pt"
        with open(model_path, "wb") as f:
            content = await model_file.read()
            f.write(content)

        # 保存类别文件
        if classes_file:
            if not classes_file.filename.endswith('.txt'):
                raise HTTPException(status_code=400, detail="类别文件必须是 .txt 格式")
            classes_path = model_dir / "classes.txt"
            with open(classes_path, "wb") as f:
                content = await classes_file.read()
                f.write(content)
        else:
            classes_path = None

        # 返回上传结果
        return {
            "success": True,
            "message": "模型上传成功",
            "data": {
                "model_name": model_dir_name,
                "model_path": str(model_path),
                "classes_path": str(classes_path) if classes_path else None,
                "has_classes": classes_path is not None
            }
        }

    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class RenameModelRequest(BaseModel):
    old_name: str
    new_name: str

@app.post("/api/models/rename")
async def rename_model(
    body: RenameModelRequest,
    current_user: dict = Depends(require_role("admin")),
):
    """重命名模型目录"""
    try:
        old_dir = MODELS_DIR / body.old_name
        if not old_dir.exists() or not old_dir.is_dir():
            raise HTTPException(status_code=404, detail=f"模型 '{body.old_name}' 不存在")

        new_name = re.sub(r'[<>:"/\\|?*\s]+', '_', body.new_name.strip())
        if not new_name or new_name == '_':
            raise HTTPException(status_code=400, detail="模型名称无效")

        new_dir = MODELS_DIR / new_name
        if new_dir.exists():
            raise HTTPException(status_code=409, detail=f"模型 '{new_name}' 已存在，请使用其他名称")

        old_dir.rename(new_dir)

        return {
            "success": True,
            "message": "模型名称已修改",
            "data": {"old_name": body.old_name, "new_name": new_name}
        }

    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/models/{model_name}")
async def delete_model(
    model_name: str,
    current_user: dict = Depends(require_role("admin")),
):
    """删除模型目录及其所有文件"""
    try:
        model_dir = MODELS_DIR / model_name
        if not model_dir.exists() or not model_dir.is_dir():
            raise HTTPException(status_code=404, detail=f"模型 '{model_name}' 不存在")

        shutil.rmtree(str(model_dir))

        # 如果被删除的模型正是当前加载的模型，清除模型状态
        if model_service.model_path and str(model_dir) in model_service.model_path:
            model_service.model = None
            model_service.is_loaded = False
            model_service.model_path = None

        return {
            "success": True,
            "message": f"模型 '{model_name}' 已删除"
        }

    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/model/predict")
async def predict(
    file: UploadFile = File(...),
    user_id: Optional[str] = None,
    username: Optional[str] = None,
    confidence_threshold: float = 0.5,
    iou_threshold: float = 0.45,
    detection_type: str = 'single',
    current_user: dict = Depends(require_role("admin", "operator")),
):
    """执行单张图片预测并保存记录到数据库"""
    try:
        # 根据检测类型获取对应子目录
        target_dir = get_upload_subdir(detection_type)

        # 生成唯一文件名
        unique_filename = f"{uuid.uuid4().hex}_{file.filename}"
        file_path = target_dir / unique_filename

        # 读取文件内容并保存
        file_content = await file.read()
        with open(file_path, "wb") as f:
            f.write(file_content)

        # 生成相对路径（用于URL访问和数据库存储）
        rel_path = file_path.relative_to(UPLOAD_DIR)
        original_image_url = f"/uploads/{rel_path.as_posix()}"
        result_image_url = ""

        # 使用文件路径进行预测
        result = await model_service.predict_from_path(str(file_path), file.filename)

        # 推理失败（如模型未加载）必须显式报错。
        # 修复前这里会继续往下走，最终返回 200 + 0 缺陷，前端显示"检测完成"但什么都没做。
        if not result.get('success'):
            raise HTTPException(
                status_code=503,
                detail=result.get('message', '模型推理失败，请先在「模型管理」中加载模型')
            )

        # 获取标注图片（base64格式）并保存为文件
        annotated_base64 = result.get('result', {}).get('annotated_image')
        if annotated_base64 and annotated_base64.startswith('data:image'):
            try:
                import base64
                annotated_data = annotated_base64.split(',')[1]
                annotated_bytes = base64.b64decode(annotated_data)
                annotated_filename = f"annotated_{unique_filename}"
                annotated_path = target_dir / annotated_filename
                with open(annotated_path, "wb") as f:
                    f.write(annotated_bytes)
                annotated_rel_path = annotated_path.relative_to(UPLOAD_DIR)
                result_image_url = f"/uploads/{annotated_rel_path.as_posix()}"
                print(f"✅ 标注图片已保存: {result_image_url}")
            except Exception as save_error:
                print(f"⚠️ 保存标注图片失败: {save_error}")
                result_image_url = ""
        
        # 如果预测成功，保存记录到数据库
        if result.get('success') and db_service.is_connected():
            try:
                # 获取缺陷检测结果
                detections = result.get('result', {}).get('detections', [])
                
                # 准备记录数据 - 使用 JWT token 中的用户信息，兼容易旧的参数传递
                uid = current_user["user_id"]
                uname = current_user["username"]
                # 兼容旧前端传递的参数
                if not uid and user_id:
                    uid = user_id
                if not uname and username:
                    uname = username
                record_data = {
                    'user_id': int(uid) if uid and str(uid).isdigit() else None,
                    'username': uname or uid or '未知操作员',
                    'detection_type': detection_type,  # 使用传入的检测类型
                    'original_filename': file.filename,
                    'defect_count': result.get('result', {}).get('count', len(detections)),
                    'defect_details': detections,
                    'original_image_url': original_image_url,
                    'result_image_url': result_image_url,  # 保存标注图片路径
                    'processing_time': result.get('result', {}).get('processing_time', 0.0),
                    'confidence_threshold': confidence_threshold,
                    'iou_threshold': iou_threshold
                }
                
                # 保存到数据库
                record_id = db_service.save_detection_record(record_data)
                if record_id:
                    print(f"✅ 检测记录已保存到数据库，记录ID: {record_id}, 操作员: {record_data['username']}, 类型: {detection_type}")
                    
                    # 如果检测到缺陷，自动创建通知
                    if record_data['defect_count'] > 0:
                        try:
                            notification_data = {
                                'user_id': record_data.get('user_id'),
                                'type': 'defect',
                                'title': f'检测到 {record_data["defect_count"]} 个缺陷',
                                'message': f'{record_data["original_filename"]} 检测到 {record_data["defect_count"]} 个缺陷，请及时查看',
                                'link': f'/history?record_id={record_id}'
                            }
                            db_service.create_notification(notification_data)
                            print(f"✅ 缺陷通知已创建: {notification_data['title']}")
                        except Exception as notif_error:
                            print(f"⚠️ 创建缺陷通知失败: {notif_error}")
                else:
                    print("⚠️ 检测记录保存失败，但预测结果已返回")
            except Exception as db_error:
                print(f"⚠️ 保存检测记录时出错: {db_error}")
                # 继续返回预测结果，不中断请求
        
        # 确保结果包含图片URL
        if 'data' in result and 'result' in result['data']:
            result['data']['result']['original_image_url'] = original_image_url
            if not result['data']['result'].get('annotated_image'):
                result['data']['result']['annotated_image'] = result_image_url
        
        return {"success": True, "data": result}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/model/predict-batch")
async def predict_batch(
    files: List[UploadFile] = File(...),
    user_id: Optional[str] = None,
    username: Optional[str] = None,
    batch_name: Optional[str] = None,
    confidence_threshold: float = 0.5,
    iou_threshold: float = 0.45,
    current_user: dict = Depends(require_role("admin", "operator")),
):
    """执行批量预测并保存记录到数据库"""
    if not model_service.is_loaded:
        raise HTTPException(status_code=503, detail="模型未加载，请先在「模型管理」中加载模型")
    try:
        # 创建批量检测记录
        uid = current_user["user_id"]
        uname = current_user["username"]
        if not uid and user_id:
            uid = user_id
        if not uname and username:
            uname = username
        batch_id = None
        if db_service.is_connected():
            try:
                batch_data = {
                    'user_id': int(uid) if uid and str(uid).isdigit() else None,
                    'username': uname,
                    'batch_name': batch_name or f'batch_{datetime.now().strftime("%Y%m%d_%H%M%S")}',
                    'total_files': len(files),
                    'file_list': [file.filename for file in files]
                }
                
                batch_id = db_service.save_batch_detection(batch_data)
                if batch_id:
                    print(f"✅ 批量检测记录已创建，批次ID: {batch_id}")
                    # 更新状态为处理中
                    db_service.update_batch_detection(batch_id, {'status': 'processing'})
            except Exception as db_error:
                print(f"⚠️ 创建批量检测记录时出错: {db_error}")
        
        # 获取批量检测子目录（用batch_id或时间戳命名）
        batch_id_str = str(batch_id) if batch_id else datetime.now().strftime('%Y%m%d_%H%M%S')
        batch_target_dir = get_upload_subdir('batch', batch_id_str)

        # 执行批量预测
        results = []
        total_defects = 0
        processed_files = 0

        for i, file in enumerate(files):
            try:
                # 生成唯一文件名，保存到批次子目录
                unique_filename = f"{uuid.uuid4().hex}_{file.filename}"
                file_path = batch_target_dir / unique_filename

                # 保存文件
                file_content = await file.read()
                with open(file_path, "wb") as f:
                    f.write(file_content)

                rel_path = file_path.relative_to(UPLOAD_DIR)
                original_image_url = f"/uploads/{rel_path.as_posix()}"

                # 执行单张预测
                result = await model_service.predict_from_path(str(file_path), file.filename)

                # 保存标注图片（同一批次子目录）
                result_image_url = ""
                annotated_base64 = result.get('result', {}).get('annotated_image')
                if annotated_base64 and annotated_base64.startswith('data:image'):
                    try:
                        import base64
                        annotated_data = annotated_base64.split(',')[1]
                        annotated_bytes = base64.b64decode(annotated_data)
                        annotated_filename = f"annotated_{unique_filename}"
                        annotated_path = batch_target_dir / annotated_filename
                        with open(annotated_path, "wb") as f:
                            f.write(annotated_bytes)
                        annotated_rel_path = annotated_path.relative_to(UPLOAD_DIR)
                        result_image_url = f"/uploads/{annotated_rel_path.as_posix()}"
                        print(f"✅ 批量检测标注图片已保存: {result_image_url}")
                    except Exception as save_error:
                        print(f"⚠️ 保存标注图片失败: {save_error}")
                
                results.append(result)
                
                # 如果预测成功，保存单张记录到数据库
                if result.get('success') and db_service.is_connected() and batch_id:
                    try:
                        record_data = {
                            # 用 JWT 身份而非请求参数，避免伪造归属
                            'user_id': int(uid) if uid and str(uid).isdigit() else None,
                            'username': uname or uid or '未知操作员',
                            'detection_type': 'batch',
                            'original_filename': file.filename,
                            'defect_count': result.get('result', {}).get('count', 0),
                            'defect_details': result.get('result', {}).get('detections', []),
                            'original_image_url': original_image_url,
                            'result_image_url': result_image_url,
                            'processing_time': result.get('result', {}).get('processing_time', 0.0),
                            'confidence_threshold': confidence_threshold,
                            'iou_threshold': iou_threshold,
                            'batch_id': batch_id
                        }
                        
                        record_id = db_service.save_detection_record(record_data)
                        if record_id:
                            print(f"✅ 批量文件 {i+1}/{len(files)} 记录已保存，记录ID: {record_id}")
                        
                        # 更新统计
                        total_defects += result.get('result', {}).get('count', 0)
                        processed_files += 1
                        
                    except Exception as record_error:
                        print(f"⚠️ 保存批量文件记录时出错: {record_error}")
                
            except Exception as file_error:
                print(f"❌ 处理文件 {file.filename} 时出错: {file_error}")
                results.append({
                    'success': False,
                    'filename': file.filename,
                    'message': str(file_error)
                })
        
        # 更新批量检测记录状态
        if batch_id and db_service.is_connected():
            try:
                update_data = {
                    'processed_files': processed_files,
                    'total_defects': total_defects,
                    'status': 'completed'
                }
                db_service.update_batch_detection(batch_id, update_data)
                print(f"✅ 批量检测完成，批次ID: {batch_id}")
                
                # 如果检测到缺陷，自动创建通知
                if total_defects > 0:
                    try:
                        notification_data = {
                            'user_id': int(user_id) if user_id and user_id.isdigit() else None,
                            'type': 'defect',
                            'title': f'批量检测完成：检测到 {total_defects} 个缺陷',
                            'message': f'批次 {batch_name or batch_id} 共处理 {processed_files} 张图片，检测到 {total_defects} 个缺陷，请及时查看',
                            'link': f'/history?batch_id={batch_id}'
                        }
                        db_service.create_notification(notification_data)
                        print(f"✅ 批量检测缺陷通知已创建: {notification_data['title']}")
                    except Exception as notif_error:
                        print(f"⚠️ 创建批量检测缺陷通知失败: {notif_error}")
            except Exception as update_error:
                print(f"⚠️ 更新批量检测记录时出错: {update_error}")
        
        return {"success": True, "data": results, "batch_id": batch_id}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/batch-detections/{batch_id}")
async def get_batch_detection(
    batch_id: str,
    current_user: dict = Depends(get_current_user),
):
    """获取单个批量检测记录及其详情"""
    try:
        if not db_service.is_connected():
            raise HTTPException(status_code=500, detail="数据库未连接")

        # 获取批量记录（limit 放开，否则只能匹配到最新一条）
        batches = db_service.get_batch_detections(limit=1000)
        batch_record = None
        # 自增主键 id 与业务 batch_id(UUID) 都要匹配，前端两种都会传
        for batch in batches:
            if (_match_batch_id(batch.get('id'), batch_id)
                    or _match_batch_id(batch.get('batch_id'), batch_id)):
                batch_record = batch
                break

        if not batch_record:
            raise HTTPException(status_code=404, detail="批量记录未找到")

        # 获取该批次的检测记录（同样兼容两种 ID 形式）
        biz_id = str(batch_record.get('batch_id') or batch_id)
        records = db_service.get_detection_records()
        batch_records = [r for r in records
                         if _match_batch_id(r.get('batch_id'), batch_id)
                         or _match_batch_id(r.get('batch_id'), biz_id)]
        
        return {
            "success": True,
            "data": {
                "batch": batch_record,
                "records": batch_records,
                "record_count": len(batch_records)
            }
        }
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/batch-records/grouped")
async def get_grouped_batch_records(
    user_id: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """获取按批次分组的检测记录（用于批量检测历史记录的批次展示）
    
    返回结构:
    [
      {
        "batch_id": 1,
        "created_at": "2026-04-21T10:00:00",
        "total_files": 5,
        "processed_files": 5,
        "total_defects": 3,
        "status": "completed",
        "records": [
          { "id": 1, "original_filename": "a.png", ... },
          { "id": 2, "original_filename": "b.png", ... },
        ]
      }
    ]
    """
    try:
        if not db_service.is_connected():
            raise HTTPException(status_code=500, detail="数据库未连接")

        # 非管理员强制只看自己的数据
        if current_user["role"] != "admin":
            uid = current_user["user_id"]
            user_id = int(uid) if uid and str(uid).isdigit() else user_id

        # 获取所有批量检测的检测记录
        all_records = db_service.get_detection_records(user_id=user_id, detection_type='batch', limit=1000, offset=0)
        
        # 按 batch_id 分组（batch_id 为 null 的按 created_at 分钟级分组）
        batch_map: Dict[str, Dict] = {}
        for record in all_records:
            bid = record.get('batch_id')
            created_at = record.get('created_at') or record.get('detection_time')
            
            if bid:
                key = f"batch_{bid}"
            elif created_at:
                # batch_id 为空时，按分钟级时间戳分组（同一分钟内视为同一批次）
                try:
                    dt = datetime.fromisoformat(str(created_at).replace('Z', '+00:00'))
                    key = f"time_{dt.strftime('%Y%m%d%H%M')}"
                except:
                    key = f"time_{created_at}"
            else:
                # 完全没有标识，每个记录单独一组
                key = f"record_{record.get('id')}"
            
            if key not in batch_map:
                batch_map[key] = {
                    'batch_id': bid if bid else key,
                    'batch_name': f"批次 #{bid}" if bid else created_at,
                    'created_at': created_at,
                    'username': record.get('username') or '',
                    'total_files': 0,
                    'processed_files': 0,
                    'total_defects': 0,
                    'status': 'completed',
                    'records': []
                }
            batch_map[key]['records'].append(record)
            batch_map[key]['total_defects'] += record.get('defect_count') or 0
        
        # 构建批次列表
        batches = []
        for bid, batch in batch_map.items():
            batch['total_files'] = len(batch['records'])
            batch['processed_files'] = batch['total_files']
            batches.append(batch)
        
        # 按创建时间倒序
        batches.sort(key=lambda x: x.get('created_at') or '', reverse=True)
        
        # 分页
        total = len(batches)
        paginated = batches[offset:offset + limit]
        
        return {"success": True, "data": paginated, "count": total}
        
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/batch-records/{batch_id}")
async def get_batch_record_detail(
    batch_id: str,
    current_user: dict = Depends(get_current_user),
):
    """获取某个批次的详细记录（包含所有图片的详细信息）"""
    try:
        if not db_service.is_connected():
            raise HTTPException(status_code=500, detail="数据库未连接")

        # 获取该批次的检测记录
        all_records = db_service.get_detection_records(detection_type='batch', limit=1000)
        records = [r for r in all_records if _match_batch_id(r.get('batch_id'), batch_id)]
        
        if not records:
            raise HTTPException(status_code=404, detail="批次记录未找到")
        
        total_defects = sum(r.get('defect_count') or 0 for r in records)
        
        return {
            "success": True,
            "data": {
                "batch_id": batch_id,
                "created_at": records[0].get('created_at') or records[0].get('detection_time'),
                "username": records[0].get('username') or '',
                "total_files": len(records),
                "processed_files": len(records),
                "total_defects": total_defects,
                "status": "completed",
                "records": records
            }
        }
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ 历史记录标注图片API ============

@app.get("/api/detection-records/{record_id}/annotated-image")
async def get_annotated_image(
    record_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    获取历史记录的标注图片（根据缺陷数据重新绘制标注框）
    """
    try:
        # 获取历史记录
        record = await detection_service.get_detection_record(record_id)
        if not record:
            raise HTTPException(status_code=404, detail="记录不存在")
        
        # 获取原始图片路径
        original_url = record.get('original_image_url') or record.get('image_url') or ''
        if not original_url:
            raise HTTPException(status_code=404, detail="原始图片路径不存在")
        
        # 构建完整文件路径
        if original_url.startswith('/uploads/'):
            image_path = str(project_root / original_url.lstrip('/'))
        elif original_url.startswith('/'):
            image_path = str(project_root / original_url.lstrip('/'))
        else:
            image_path = str(UPLOAD_DIR / original_url)
        
        if not os.path.exists(image_path):
            raise HTTPException(status_code=404, detail=f"图片文件不存在: {image_path}")
        
        # 获取缺陷详情
        defect_details = record.get('defect_details', [])
        if not defect_details:
            # 如果没有缺陷详情，尝试从其他字段获取
            defects = record.get('defects')
            if defects:
                if isinstance(defects, str):
                    try:
                        defect_details = json.loads(defects)
                    except:
                        defect_details = []
                elif isinstance(defects, list):
                    defect_details = defects
        
        # 生成标注图片
        from PIL import Image, ImageDraw, ImageFont
        import io
        
        # 打开原始图片
        original_image = Image.open(image_path)
        draw = ImageDraw.Draw(original_image)
        
        # 加载字体
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/arphic/uming.ttc", 20)
        except:
            try:
                font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
            except:
                font = ImageFont.load_default()
        
        # 缺陷类型颜色映射
        color_map = {
            '凸起': '#ef4444',
            '焊缝': '#3b82f6',
            '裂纹': '#f97316',
            '腐蚀': '#f59e0b',
            '点蚀': '#8b5cf6',
            '划痕': '#06b6d4',
            '凹痕': '#ec4899',
            '磨损': '#7c2d12',
            '锈蚀': '#eab308',
            '孔洞': '#84cc16',
            '变形': '#64748b',
            '其他': '#6b7280'
        }
        
        def get_color(class_name):
            if class_name in color_map:
                color_hex = color_map[class_name]
                r = int(color_hex[1:3], 16)
                g = int(color_hex[3:5], 16)
                b = int(color_hex[5:7], 16)
                return (r, g, b)
            return (239, 68, 68)  # 默认红色
        
        # 在图片上绘制标注框
        for defect in defect_details:
            class_name = defect.get('class', defect.get('type', '其他'))
            confidence = defect.get('confidence', 0)
            
            # 获取边界框坐标
            bbox = defect.get('bbox', {})
            x = bbox.get('x', defect.get('x', 0))
            y = bbox.get('y', defect.get('y', 0))
            width = bbox.get('width', defect.get('width', 0))
            height = bbox.get('height', defect.get('height', 0))
            
            x1, y1 = x, y
            x2, y2 = x + width, y + height
            
            # 获取颜色
            color = get_color(class_name)
            
            # 绘制边界框
            draw.rectangle([x1, y1, x2, y2], outline=color, width=3)
            
            # 绘制标签
            label = f"{class_name} {confidence:.2f}"
            try:
                text_bbox = draw.textbbox((x1, y1 - 25), label, font=font)
            except:
                text_bbox = (x1, y1 - 25, x1 + 100, y1)
            draw.rectangle(text_bbox, fill=color)
            draw.text((x1, y1 - 25), label, fill=(255, 255, 255), font=font)
        
        # 转换为base64
        buffered = io.BytesIO()
        original_image.save(buffered, format="JPEG")
        annotated_image_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
        
        return {
            "success": True,
            "data": {
                "annotated_image": f"data:image/jpeg;base64,{annotated_image_base64}",
                "defect_count": len(defect_details),
                "filename": record.get('original_filename', 'unknown.jpg')
            }
        }
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@app.get("/api/detection-records/{record_id}/export-detail")
async def export_detection_detail(
    record_id: str,
    format: str = 'json',
    current_user: dict = Depends(get_current_user),
):
    """
    导出单条检测记录的详细信息
    """
    try:
        record = await detection_service.get_detection_record(record_id)
        if not record:
            raise HTTPException(status_code=404, detail="记录不存在")
        
        if format == 'json':
            return {
                "success": True,
                "data": record
            }
        else:
            # 返回CSV格式
            import csv
            import io
            
            output = io.StringIO()
            
            # CSV列定义（包含缺陷详情）
            fieldnames = [
                'id', 'detection_id', 'username', 'original_filename',
                'detection_type', 'defect_count', 'confidence',
                'processing_time', 'status', 'created_at',
                'defect_type', 'defect_confidence', 'defect_x', 'defect_y', 'defect_width', 'defect_height'
            ]
            
            writer = csv.DictWriter(output, fieldnames=fieldnames)
            writer.writeheader()
            
            defect_details = record.get('defect_details', [])
            
            if not defect_details:
                # 如果没有缺陷，只有基本信息
                row = {
                    'id': record.get('id', ''),
                    'detection_id': record.get('detection_id', ''),
                    'username': record.get('username', ''),
                    'original_filename': record.get('original_filename', ''),
                    'detection_type': record.get('detection_type', ''),
                    'defect_count': 0,
                    'confidence': record.get('confidence', 0),
                    'processing_time': record.get('processing_time', 0),
                    'status': record.get('status', ''),
                    'created_at': record.get('created_at', ''),
                    'defect_type': '', 'defect_confidence': '', 'defect_x': '', 'defect_y': '', 'defect_width': '', 'defect_height': ''
                }
                writer.writerow(row)
            else:
                # 每条缺陷一行
                for defect in defect_details:
                    row = {
                        'id': record.get('id', ''),
                        'detection_id': record.get('detection_id', ''),
                        'username': record.get('username', ''),
                        'original_filename': record.get('original_filename', ''),
                        'detection_type': record.get('detection_type', ''),
                        'defect_count': len(defect_details),
                        'confidence': record.get('confidence', 0),
                        'processing_time': record.get('processing_time', 0),
                        'status': record.get('status', ''),
                        'created_at': record.get('created_at', ''),
                        'defect_type': defect.get('class', defect.get('type', '')),
                        'defect_confidence': defect.get('confidence', 0),
                        'defect_x': defect.get('bbox', {}).get('x', defect.get('x', '')),
                        'defect_y': defect.get('bbox', {}).get('y', defect.get('y', '')),
                        'defect_width': defect.get('bbox', {}).get('width', defect.get('width', '')),
                        'defect_height': defect.get('bbox', {}).get('height', defect.get('height', ''))
                    }
                    writer.writerow(row)
            
            csv_content = output.getvalue()
            
            from fastapi.responses import StreamingResponse
            
            return StreamingResponse(
                io.StringIO(csv_content),
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename=detection_detail_{record_id}.csv"}
            )
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ 用户管理API ============

class CreateUserRequest(BaseModel):
    username: str
    password: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    role: str = 'viewer'


class UpdateUserRequest(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


class ResetPasswordRequest(BaseModel):
    new_password: str


@app.get("/api/users")
async def get_users(
    search: Optional[str] = None,
    role: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    current_user: dict = Depends(require_role("admin")),
):
    """获取用户列表"""
    try:
        if not db_service.is_connected():
            raise HTTPException(status_code=500, detail="数据库未连接")
        users = db_service.get_users(search=search, role=role, limit=limit, offset=offset)
        return {"success": True, "data": users, "count": len(users)}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/users")
async def create_user(
    request: CreateUserRequest,
    current_user: dict = Depends(require_role("admin")),
):
    """创建用户"""
    try:
        user_id = db_service.create_user(request.dict())
        if user_id:
            return {"success": True, "data": {"id": user_id}, "message": "用户创建成功"}
        raise HTTPException(status_code=400, detail="用户创建失败")
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/users/{user_id}")
async def update_user(
    user_id: int,
    request: UpdateUserRequest,
    current_user: dict = Depends(require_role("admin")),
):
    """更新用户信息"""
    try:
        update_data = {k: v for k, v in request.dict().items() if v is not None}
        success = db_service.update_user(user_id, update_data)
        if success:
            return {"success": True, "message": "用户更新成功"}
        raise HTTPException(status_code=404, detail="用户不存在或更新失败")
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/users/{user_id}")
async def delete_user(
    user_id: int,
    current_user: dict = Depends(require_role("admin")),
):
    """删除用户"""
    try:
        success = db_service.delete_user(user_id)
        if success:
            return {"success": True, "message": "用户已删除"}
        raise HTTPException(status_code=404, detail="用户不存在或删除失败")
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/api/users/{user_id}/status")
async def toggle_user_status(
    user_id: int,
    current_user: dict = Depends(require_role("admin")),
):
    """切换用户启用/停用状态"""
    try:
        new_status = db_service.toggle_user_status(user_id)
        if new_status is not None:
            return {
                "success": True,
                "data": {"is_active": new_status},
                "message": f"用户已{'启用' if new_status else '停用'}"
            }
        raise HTTPException(status_code=404, detail="用户不存在")
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/api/users/{user_id}/password")
async def reset_password(
    user_id: int,
    request: ResetPasswordRequest,
    current_user: dict = Depends(require_role("admin")),
):
    """重置用户密码"""
    try:
        success = db_service.reset_user_password(user_id, request.new_password)
        if success:
            return {"success": True, "message": "密码重置成功"}
        raise HTTPException(status_code=404, detail="用户不存在")
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ 个人资料API ============

class UpdateProfileRequest(BaseModel):
    display_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    department: Optional[str] = None
    avatar_url: Optional[str] = None
    user_id: Optional[int] = None  # 支持从请求体获取user_id


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    user_id: Optional[int] = None  # 支持从请求体获取user_id


@app.put("/api/profile")
async def update_profile(
    request: UpdateProfileRequest,
    current_user: dict = Depends(get_current_user),
):
    """更新当前用户资料（身份一律以 JWT 为准，忽略请求体中的 user_id）"""
    try:
        if not db_service.is_connected():
            raise HTTPException(status_code=500, detail="数据库未连接")

        # 身份以 JWT 为准，杜绝伪造 user_id 改他人资料
        uid = current_user["user_id"]
        if not uid:
            raise HTTPException(status_code=401, detail="未登录：缺少用户ID")

        update_data = request.dict(exclude_unset=True)
        # 移除user_id字段，不作为更新数据
        update_data.pop('user_id', None)

        # 映射前端字段到数据库字段
        if 'display_name' in update_data:
            update_data['full_name'] = update_data.pop('display_name')

        success = db_service.update_user(uid, update_data)
        if success:
            return {"success": True, "message": "个人资料已更新"}
        raise HTTPException(status_code=404, detail="用户不存在或更新失败")
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/profile/password")
async def change_password(
    request: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user),
):
    """修改当前用户密码（身份一律以 JWT 为准，忽略请求体中的 user_id）"""
    try:
        if not db_service.is_connected():
            raise HTTPException(status_code=500, detail="数据库未连接")

        uid = current_user["user_id"]
        if not uid:
            raise HTTPException(status_code=401, detail="未登录：缺少用户ID")

        # 验证当前密码
        success = db_service.verify_user_password(uid, request.current_password)
        if not success:
            raise HTTPException(status_code=400, detail="当前密码不正确")

        # 更新密码
        success = db_service.reset_user_password(uid, request.new_password)
        if success:
            return {"success": True, "message": "密码修改成功"}
        raise HTTPException(status_code=404, detail="用户不存在")
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/profile/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """上传用户头像（身份一律以 JWT 为准，忽略表单里的 user_id）"""
    try:
        if not db_service.is_connected():
            raise HTTPException(status_code=500, detail="数据库未连接")

        uid = current_user["user_id"]
        user_id = int(uid) if uid and str(uid).isdigit() else None
        if not user_id:
            raise HTTPException(status_code=401, detail="未登录：缺少用户ID")

        # 验证文件类型
        allowed_types = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
        if file.content_type not in allowed_types:
            raise HTTPException(status_code=400, detail="仅支持 JPG、PNG、GIF、WebP 格式")

        # 创建头像目录（使用UPLOAD_DIR确保路径正确）
        avatar_dir = UPLOAD_DIR / "avatars"
        avatar_dir.mkdir(parents=True, exist_ok=True)

        # 生成唯一文件名
        import uuid
        ext = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
        avatar_filename = f"avatar_{user_id}_{uuid.uuid4().hex[:8]}.{ext}"
        avatar_path = avatar_dir / avatar_filename

        # 保存文件
        with open(avatar_path, "wb") as f:
            content = await file.read()
            f.write(content)

        # 更新数据库
        avatar_url = f"/uploads/avatars/{avatar_filename}"
        success = db_service.update_user(user_id, {'avatar_url': avatar_url})

        if success:
            return {"success": True, "message": "头像上传成功", "data": {"avatar_url": avatar_url}}
        raise HTTPException(status_code=404, detail="用户不存在")

    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ 通知API ============

class CreateNotificationRequest(BaseModel):
    user_id: Optional[int] = None
    type: str = 'info'
    title: str
    message: Optional[str] = None
    link: Optional[str] = None


@app.get("/api/notifications")
async def get_notifications(
    user_id: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """获取通知列表（非管理员只能看自己的）"""
    try:
        if not db_service.is_connected():
            raise HTTPException(status_code=500, detail="数据库未连接")

        user_id = _resolve_user_id(user_id, current_user)

        notifications = db_service.get_notifications(user_id=user_id, limit=limit, offset=offset)
        unread_count = db_service.get_unread_count(user_id=user_id)
        return {
            "success": True,
            "data": notifications,
            "count": len(notifications),
            "unread_count": unread_count
        }
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/notifications")
async def create_notification(
    request: CreateNotificationRequest,
    current_user: dict = Depends(get_current_user),
):
    """创建通知（非管理员只能给自己创建）"""
    try:
        if not db_service.is_connected():
            raise HTTPException(status_code=500, detail="数据库未连接")

        payload = request.dict()
        payload['user_id'] = _resolve_user_id(payload.get('user_id'), current_user)

        notification_id = db_service.create_notification(payload)
        if notification_id:
            return {"success": True, "data": {"id": notification_id}, "message": "通知创建成功"}
        raise HTTPException(status_code=400, detail="通知创建失败")
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/api/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: int,
    current_user: dict = Depends(get_current_user),
):
    """标记通知为已读"""
    try:
        success = db_service.mark_notification_read(notification_id)
        if success:
            return {"success": True, "message": "通知已标记为已读"}
        raise HTTPException(status_code=404, detail="通知不存在")
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/api/notifications/read-all")
async def mark_all_notifications_read(
    user_id: Optional[int] = None,
    current_user: dict = Depends(get_current_user),
):
    """标记所有通知为已读（非管理员只影响自己的）"""
    try:
        success = db_service.mark_all_notifications_read(_resolve_user_id(user_id, current_user))
        if success:
            return {"success": True, "message": "所有通知已标记为已读"}
        raise HTTPException(status_code=500, detail="操作失败")
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/notifications/{notification_id}")
async def delete_notification(
    notification_id: int,
    current_user: dict = Depends(get_current_user),
):
    """删除通知"""
    try:
        success = db_service.delete_notification(notification_id)
        if success:
            return {"success": True, "message": "通知已删除"}
        raise HTTPException(status_code=404, detail="通知不存在")
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/notifications")
async def clear_notifications(
    user_id: Optional[int] = None,
    current_user: dict = Depends(get_current_user),
):
    """清除所有通知（非管理员只清自己的）"""
    try:
        success = db_service.clear_notifications(_resolve_user_id(user_id, current_user))
        if success:
            return {"success": True, "message": "通知已清除"}
        raise HTTPException(status_code=500, detail="操作失败")
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/notifications/unread-count")
async def get_unread_count(
    user_id: Optional[int] = None,
    current_user: dict = Depends(get_current_user),
):
    """获取未读通知数量（非管理员只统计自己的）"""
    try:
        count = db_service.get_unread_count(_resolve_user_id(user_id, current_user))
        return {"success": True, "data": {"count": count}}
    except HTTPException:
        # 显式抛出的业务错误（400/401/403/404/503...）原样透传，
        # 不再被统一吞成 500，便于前端给出准确提示
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ 系统状态API ============

@app.get("/api/system/disk")
async def get_disk_usage(current_user: dict = Depends(get_current_user)):
    """获取磁盘使用情况"""
    try:
        import shutil
        usage = shutil.disk_usage('/')
        total_gb = usage.total / (1024 ** 3)
        used_gb = usage.used / (1024 ** 3)
        free_gb = usage.free / (1024 ** 3)
        percent = (usage.used / usage.total) * 100
        
        return {
            "success": True,
            "data": {
                "total": round(total_gb, 1),
                "used": round(used_gb, 1),
                "free": round(free_gb, 1),
                "usage": round(percent, 1)
            }
        }
    except Exception as e:
        return {"success": True, "data": {"usage": 45}}


@app.get("/api/system/status")
async def get_system_status(current_user: dict = Depends(get_current_user)):
    """获取系统运行状态"""
    try:
        import shutil
        import psutil
        usage = shutil.disk_usage('/')
        disk_percent = (usage.used / usage.total) * 100
        
        try:
            cpu_percent = psutil.cpu_percent(interval=0.1)
            memory = psutil.virtual_memory()
            memory_percent = memory.percent
        except:
            cpu_percent = 25
            memory_percent = 40
        
        return {
            "success": True,
            "data": {
                "cpu": round(cpu_percent, 1),
                "memory": round(memory_percent, 1),
                "disk": round(disk_percent, 1),
                "status": "normal"
            }
        }
    except Exception as e:
        return {
            "success": True,
            "data": {
                "cpu": 25,
                "memory": 40,
                "disk": 45,
                "status": "normal"
            }
        }


# ============ 视频转换API ============

def convert_video_to_browser_compatible(input_path: str, output_path: str) -> bool:
    """
    使用 OpenCV 将视频转换为浏览器兼容的 H.264 编码格式
    
    Args:
        input_path: 输入视频路径
        output_path: 输出视频路径
        
    Returns:
        是否转换成功
    """
    import cv2
    
    try:
        # 打开输入视频
        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            print(f"[VideoConverter] Cannot open input video: {input_path}")
            return False
        
        # 获取输入视频信息
        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        print(f"[VideoConverter] Input: {total_frames} frames, {fps:.2f} fps, {width}x{height}")
        
        # 如果视频已经可以被 OpenCV 读取，直接复制（保持原格式）
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')  # 使用 MP4 编码器
        
        out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
        if not out.isOpened():
            print("[VideoConverter] Cannot create output video writer")
            cap.release()
            return False
        
        frame_count = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            out.write(frame)
            frame_count += 1
            
            # 每100帧输出一次进度
            if frame_count % 100 == 0:
                progress = (frame_count / total_frames) * 100 if total_frames > 0 else 0
                print(f"[VideoConverter] Progress: {frame_count}/{total_frames} ({progress:.1f}%)")
        
        cap.release()
        out.release()
        
        print(f"[VideoConverter] Conversion completed: {frame_count} frames")
        return True
        
    except Exception as e:
        print(f"[VideoConverter] Error: {e}")
        return False


@app.post("/api/video/convert")
async def convert_video(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_role("admin", "operator")),
):
    """
    上传视频并转换为浏览器兼容格式
    
    如果视频已经是浏览器兼容格式（H.264 MP4），直接返回原文件。
    否则使用 OpenCV 重新编码为兼容格式。
    
    返回:
        转换后的视频文件路径和URL
    """
    import tempfile
    import shutil
    
    # 保存上传的视频到临时文件
    suffix = Path(file.filename).suffix if file.filename else '.mp4'
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        input_path = tmp.name
    
    # 创建输出目录
    VIDEO_DIR = project_root / "uploads" / "video"
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    
    # 生成输出文件名
    video_id = str(uuid.uuid4().hex[:8])
    original_name = file.filename or 'video.mp4'
    output_filename = f"{video_id}_{original_name}"
    output_path = VIDEO_DIR / output_filename
    
    try:
        print(f"[VideoConverter] Starting conversion for: {file.filename}")
        
        # 尝试转换视频
        success = convert_video_to_browser_compatible(input_path, str(output_path))
        
        if not success:
            raise HTTPException(status_code=500, detail="视频转换失败，请尝试使用其他格式的视频")
        
        # 获取转换后的视频信息
        import cv2
        cap = cv2.VideoCapture(str(output_path))
        if cap.isOpened():
            fps = cap.get(cv2.CAP_PROP_FPS)
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            duration = total_frames / fps if fps > 0 else 0
            cap.release()
        else:
            fps, width, height, total_frames, duration = 0, 0, 0, 0, 0
        
        print(f"[VideoConverter] Conversion successful: {output_path}")
        
        return {
            "success": True,
            "data": {
                "video_id": video_id,
                "filename": output_filename,
                "original_filename": file.filename,
                "path": str(output_path),
                "url": f"/uploads/video/{output_filename}",
                "info": {
                    "total_frames": total_frames,
                    "fps": round(fps, 2),
                    "width": width,
                    "height": height,
                    "duration": round(duration, 2),
                    "size_bytes": os.path.getsize(output_path)
                }
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"视频处理失败: {str(e)}")
    finally:
        # 清理临时文件
        if os.path.exists(input_path):
            os.unlink(input_path)


# ============ 视频抽帧检测API ============

@app.post("/api/video/detect-frame")
async def detect_video_frame(
    file: UploadFile = File(...),
    frame_index: int = Form(0),
    timestamp: float = Form(0),
    confidence_threshold: float = Form(0.5),
    iou_threshold: float = Form(0.45),
    user_id: Optional[str] = Form(None),
    username: Optional[str] = Form(None),
    current_user: dict = Depends(require_role("admin", "operator")),
):
    """
    单帧实时检测API - 用于边播放边检测
    
    接收一帧图片（jpeg/jpg/png），返回YOLO检测结果和带标注的图片。
    支持流式调用，实时返回检测结果。
    
    参数:
        file: 帧图片文件
        frame_index: 帧序号
        timestamp: 时间戳（秒）
        confidence_threshold: 置信度阈值
        iou_threshold: IOU阈值
    """
    import tempfile
    import base64 as b64_mod
    from PIL import Image
    
    if not model_service.is_loaded:
        raise HTTPException(status_code=400, detail="模型未加载，请先加载模型")
    
    try:
        # 保存帧为临时文件
        suffix = Path(file.filename).suffix if file.filename else '.jpg'
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await file.read()
            tmp.write(content)
            frame_path = tmp.name
        
        # 临时更新模型阈值
        old_conf = model_service.confidence_threshold
        old_iou = model_service.iou_threshold
        model_service.set_confidence_threshold(confidence_threshold)
        model_service.set_iou_threshold(iou_threshold)
        
        # 调用模型检测
        result = await model_service.predict_from_path(frame_path, file.filename or f"frame_{frame_index}.jpg")
        detection_result = result.get('result', {})
        detections = detection_result.get('detections', [])
        count = detection_result.get('count', 0)
        
        # 获取标注图片
        annotated_base64 = detection_result.get('annotated_image', '')
        
        # 如果没有标注图，自己画框
        if not annotated_base64:
            import cv2
            img = cv2.imread(frame_path)
            if img is not None:
                for det in detections:
                    bbox = det.get('bbox', {})
                    x1 = int(bbox.get('x', 0))
                    y1 = int(bbox.get('y', 0))
                    x2 = int(x1 + bbox.get('width', 0))
                    y2 = int(y1 + bbox.get('height', 0))
                    class_name = det.get('class', '未知')
                    conf = det.get('confidence', 0)
                    color = (0, 0, 255)
                    cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
                    cv2.putText(img, f"{class_name} {conf:.2f}", (x1, max(0, y1-5)),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
                _, buffer = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 80])
                annotated_base64 = f"data:image/jpeg;base64,{b64_mod.b64encode(buffer).decode('utf-8')}"
        
        # 恢复模型阈值
        model_service.set_confidence_threshold(old_conf)
        model_service.set_iou_threshold(old_iou)
        
        # 清理临时文件
        os.unlink(frame_path)
        
        return {
            "success": True,
            "data": {
                "frame_index": frame_index,
                "timestamp": timestamp,
                "annotated_image": annotated_base64,
                "detections": detections,
                "defect_count": count
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"帧检测失败: {str(e)}")


@app.post("/api/video/detect")
async def video_detect(
    file: UploadFile = File(...),
    frame_interval: int = Form(5),
    max_frames: int = Form(200),
    confidence_threshold: float = Form(0.5),
    iou_threshold: float = Form(0.45),
    user_id: Optional[str] = Form(None),
    username: Optional[str] = Form(None),
    current_user: dict = Depends(require_role("admin", "operator")),
):
    """
    视频抽帧检测

    上传视频文件，后端用 OpenCV 逐帧读取，每 frame_interval 帧做一次 YOLO 检测，
    返回标注后的帧图片列表（base64），前端可直接渲染。

    参数:
        file: 视频文件（支持 .mp4, .avi, .mov, .mkv, .webm 等 OpenCV 可读格式）
        frame_interval: 抽帧间隔（每 N 帧检测一次，默认 5）
        max_frames: 最大返回帧数（默认 200，防止大视频 OOM）
        confidence_threshold: 置信度阈值
        iou_threshold: IOU 阈值
    """
    import cv2
    import tempfile
    import io
    import base64 as b64_mod
    from PIL import Image
    import time

    if not model_service.is_loaded:
        raise HTTPException(status_code=400, detail="模型未加载，请先加载模型")

    # 保存上传的视频到临时文件
    try:
        suffix = Path(file.filename).suffix if file.filename else '.mp4'
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await file.read()
            tmp.write(content)
            video_path = tmp.name
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存视频文件失败: {str(e)}")

    try:
        # 用 OpenCV 打开视频
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            os.unlink(video_path)
            raise HTTPException(status_code=400, detail="无法打开视频文件，格式可能不被 OpenCV 支持")

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        if total_frames <= 0:
            cap.release()
            os.unlink(video_path)
            raise HTTPException(status_code=400, detail="视频文件没有可读帧")

        print(f"🎬 视频信息: {total_frames}帧, {fps:.1f}fps, {width}x{height}, frame_interval={frame_interval}")

        # 临时更新模型阈值
        old_conf = model_service.confidence_threshold
        old_iou = model_service.iou_threshold
        model_service.set_confidence_threshold(confidence_threshold)
        model_service.set_iou_threshold(iou_threshold)

        frames_result = []
        frame_idx = 0
        processed_count = 0
        start_time = time.time()

        while True:
            ret, frame = cap.read()
            if not ret:
                print(f"📹 视频读取完毕，共处理 {frame_idx} 帧")
                break

            # 抽帧：每 frame_interval 帧检测一次
            if frame_idx % frame_interval == 0:
                print(f"🔍 正在处理第 {frame_idx} 帧 (已处理 {processed_count} 帧)...")
                processed_count += 1

                # 保存当前帧为临时图片用于模型检测
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                pil_img = Image.fromarray(frame_rgb)

                # 用 PIL 保存到临时文件，然后调用模型检测
                with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as frame_tmp:
                    pil_img.save(frame_tmp, format='JPEG', quality=85)
                    frame_path = frame_tmp.name

                # 调用模型检测
                try:
                    result = await model_service.predict_from_path(frame_path, f"frame_{frame_idx}.jpg")
                    detection_result = result.get('result', {})

                    detections = detection_result.get('detections', [])
                    count = detection_result.get('count', 0)

                    # 获取标注图片（已含检测框）
                    annotated_base64 = detection_result.get('annotated_image', '')

                    # 如果没有标注图（模型返回了模拟检测但没有标注），自己画框
                    if not annotated_base64:
                        # 使用原始帧自己画标注框
                        draw_frame = frame.copy()
                        for det in detections:
                            bbox = det.get('bbox', {})
                            x1 = int(bbox.get('x', 0))
                            y1 = int(bbox.get('y', 0))
                            x2 = int(x1 + bbox.get('width', 0))
                            y2 = int(y1 + bbox.get('height', 0))
                            class_name = det.get('class', '未知')
                            conf = det.get('confidence', 0)
                            color = (0, 0, 255)
                            cv2.rectangle(draw_frame, (x1, y1), (x2, y2), color, 2)
                            cv2.putText(draw_frame, f"{class_name} {conf:.2f}", (x1, y1-5),
                                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

                        _, buffer = cv2.imencode('.jpg', draw_frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                        annotated_base64 = f"data:image/jpeg;base64,{b64_mod.b64encode(buffer).decode('utf-8')}"

                    frames_result.append({
                        'frame_index': frame_idx,
                        'timestamp': frame_idx / fps if fps > 0 else 0,
                        'annotated_image': annotated_base64,
                        'detections': detections,
                        'defect_count': count
                    })

                    # 限制返回帧数
                    if len(frames_result) >= max_frames:
                        print(f"⏹ 达到最大帧数限制: {max_frames}")
                        break

                except Exception as frame_error:
                    print(f"⚠️ 帧 {frame_idx} 检测失败: {frame_error}")
                finally:
                    # 清理临时帧文件
                    if os.path.exists(frame_path):
                        os.unlink(frame_path)

            frame_idx += 1

            # 进度日志（每处理10%输出一次）
            if total_frames > 0 and frame_idx % max(1, total_frames // 10) == 0:
                progress = int(frame_idx / total_frames * 100)
                print(f"📊 视频处理进度: {progress}% ({frame_idx}/{total_frames})")

        cap.release()

        # 恢复模型阈值
        model_service.set_confidence_threshold(old_conf)
        model_service.set_iou_threshold(old_iou)

        elapsed = time.time() - start_time
        print(f"✅ 视频抽帧检测完成: {processed_count}帧检测, 耗时{elapsed:.1f}s")

        # 保存检测记录到 camera_detections 表
        if db_service.is_connected() and len(frames_result) > 0:
            try:
                import base64
                for frame_result in frames_result:
                    frame_index = frame_result.get('frame_index', 0)
                    detections = frame_result.get('detections', [])
                    defect_count = frame_result.get('defect_count', 0)
                    
                    # 保存标注图片（如果有）
                    result_image_url = ""
                    annotated_base64 = frame_result.get('annotated_image', '')
                    if annotated_base64 and annotated_base64.startswith('data:image'):
                        try:
                            annotated_data = annotated_base64.split(',')[1]
                            annotated_bytes = base64.b64decode(annotated_data)
                            
                            # 保存到文件
                            camera_subdir = get_upload_subdir('video')
                            annotated_filename = f"video_frame_{frame_index}_{int(time.time())}.jpg"
                            annotated_path = camera_subdir / annotated_filename
                            with open(annotated_path, "wb") as f:
                                f.write(annotated_bytes)
                            
                            rel_path = annotated_path.relative_to(UPLOAD_DIR)
                            result_image_url = f"/uploads/{rel_path.as_posix()}"
                        except Exception as save_error:
                            print(f"⚠️ 保存标注图片失败: {save_error}")
                    
                    # 构建记录数据
                    log_data = {
                        # 身份以 JWT 为准，避免伪造 user_id 把记录挂到别人名下
                        'user_id': int(current_user["user_id"]) if str(current_user.get("user_id") or "").isdigit() else None,
                        'source_type': 'video',
                        'source_name': file.filename or 'unknown',
                        'defect_type': detections[0].get('class', 'unknown') if detections else 'normal',
                        'confidence': detections[0].get('confidence', 0) if detections else 0,
                        'severity': 'warning' if detections else 'info',
                        'message': f"视频帧 {frame_index}: 检测到 {defect_count} 个缺陷",
                        'image_url': result_image_url,
                        'bbox': detections[0].get('bbox') if detections else None
                    }
                    
                    # 保存到 camera_detections 表
                    await detection_service.create_camera_log(log_data)
                
                print(f"✅ 已保存 {len(frames_result)} 条视频检测记录到数据库")
            except Exception as db_error:
                print(f"⚠️ 保存视频检测记录失败: {db_error}")

        # 清理视频临时文件
        os.unlink(video_path)

        return {
            "success": True,
            "data": {
                "video_info": {
                    "total_frames": total_frames,
                    "fps": round(fps, 1),
                    "width": width,
                    "height": height,
                    "duration": round(total_frames / fps, 1) if fps > 0 else 0
                },
                "frames": frames_result,
                "total_detected": len(frames_result),
                "processing_time": round(elapsed, 2),
                "frame_interval": frame_interval
            }
        }

    except HTTPException:
        # 清理临时文件
        if os.path.exists(video_path):
            os.unlink(video_path)
        raise
    except Exception as e:
        if os.path.exists(video_path):
            os.unlink(video_path)
        raise HTTPException(status_code=500, detail=f"视频处理失败: {str(e)}")


# 视频实时流处理状态管理
video_stream_sessions: Dict[str, Dict] = {}


def _get_owned_session(session_id: str, current_user: dict) -> Dict:
    """按 session_id 取会话并校验归属（管理员可访问全部，其他人只能访问自己的）"""
    session = video_stream_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在或已过期")
    if current_user.get("role") != "admin" and str(session.get('owner')) != str(current_user.get("user_id")):
        raise HTTPException(status_code=403, detail="无权访问该会话")
    return session


@app.post("/api/video/realtime/start")
async def start_video_realtime(
    file: UploadFile = File(...),
    confidence_threshold: float = Form(0.5),
    iou_threshold: float = Form(0.45),
    user_id: Optional[str] = Form(None),
    username: Optional[str] = Form(None),
    current_user: dict = Depends(require_role("admin", "operator")),
):
    """
    启动视频实时检测会话
    
    上传视频文件，后端用 OpenCV 打开并保存会话状态。
    前端需要轮询 /api/video/realtime/frame 获取每帧的检测结果。
    
    返回:
        session_id: 会话ID，用于后续轮询
        video_info: 视频基本信息
    """
    import cv2
    import tempfile
    import threading
    import time as time_module
    
    # 检查模型是否加载
    if not model_service.is_loaded:
        raise HTTPException(status_code=400, detail="模型未加载，请先加载模型")
    
    try:
        # 保存上传的视频到临时文件
        suffix = Path(file.filename).suffix if file.filename else '.mp4'
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await file.read()
            tmp.write(content)
            video_path = tmp.name
        
        # 用 OpenCV 打开视频
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            os.unlink(video_path)
            raise HTTPException(status_code=400, detail="无法打开视频文件")
        
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration = total_frames / fps if fps > 0 else 0
        
        if total_frames <= 0:
            cap.release()
            os.unlink(video_path)
            raise HTTPException(status_code=400, detail="视频文件没有可读帧")
        
        cap.release()  # 释放，稍后由处理线程使用
        
        # 创建会话
        session_id = str(uuid.uuid4().hex[:8])
        session = {
            'session_id': session_id,
            'video_path': video_path,
            'video_filename': file.filename,
            'confidence_threshold': confidence_threshold,
            'iou_threshold': iou_threshold,
            'user_id': user_id,
            'username': username,
            'total_frames': total_frames,
            'fps': fps,
            'width': width,
            'height': height,
            'duration': duration,
            'current_frame': 0,
            'is_playing': False,
            'is_processing': False,
            'last_frame_data': None,
            'last_detections': [],
            'last_defect_count': 0,
            'created_at': datetime.now().isoformat()
        }
        
        # 绑定会话归属，防止其他人拿 session_id 串会话
        session['owner'] = str(current_user["user_id"])
        video_stream_sessions[session_id] = session

        print(f"[VideoRealtime] Session started: {session_id}, {total_frames} frames, {fps:.1f}fps, {width}x{height}")
        
        return {
            "success": True,
            "data": {
                "session_id": session_id,
                "video_info": {
                    "total_frames": total_frames,
                    "fps": round(fps, 2),
                    "width": width,
                    "height": height,
                    "duration": round(duration, 2),
                    "filename": file.filename
                }
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"启动视频会话失败: {str(e)}")


@app.get("/api/video/realtime/frame")
async def get_video_realtime_frame(
    session_id: str,
    action: str = 'get',  # 'get' | 'play' | 'pause' | 'seek'
    frame_index: int = 0,
    current_user: dict = Depends(require_role("admin", "operator")),
):
    """
    获取视频实时检测帧
    
    参数:
        session_id: 会话ID
        action: 操作类型
            - 'get': 获取当前帧（不改变播放状态）
            - 'play': 开始/继续播放
            - 'pause': 暂停播放
            - 'seek': 跳转到指定帧
        frame_index: 当 action='seek' 时指定跳转的帧号
    
    返回:
        frame_data: base64编码的帧图片
        detections: 检测结果列表
        current_frame: 当前帧号
        is_playing: 是否正在播放
    """
    import cv2
    import base64 as b64_mod
    import time as time_module
    
    session = _get_owned_session(session_id, current_user)
    video_path = session['video_path']

    # 检查视频文件是否存在
    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="视频文件不存在")
    
    cap = None
    try:
        # 处理操作
        if action == 'pause':
            session['is_playing'] = False
            return {
                "success": True,
                "data": {
                    "current_frame": session['current_frame'],
                    "is_playing": False,
                    "message": "已暂停"
                }
            }
        
        elif action == 'seek':
            cap = cv2.VideoCapture(video_path)
            if not cap.isOpened():
                raise HTTPException(status_code=500, detail="无法打开视频")
            session['current_frame'] = max(0, min(frame_index, session['total_frames'] - 1))
            cap.set(cv2.CAP_PROP_POS_FRAMES, session['current_frame'])
            cap.release()
            cap = None
            return {
                "success": True,
                "data": {
                    "current_frame": session['current_frame'],
                    "is_playing": session['is_playing'],
                    "message": f"已跳转到第 {session['current_frame']} 帧"
                }
            }
        
        elif action == 'play':
            session['is_playing'] = True
        
        # 如果正在播放，读取下一帧
        if session['is_playing']:
            if session['current_frame'] >= session['total_frames'] - 1:
                # 循环播放：重置到开头
                session['current_frame'] = 0
                return {
                    "success": True,
                    "data": {
                        "current_frame": 0,
                        "total_frames": session['total_frames'],
                        "fps": session['fps'],
                        "timestamp": 0,
                        "is_playing": True,  # 继续播放，不停止
                        "frame_data": None,  # 第一帧会在下一轮返回
                        "detections": [],
                        "defect_count": 0,
                        "video_width": session['width'],
                        "video_height": session['height'],
                        "message": "视频循环播放"
                    }
                }
        
        # 读取当前帧
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise HTTPException(status_code=500, detail="无法打开视频")
        
        cap.set(cv2.CAP_PROP_POS_FRAMES, session['current_frame'])
        ret, frame = cap.read()
        
        if not ret:
            session['is_playing'] = False
            cap.release()
            return {
                "success": True,
                "data": {
                    "current_frame": session['current_frame'],
                    "is_playing": False,
                    "frame_data": None,
                    "detections": [],
                    "defect_count": 0,
                    "message": "视频播放完毕"
                }
            }
        
        # 更新帧号
        current_frame = session['current_frame']
        session['current_frame'] += 1
        
        cap.release()
        cap = None
        
        # 临时更新模型阈值
        old_conf = model_service.confidence_threshold
        old_iou = model_service.iou_threshold
        model_service.set_confidence_threshold(session['confidence_threshold'])
        model_service.set_iou_threshold(session['iou_threshold'])
        
        # 保存帧为临时图片用于检测
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as tmp:
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            from PIL import Image
            pil_img = Image.fromarray(frame_rgb)
            pil_img.save(tmp, format='JPEG', quality=85)
            frame_path = tmp.name
        
        try:
            # 调用模型检测
            result = await model_service.predict_from_path(frame_path, f"frame_{current_frame}.jpg")
            detection_result = result.get('result', {})
            detections = detection_result.get('detections', [])
            defect_count = detection_result.get('count', len(detections))
            
            # 获取带标注的图片
            annotated_base64 = detection_result.get('annotated_image', '')
            
            # 如果模型没有返回标注图，使用原始帧自己画框
            if not annotated_base64:
                # 使用原始帧画框
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                draw_frame = frame.copy()
                
                color_map = {
                    '凸起': (239, 68, 68),
                    '焊缝': (59, 130, 246),
                    '裂纹': (249, 115, 22),
                    '腐蚀': (245, 158, 11),
                    '点蚀': (139, 92, 246),
                    '划痕': (6, 182, 212),
                    '凹痕': (236, 72, 153),
                    'crack': (249, 115, 22),
                    'corrosion': (245, 158, 11),
                    'pitting': (139, 92, 246),
                    'scratch': (6, 182, 212)
                }
                for det in detections:
                    bbox = det.get('bbox', {})
                    x1 = int(bbox.get('x', 0))
                    y1 = int(bbox.get('y', 0))
                    w = int(bbox.get('width', 0))
                    h = int(bbox.get('height', 0))
                    x2 = x1 + w
                    y2 = y1 + h
                    class_name = det.get('class', '未知')
                    conf = det.get('confidence', 0)
                    color = color_map.get(class_name, (239, 68, 68))
                    cv2.rectangle(draw_frame, (x1, y1), (x2, y2), color, 2)
                    label = f"{class_name} {conf:.2f}"
                    cv2.putText(draw_frame, label, (x1, max(20, y1-5)),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
                
                # 转换为 JPEG base64
                _, buffer = cv2.imencode('.jpg', draw_frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                annotated_base64 = f"data:image/jpeg;base64,{b64_mod.b64encode(buffer).decode('utf-8')}"
            
            # 如果没有检测结果，仍然返回原始帧图片
            if not annotated_base64 and detections:
                # 这段不会执行，因为上面已经处理了
                pass
            
            # 更新会话状态
            session['last_frame_data'] = annotated_base64
            session['last_detections'] = detections
            session['last_defect_count'] = defect_count
            
            # 计算时间戳
            timestamp = current_frame / session['fps'] if session['fps'] > 0 else 0
            
            return {
                "success": True,
                "data": {
                    "current_frame": current_frame,
                    "total_frames": session['total_frames'],
                    "fps": session['fps'],
                    "timestamp": round(timestamp, 3),
                    "is_playing": session['is_playing'],
                    "frame_data": annotated_base64,  # 带标注的帧图片
                    "detections": detections,
                    "defect_count": defect_count,
                    "video_width": session['width'],
                    "video_height": session['height']
                }
            }
            
        finally:
            # 清理临时文件
            if os.path.exists(frame_path):
                os.unlink(frame_path)
            # 恢复模型阈值
            model_service.set_confidence_threshold(old_conf)
            model_service.set_iou_threshold(old_iou)
        
    except HTTPException:
        raise
    except Exception as e:
        if cap:
            cap.release()
        raise HTTPException(status_code=500, detail=f"获取帧失败: {str(e)}")


@app.post("/api/video/realtime/stop")
async def stop_video_realtime(
    session_id: Optional[str] = None,
    body: Optional[dict] = None,
    current_user: dict = Depends(require_role("admin", "operator")),
):
    """
    停止视频实时检测会话
    
    清理会话资源，删除临时视频文件。
    
    支持两种方式：
    1. query参数: POST /api/video/realtime/stop?session_id=xxx
    2. JSON body: POST /api/video/realtime/stop {"session_id": "xxx"}
    """
    # 优先从query参数获取，其次从body获取
    actual_session_id = session_id
    if not actual_session_id and body and 'session_id' in body:
        actual_session_id = body['session_id']

    if not actual_session_id:
        raise HTTPException(status_code=400, detail="缺少 session_id 参数")

    # 校验会话归属（管理员可停任意会话）
    session = _get_owned_session(actual_session_id, current_user)
    video_path = session.get('video_path')
    
    # 标记会话为停止
    session['is_processing'] = False
    session['is_playing'] = False
    
    # 删除临时视频文件
    if video_path and os.path.exists(video_path):
        try:
            os.unlink(video_path)
            print(f"[VideoRealtime] Deleted temp video: {video_path}")
        except Exception as e:
            print(f"[VideoRealtime] Failed to delete temp video: {e}")
    
    # 删除会话（修复：原代码用未校验的 session_id，body 传参时会 KeyError）
    del video_stream_sessions[actual_session_id]
    
    return {
        "success": True,
        "message": f"会话 {actual_session_id} 已停止"
    }


@app.get("/api/video/realtime/status")
async def get_video_realtime_status(
    session_id: str,
    current_user: dict = Depends(require_role("admin", "operator")),
):
    """
    获取视频实时检测会话状态
    """
    session = _get_owned_session(session_id, current_user)
    
    return {
        "success": True,
        "data": {
            "session_id": session_id,
            "current_frame": session['current_frame'],
            "total_frames": session['total_frames'],
            "fps": session['fps'],
            "is_playing": session['is_playing'],
            "is_processing": session['is_processing'],
            "last_defect_count": session['last_defect_count']
        }
    }


if __name__ == "__main__":
    import uvicorn
    # 默认端口与 start.bat / start.sh 及前端 webpack 代理保持一致（8002）
    port = int(os.getenv('PORT', '8002'))
    uvicorn.run(app, host="0.0.0.0", port=port)
