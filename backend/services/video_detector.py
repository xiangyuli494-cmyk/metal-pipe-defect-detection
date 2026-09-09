"""
视频边播边检模块
基于 OpenCV + Ultralytics YOLO 实现视频文件的实时检测功能
"""
import os
import sys
import time
import json
import base64
import threading
import hashlib
from datetime import datetime
from pathlib import Path
from queue import Queue, Empty
from typing import Optional, Dict, List, Any, Callable
from dataclasses import dataclass, asdict
import cv2
import numpy as np

# 外部YOLO环境配置
_ULTRALYTICS_PATH = os.environ.get('ULTRALYTICS_PATH', '')
if _ULTRALYTICS_PATH:
    # 如果路径是相对路径，相对于 backend/ 目录解析
    _p = Path(_ULTRALYTICS_PATH)
    if not _p.is_absolute():
        _backend_dir = Path(__file__).parent.parent
        _ULTRALYTICS_PATH = str(_backend_dir / _p)
    if _ULTRALYTICS_PATH not in sys.path:
        sys.path.insert(0, _ULTRALYTICS_PATH)

from ultralytics import YOLO


@dataclass
class DetectionResult:
    """检测结果数据类"""
    frame_idx: int
    timestamp: float
    boxes: List[List[float]]  # [[x1, y1, x2, y2], ...]
    classes: List[int]
    scores: List[float]
    labels: List[str]


@dataclass
class DetectionEvent:
    """检测事件（用于历史记录保存）"""
    frame_idx: int
    timestamp: str
    class_name: str
    confidence: float
    bbox: List[float]
    image_path: str
    event_id: str  # 用于去重


class VideoStream:
    """视频解码、帧读取、进度控制"""
    
    def __init__(self, video_path: str):
        self.video_path = video_path
        self.cap: Optional[cv2.VideoCapture] = None
        self.total_frames: int = 0
        self.fps: float = 0.0
        self.current_frame: int = 0
        self.is_playing: bool = False
        self._lock = threading.Lock()
        
    def open(self) -> bool:
        """打开视频文件"""
        self.cap = cv2.VideoCapture(self.video_path)
        if not self.cap.isOpened():
            return False
        self.total_frames = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.fps = self.cap.get(cv2.CAP_PROP_FPS)
        self.current_frame = 0
        return True
    
    def release(self):
        """释放视频资源"""
        with self._lock:
            if self.cap:
                self.cap.release()
                self.cap = None
    
    def read_frame(self) -> Optional[np.ndarray]:
        """读取当前帧"""
        with self._lock:
            if not self.cap or not self.is_playing:
                return None
            
            ret, frame = self.cap.read()
            if not ret:
                self.is_playing = False
                return None
            
            self.current_frame += 1
            return frame
    
    def seek(self, frame_idx: int):
        """跳转到指定帧"""
        with self._lock:
            if self.cap:
                self.cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
                self.current_frame = frame_idx
    
    def play(self):
        """开始播放"""
        with self._lock:
            if self.cap:
                self.is_playing = True
    
    def pause(self):
        """暂停播放"""
        with self._lock:
            self.is_playing = False
    
    def stop(self):
        """停止播放"""
        with self._lock:
            self.is_playing = False
            if self.cap:
                self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                self.current_frame = 0
    
    def get_frame_at(self, idx: int) -> Optional[np.ndarray]:
        """获取指定帧（不改变播放位置）"""
        with self._lock:
            if not self.cap:
                return None
            original_pos = int(self.cap.get(cv2.CAP_PROP_POS_FRAMES))
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ret, frame = self.cap.read()
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, original_pos)
            return frame if ret else None


class Drawer:
    """检测框绘制、标签渲染"""
    
    def __init__(self, 
                 box_color: tuple = (0, 255, 0),
                 text_color: tuple = (255, 255, 255),
                 thickness: int = 2,
                 font: int = cv2.FONT_HERSHEY_SIMPLEX,
                 font_scale: float = 0.6):
        self.box_color = box_color
        self.text_color = text_color
        self.thickness = thickness
        self.font = font
        self.font_scale = font_scale
    
    def draw_detection(self, frame: np.ndarray, 
                      boxes: List[List[float]], 
                      labels: List[str],
                      scores: List[float]) -> np.ndarray:
        """绘制检测结果"""
        result = frame.copy()
        h, w = frame.shape[:2]
        
        for box, label, score in zip(boxes, labels, scores):
            x1, y1, x2, y2 = map(int, box)
            
            # 绘制边界框
            cv2.rectangle(result, (x1, y1), (x2, y2), self.box_color, self.thickness)
            
            # 绘制标签背景
            text = f"{label} {score:.2f}"
            (text_w, text_h), _ = cv2.getTextSize(text, self.font, self.font_scale, 1)
            cv2.rectangle(result, (x1, y1 - text_h - 10), (x1 + text_w, y1), 
                         self.box_color, -1)
            
            # 绘制标签文字
            cv2.putText(result, text, (x1, y1 - 5), 
                       self.font, self.font_scale, self.text_color, 1)
        
        return result
    
    def draw_progress(self, frame: np.ndarray, 
                     current: int, total: int,
                     fps: float) -> np.ndarray:
        """绘制进度条和FPS"""
        h, w = frame.shape[:2]
        bar_height = 30
        
        # 底部半透明黑色条
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, h - bar_height), (w, h), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.7, frame, 0.3, 0, frame)
        
        # 进度条
        progress = current / max(total, 1)
        bar_width = int(w * progress)
        cv2.rectangle(frame, (0, h - 5), (bar_width, h), (0, 255, 0), -1)
        
        # 文字信息
        cv2.putText(frame, f"{current}/{total} ({fps:.1f} FPS)", 
                   (10, h - 10), self.font, 0.5, (255, 255, 255), 1)
        
        return frame


class HistoryManager:
    """帧保存、日志记录、去重判断"""
    
    def __init__(self, save_dir: str = "history", 
                 dedup_window_ms: float = 500,
                 min_confidence: float = 0.25):
        self.save_dir = Path(save_dir)
        self.save_dir.mkdir(parents=True, exist_ok=True)
        self.dedup_window_ms = dedup_window_ms
        self.min_confidence = min_confidence
        self._cache: Dict[str, float] = {}  # event_id -> timestamp
        self._lock = threading.Lock()
        self._log_file = self.save_dir / "detection_log.jsonl"
    
    def _generate_event_id(self, class_name: str, bbox: List[float]) -> str:
        """生成事件ID用于去重"""
        # 按网格划分位置，减少精度问题
        grid_x = int(bbox[0] // 50)
        grid_y = int(bbox[1] // 50)
        key = f"{class_name}_{grid_x}_{grid_y}"
        return hashlib.md5(key.encode()).hexdigest()[:8]
    
    def _is_duplicate(self, event_id: str) -> bool:
        """检查是否为重复事件"""
        now = time.time() * 1000
        with self._lock:
            # 清理过期缓存
            expired = [k for k, v in self._cache.items() if now - v > self.dedup_window_ms]
            for k in expired:
                del self._cache[k]
            
            if event_id in self._cache:
                return True
            
            self._cache[event_id] = now
            return False
    
    def save_frame(self, frame: np.ndarray, 
                   detection: DetectionEvent) -> Optional[str]:
        """保存检测帧"""
        # 过滤低置信度
        if detection.confidence < self.min_confidence:
            return None
        
        # 去重检查
        if self._is_duplicate(detection.event_id):
            return None
        
        # 生成文件名
        timestamp_str = detection.timestamp.replace(':', '').replace('-', '').replace(' ', '_')
        filename = f"{timestamp_str}_{detection.class_name}_{detection.confidence:.2f}.jpg"
        filepath = self.save_dir / filename
        
        # 保存图片
        cv2.imwrite(str(filepath), frame)
        
        # 记录日志
        log_entry = {
            "event_id": detection.event_id,
            "timestamp": detection.timestamp,
            "class_name": detection.class_name,
            "confidence": float(detection.confidence),
            "bbox": detection.bbox,
            "frame_idx": detection.frame_idx,
            "image_path": str(filepath)
        }
        
        with self._lock:
            with open(self._log_file, 'a', encoding='utf-8') as f:
                f.write(json.dumps(log_entry, ensure_ascii=False) + '\n')
        
        return str(filepath)
    
    def get_log_count(self) -> int:
        """获取已保存的检测数量"""
        if self._log_file.exists():
            with open(self._log_file, 'r', encoding='utf-8') as f:
                return sum(1 for _ in f)
        return 0


class Detector:
    """YOLO 模型加载、推理"""
    
    def __init__(self, 
                 model_path: str,
                 conf_threshold: float = 0.25,
                 input_size: tuple = (640, 640),
                 device: str = "cuda"):
        self.model_path = model_path
        self.conf_threshold = conf_threshold
        self.input_size = input_size
        self.device = device
        self.model = None
        self.class_names: List[str] = []
        
    def load(self, classes_file: Optional[str] = None):
        """加载模型"""
        # 加载外部ultralytics
        sys.path.insert(0, _ULTRALYTICS_PATH)
        self.model = YOLO(self.model_path)
        
        # 加载类别名称
        if classes_file and os.path.exists(classes_file):
            with open(classes_file, 'r', encoding='utf-8') as f:
                self.class_names = [line.strip() for line in f if line.strip()]
        else:
            self.class_names = [f"class_{i}" for i in range(100)]
        
        return self
    
    def predict(self, frame: np.ndarray) -> DetectionResult:
        """推理单帧"""
        if not self.model:
            raise RuntimeError("模型未加载")
        
        # 缩放到模型输入尺寸
        resized = cv2.resize(frame, self.input_size)
        
        # 推理
        results = self.model.predict(
            resized, 
            conf=self.conf_threshold,
            verbose=False,
            device=self.device
        )
        
        result = results[0]
        
        # 解析结果
        boxes = []
        classes = []
        scores = []
        labels = []
        
        if result.boxes is not None:
            for box in result.boxes:
                xyxy = box.xyxy[0].cpu().numpy()
                conf = float(box.conf[0])
                cls = int(box.cls[0])
                
                # 还原到原图坐标
                h, w = frame.shape[:2]
                h_resized, w_resized = self.input_size
                scale_x = w / w_resized
                scale_y = h / h_resized
                
                x1 = xyxy[0] * scale_x
                y1 = xyxy[1] * scale_y
                x2 = xyxy[2] * scale_x
                y2 = xyxy[3] * scale_y
                
                boxes.append([x1, y1, x2, y2])
                classes.append(cls)
                scores.append(conf)
                labels.append(self.class_names[cls] if cls < len(self.class_names) else f"class_{cls}")
        
        return DetectionResult(
            frame_idx=0,
            timestamp=time.time(),
            boxes=boxes,
            classes=classes,
            scores=scores,
            labels=labels
        )


class VideoDetectionController:
    """视频检测主控制器 - 协调所有组件"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.video_stream: Optional[VideoStream] = None
        self.detector: Optional[Detector] = None
        self.drawer: Drawer = Drawer()
        self.history_manager: HistoryManager = HistoryManager(
            save_dir=config.get('save_dir', 'history'),
            dedup_window_ms=config.get('dedup_window_ms', 500),
            min_confidence=config.get('min_confidence', 0.25)
        )
        
        # 生产-消费队列
        self.frame_queue: Queue = Queue(maxsize=2)
        self.result_cache: DetectionResult = None
        
        # 线程控制
        self._detector_thread: Optional[threading.Thread] = None
        self._running = False
        
        # 回调函数
        self.on_detection: Optional[Callable] = None
        self.on_frame: Optional[Callable] = None
        
    def initialize(self, video_path: str) -> bool:
        """初始化组件"""
        # 初始化视频流
        self.video_stream = VideoStream(video_path)
        if not self.video_stream.open():
            return False
        
        # 初始化检测器
        model_path = self.config.get('model_path', '')
        classes_file = self.config.get('classes_file', '')
        
        self.detector = Detector(
            model_path=model_path,
            conf_threshold=self.config.get('conf_threshold', 0.25),
            input_size=tuple(self.config.get('input_size', [640, 640])),
            device=self.config.get('device', 'cuda')
        )
        self.detector.load(classes_file)
        
        return True
    
    def _detector_loop(self):
        """检测线程主循环"""
        while self._running:
            try:
                # 从队列获取帧（最多等待50ms）
                frame = self.frame_queue.get(timeout=0.05)
                
                if frame is None:
                    continue
                
                # 推理
                result = self.detector.predict(frame)
                
                # 缓存结果
                self.result_cache = result
                
                # 触发回调
                if self.on_detection:
                    self.on_detection(result, frame)
                    
            except Empty:
                continue
            except Exception as e:
                print(f"检测线程错误: {e}")
    
    def play(self):
        """开始播放"""
        if not self.video_stream:
            return
        
        self._running = True
        self.video_stream.play()
        
        # 启动检测线程
        self._detector_thread = threading.Thread(target=self._detector_loop, daemon=True)
        self._detector_thread.start()
    
    def pause(self):
        """暂停播放"""
        if self.video_stream:
            self.video_stream.pause()
    
    def stop(self):
        """停止播放"""
        self._running = False
        if self.video_stream:
            self.video_stream.stop()
            self.video_stream.release()
    
    def seek(self, frame_idx: int):
        """跳转"""
        if self.video_stream:
            self.video_stream.seek(frame_idx)
    
    def get_next_frame(self) -> Optional[np.ndarray]:
        """获取下一帧（含检测结果）"""
        if not self.video_stream:
            return None
        
        frame = self.video_stream.read_frame()
        if frame is None:
            return None
        
        # 入队检测
        if self._running and self.config.get('skip_frames', 3) > 1:
            current = self.video_stream.current_frame
            if current % self.config.get('skip_frames', 3) == 0:
                try:
                    self.frame_queue.put_nowait(frame)
                except:
                    pass  # 队列满，丢弃
        
        # 获取缓存的检测结果
        result = self.result_cache
        
        if result and result.boxes:
            # 绘制检测框
            frame = self.drawer.draw_detection(
                frame, result.boxes, result.labels, result.scores
            )
        
        # 绘制进度条
        frame = self.drawer.draw_progress(
            frame, 
            self.video_stream.current_frame,
            self.video_stream.total_frames,
            self.video_stream.fps
        )
        
        if self.on_frame:
            self.on_frame(frame)
        
        return frame
    
    def get_status(self) -> Dict[str, Any]:
        """获取状态"""
        return {
            "is_playing": self.video_stream.is_playing if self.video_stream else False,
            "current_frame": self.video_stream.current_frame if self.video_stream else 0,
            "total_frames": self.video_stream.total_frames if self.video_stream else 0,
            "fps": self.video_stream.fps if self.video_stream else 0,
            "detection_count": self.history_manager.get_log_count()
        }


def main():
    """主函数 - 演示用法"""
    import argparse
    
    parser = argparse.ArgumentParser(description='视频边播边检')
    parser.add_argument('--video', '-v', required=True, help='视频文件路径')
    parser.add_argument('--model', '-m', required=True, help='模型路径（.pt文件）')
    parser.add_argument('--classes', '-c', required=True, help='类别文件路径')
    parser.add_argument('--save-dir', '-s', default='history', help='保存目录')
    parser.add_argument('--conf', type=float, default=0.25, help='置信度阈值')
    args = parser.parse_args()
    
    # 配置
    config = {
        'model_path': args.model,
        'classes_file': args.classes,
        'save_dir': args.save_dir,
        'conf_threshold': args.conf,
        'skip_frames': 3,
        'device': 'cuda'
    }
    
    # 初始化控制器
    controller = VideoDetectionController(config)
    
    if not controller.initialize(args.video):
        print(f"无法打开视频: {args.video}")
        return
    
    print(f"视频加载成功: {controller.video_stream.total_frames} 帧, {controller.video_stream.fps:.1f} FPS")
    
    # 启动播放
    controller.play()
    
    # 主循环：读取并显示帧
    cv2.namedWindow('Video Detection', cv2.WINDOW_NORMAL)
    
    frame_delay = int(1000 / controller.video_stream.fps) if controller.video_stream.fps > 0 else 33
    
    while True:
        frame = controller.get_next_frame()
        
        if frame is None:
            print("播放结束")
            break
        
        cv2.imshow('Video Detection', frame)
        
        key = cv2.waitKey(frame_delay) & 0xFF
        if key == ord('q'):
            break
        elif key == ord(' '):  # 空格暂停
            controller.pause()
            cv2.waitKey(0)
        elif key == ord('r'):  # R重新开始
            controller.seek(0)
    
    controller.stop()
    cv2.destroyAllWindows()
    print("检测完成!")


if __name__ == '__main__':
    main()
