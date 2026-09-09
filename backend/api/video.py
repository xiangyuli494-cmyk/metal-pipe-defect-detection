"""
视频边播边检 API 路由
支持 WebSocket 实时推流和 REST API 控制
"""
import os
import sys
import json
import base64
import asyncio
import uuid
import time
from pathlib import Path
from typing import Optional, Dict, Any, List
from datetime import datetime

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import JSONResponse

# 添加项目根目录
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.services.model_service import ModelService
from backend.services.database_service import db_service

router = APIRouter(prefix="/api/video", tags=["视频检测"])

# WebSocket 连接管理器
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.controllers: Dict[str, Dict[str, Any]] = {}
    
    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket
        self.controllers[client_id] = {
            "is_playing": False,
            "current_frame": 0,
            "total_frames": 0,
            "fps": 0,
            "video_path": None,
            "last_detection": None,
            "skip_frames": 3
        }
    
    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
        if client_id in self.controllers:
            del self.controllers[client_id]
    
    async def send_json(self, client_id: str, data: dict):
        if client_id in self.active_connections:
            await self.active_connections[client_id].send_json(data)
    
    async def broadcast(self, data: dict):
        for connection in self.active_connections.values():
            try:
                await connection.send_json(data)
            except:
                pass
    
    def get_controller(self, client_id: str) -> Optional[Dict]:
        return self.controllers.get(client_id)


manager = ConnectionManager()
model_service = ModelService()


@router.get("/status")
async def get_video_detection_status():
    """获取视频检测服务状态"""
    return {
        "success": True,
        "data": {
            "model_loaded": model_service.is_loaded,
            "active_connections": len(manager.active_connections),
            "server_time": datetime.now().isoformat()
        }
    }


@router.post("/upload")
async def upload_video(
    file: UploadFile = File(...),
    user_id: Optional[str] = Form(None),
    username: Optional[str] = Form(None)
):
    """上传视频文件，返回视频信息和预签名URL"""
    import tempfile
    import shutil
    
    # 验证文件类型
    allowed_extensions = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.mpg']
    file_ext = Path(file.filename).suffix.lower() if file.filename else '.mp4'
    
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400, 
            detail=f"不支持的视频格式: {file_ext}"
        )
    
    # 保存上传的视频
    VIDEO_DIR = project_root / "uploads" / "video"
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    
    video_id = str(uuid.uuid4().hex[:8])
    video_filename = f"{video_id}_{file.filename or 'video.mp4'}"
    video_path = VIDEO_DIR / video_filename
    
    try:
        content = await file.read()
        with open(video_path, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存视频失败: {str(e)}")
    
    # 获取视频信息
    import cv2
    try:
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise HTTPException(status_code=400, detail="无法读取视频文件")
        
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration = total_frames / fps if fps > 0 else 0
        cap.release()
    except Exception as e:
        os.unlink(video_path)
        raise HTTPException(status_code=500, detail=f"读取视频信息失败: {str(e)}")
    
    return {
        "success": True,
        "data": {
            "video_id": video_id,
            "filename": video_filename,
            "original_filename": file.filename,
            "path": str(video_path),
            "url": f"/uploads/video/{video_filename}",
            "info": {
                "total_frames": total_frames,
                "fps": round(fps, 2),
                "width": width,
                "height": height,
                "duration": round(duration, 2),
                "size_bytes": os.path.getsize(video_path)
            },
            "user_id": user_id,
            "username": username
        }
    }


@router.post("/frame")
async def detect_frame(
    file: UploadFile = File(...),
    frame_index: int = Form(0),
    timestamp: float = Form(0),
    video_id: Optional[str] = Form(None),
    confidence_threshold: float = Form(0.5),
    iou_threshold: float = Form(0.45)
):
    """单帧检测接口 - 边播边检的核心接口"""
    import tempfile
    
    if not model_service.is_loaded:
        raise HTTPException(status_code=400, detail="模型未加载")
    
    try:
        suffix = Path(file.filename).suffix if file.filename else '.jpg'
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await file.read()
            tmp.write(content)
            frame_path = tmp.name
        
        # 临时更新阈值
        old_conf = model_service.confidence_threshold
        old_iou = model_service.iou_threshold
        model_service.set_confidence_threshold(confidence_threshold)
        model_service.set_iou_threshold(iou_threshold)
        
        result = await model_service.predict_from_path(frame_path, file.filename or f"frame_{frame_index}.jpg")
        
        model_service.set_confidence_threshold(old_conf)
        model_service.set_iou_threshold(old_iou)
        
        os.unlink(frame_path)
        
        detection_data = result.get('result', {})
        detections = detection_data.get('detections', [])
        
        return {
            "success": True,
            "data": {
                "frame_index": frame_index,
                "timestamp": timestamp,
                "video_id": video_id,
                "detections": detections,
                "defect_count": len(detections),
                "annotated_image": detection_data.get('annotated_image', '')
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"帧检测失败: {str(e)}")


@router.post("/batch-frames")
async def detect_batch_frames(
    files: List[UploadFile] = File(...),
    start_index: int = Form(0),
    frame_interval: int = Form(1),
    confidence_threshold: float = Form(0.5),
    iou_threshold: float = Form(0.45)
):
    """批量帧检测接口"""
    import tempfile
    
    if not model_service.is_loaded:
        raise HTTPException(status_code=400, detail="模型未加载")
    
    results = []
    
    old_conf = model_service.confidence_threshold
    old_iou = model_service.iou_threshold
    model_service.set_confidence_threshold(confidence_threshold)
    model_service.set_iou_threshold(iou_threshold)
    
    for i, file in enumerate(files):
        try:
            frame_index = start_index + i * frame_interval
            
            with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as tmp:
                content = await file.read()
                tmp.write(content)
                frame_path = tmp.name
            
            result = await model_service.predict_from_path(frame_path, file.filename or f"frame_{frame_index}.jpg")
            
            detection_data = result.get('result', {})
            
            results.append({
                "frame_index": frame_index,
                "detections": detection_data.get('detections', []),
                "defect_count": detection_data.get('count', 0),
                "annotated_image": detection_data.get('annotated_image', '')
            })
            
            os.unlink(frame_path)
            
        except Exception as e:
            results.append({
                "frame_index": start_index + i * frame_interval,
                "error": str(e),
                "detections": [],
                "defect_count": 0
            })
    
    model_service.set_confidence_threshold(old_conf)
    model_service.set_iou_threshold(old_iou)
    
    return {
        "success": True,
        "data": {
            "frames": results,
            "total_frames": len(results),
            "total_detections": sum(r.get('defect_count', 0) for r in results)
        }
    }


@router.get("/frames/{video_id}")
async def get_video_frames(
    video_id: str,
    start_frame: int = Query(0),
    end_frame: Optional[int] = Query(None),
    frame_interval: int = Query(1),
    confidence_threshold: float = Query(0.5)
):
    """从指定视频中提取帧并检测"""
    import cv2
    
    VIDEO_DIR = project_root / "uploads" / "video"
    video_files = list(VIDEO_DIR.glob(f"{video_id}_*"))
    
    if not video_files:
        raise HTTPException(status_code=404, detail="视频文件不存在")
    
    video_path = str(video_files[0])
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail="无法打开视频")
    
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    
    if end_frame is None:
        end_frame = total_frames - 1
    
    old_conf = model_service.confidence_threshold
    model_service.set_confidence_threshold(confidence_threshold)
    
    results = []
    frame_idx = start_frame
    
    while frame_idx <= end_frame:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        
        if not ret:
            break
        
        import tempfile
        temp_path = tempfile.mktemp(suffix='.jpg')
        cv2.imwrite(temp_path, frame)
        
        try:
            result = await model_service.predict_from_path(temp_path, f"frame_{frame_idx}.jpg")
            detection_data = result.get('result', {})
            
            results.append({
                "frame_index": frame_idx,
                "timestamp": frame_idx / fps if fps > 0 else 0,
                "detections": detection_data.get('detections', []),
                "defect_count": detection_data.get('count', 0),
                "annotated_image": detection_data.get('annotated_image', '')
            })
        except Exception as e:
            results.append({
                "frame_index": frame_idx,
                "timestamp": frame_idx / fps if fps > 0 else 0,
                "error": str(e),
                "detections": [],
                "defect_count": 0
            })
        
        os.unlink(temp_path)
        frame_idx += frame_interval
    
    cap.release()
    model_service.set_confidence_threshold(old_conf)
    
    return {
        "success": True,
        "data": {
            "video_id": video_id,
            "frames": results,
            "total_analyzed": len(results),
            "total_detections": sum(r.get('defect_count', 0) for r in results)
        }
    }


@router.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    """WebSocket 实时视频检测接口"""
    await manager.connect(websocket, client_id)
    controller = manager.get_controller(client_id)
    
    try:
        await manager.send_json(client_id, {
            "type": "connected",
            "client_id": client_id,
            "model_loaded": model_service.is_loaded,
            "timestamp": time.time()
        })
        
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "")
            
            if msg_type == "frame":
                if not model_service.is_loaded:
                    await manager.send_json(client_id, {
                        "type": "error",
                        "message": "模型未加载"
                    })
                    continue
                
                try:
                    image_data = data.get("image", "")
                    if image_data.startswith("data:image"):
                        image_data = image_data.split(",")[1]
                    
                    import tempfile
                    img_bytes = base64.b64decode(image_data)
                    temp_path = tempfile.mktemp(suffix=".jpg")
                    
                    with open(temp_path, "wb") as f:
                        f.write(img_bytes)
                    
                    frame_index = data.get("frame_index", 0)
                    timestamp = data.get("timestamp", 0.0)
                    
                    result = await model_service.predict_from_path(
                        temp_path, 
                        f"frame_{frame_index}.jpg"
                    )
                    
                    detection_data = result.get('result', {})
                    
                    await manager.send_json(client_id, {
                        "type": "detection",
                        "frame_index": frame_index,
                        "timestamp": timestamp,
                        "detections": detection_data.get('detections', []),
                        "defect_count": detection_data.get('count', 0),
                        "annotated_image": detection_data.get('annotated_image', '')
                    })
                    
                    os.unlink(temp_path)
                    
                except Exception as e:
                    await manager.send_json(client_id, {
                        "type": "error",
                        "message": f"检测失败: {str(e)}"
                    })
            
            elif msg_type == "config":
                if "skip_frames" in data:
                    controller["skip_frames"] = data["skip_frames"]
                await manager.send_json(client_id, {
                    "type": "config_updated",
                    "config": controller
                })
            
            elif msg_type == "ping":
                await manager.send_json(client_id, {
                    "type": "pong",
                    "timestamp": time.time()
                })
            
            else:
                await manager.send_json(client_id, {
                    "type": "error",
                    "message": f"未知命令: {msg_type}"
                })
    
    except WebSocketDisconnect:
        manager.disconnect(client_id)
    except Exception as e:
        manager.disconnect(client_id)


@router.post("/save-detection")
async def save_video_detection(
    video_id: str = Form(...),
    frame_index: int = Form(...),
    detections: str = Form(...),
    image: Optional[UploadFile] = File(None),
    user_id: Optional[str] = Form(None),
    username: Optional[str] = Form(None)
):
    """保存视频检测结果到数据库"""
    try:
        detection_list = json.loads(detections)
        
        image_url = ""
        if image:
            VIDEO_DIR = project_root / "uploads" / "video"
            VIDEO_DIR.mkdir(parents=True, exist_ok=True)
            
            filename = f"{video_id}_frame_{frame_index}_{uuid.uuid4().hex[:8]}.jpg"
            image_path = VIDEO_DIR / filename
            
            content = await image.read()
            with open(image_path, "wb") as f:
                f.write(content)
            
            image_url = f"/uploads/video/{filename}"
        
        if db_service.is_connected():
            from backend.services.detection_service import DetectionService
            detection_service = DetectionService()
            
            log_data = {
                'user_id': int(user_id) if user_id and user_id.isdigit() else None,
                'username': username,
                'source_type': 'video',
                'source_name': video_id,
                'defect_type': detection_list[0].get('class', 'unknown') if detection_list else 'normal',
                'confidence': detection_list[0].get('confidence', 0) if detection_list else 0,
                'severity': 'warning' if detection_list else 'info',
                'message': f"视频 {video_id} 第 {frame_index} 帧: 检测到 {len(detection_list)} 个缺陷",
                'image_url': image_url,
                'bbox': detection_list[0].get('bbox') if detection_list else None
            }
            
            log = await detection_service.create_camera_log(log_data)
            
            return {
                "success": True,
                "data": {
                    "log_id": log.get('id') if log else None,
                    "image_url": image_url,
                    "detection_count": len(detection_list)
                }
            }
        
        return {
            "success": True,
            "data": {
                "image_url": image_url,
                "detection_count": len(detection_list)
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
