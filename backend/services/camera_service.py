"""
摄像头流管理服务
支持RTSP/MJPEG流的连接管理和帧获取功能
用于摄像头实时检测场景中的IP网络摄像头接入
"""

import asyncio
import cv2
import numpy as np
from typing import Optional, AsyncGenerator, Tuple
from dataclasses import dataclass, field


@dataclass
class StreamInfo:
    """视频流信息"""
    url: str
    stream_type: str  # 'rtsp', 'mjpeg', 'usb'
    width: int = 0
    height: int = 0
    fps: float = 0
    is_connected: bool = False
    error_count: int = 0


class CameraStreamService:
    """摄像头流管理服务"""

    def __init__(self):
        # 存储活跃的流连接
        self._streams: dict[str, cv2.VideoCapture] = {}
        self._stream_info: dict[str, StreamInfo] = {}
        # MJPEG流的缓存帧
        self._latest_frames: dict[str, bytes] = {}
        # 最大错误次数
        self._max_errors = 5

    def _detect_stream_type(self, url: str) -> str:
        """根据URL检测流类型"""
        url_lower = url.lower()
        if url_lower.startswith('rtsp://') or url_lower.startswith('rtsps://'):
            return 'rtsp'
        elif url_lower.startswith('/dev/video'):
            return 'usb'
        elif ('mjpg' in url_lower or 'mjpeg' in url_lower or 
              '/video' in url_lower or ':8080' in url_lower or 
              ':8081' in url_lower):
            return 'mjpeg'
        else:
            # 默认尝试作为RTSP处理
            return 'rtsp'

    async def connect_stream(self, stream_id: str, url: str) -> Tuple[bool, str]:
        """
        连接视频流
        
        参数:
            stream_id: 流标识符
            url: 视频流地址
            
        返回:
            (success, message)
        """
        try:
            # 如果已有连接，先断开
            if stream_id in self._streams:
                self.disconnect_stream(stream_id)

            stream_type = self._detect_stream_type(url)

            # 使用OpenCV打开视频流
            cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
            
            if not cap.isOpened():
                # 尝试其他backend
                cap = cv2.VideoCapture(url, cv2.CAP_ANY)
                
            if not cap.isOpened():
                return False, f"无法连接视频流: {url}"

            # 获取流信息
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = cap.get(cv2.CAP_PROP_FPS)

            self._streams[stream_id] = cap
            self._stream_info[stream_id] = StreamInfo(
                url=url,
                stream_type=stream_type,
                width=width,
                height=height,
                fps=fps,
                is_connected=True
            )

            print(f"[CameraStream] 成功连接流 [{stream_id}]: {url}")
            print(f"  分辨率: {width}x{height}, FPS: {fps:.1f}, 类型: {stream_type}")

            return True, f"成功连接: {width}x{height} @ {fps:.1f}fps"

        except Exception as e:
            print(f"[CameraStream] 连接失败: {e}")
            return False, f"连接异常: {str(e)}"

    def disconnect_stream(self, stream_id: str):
        """断开视频流连接"""
        if stream_id in self._streams:
            try:
                self._streams[stream_id].release()
            except:
                pass
            del self._streams[stream_id]
            
        if stream_id in self._stream_info:
            del self._stream_info[stream_id]
            
        if stream_id in self._latest_frames:
            del self._latest_frames[stream_id]

        print(f"[CameraStream] 已断开流: {stream_id}")

    def disconnect_all(self):
        """断开所有流连接"""
        for sid in list(self._streams.keys()):
            self.disconnect_stream(sid)
        print("[CameraStream] 所有流已断开")

    async def get_frame(self, stream_id: str, timeout_ms: int = 3000) -> Optional[np.ndarray]:
        """
        从指定流获取单帧
        
        参数:
            stream_id: 流标识符
            timeout_ms: 超时时间(毫秒)
            
        返回:
            OpenCV图像数组(BGR格式)，获取失败返回None
        """
        if stream_id not in self._streams:
            print(f"[CameraStream] 流未连接: {stream_id}")
            return None

        cap = self._streams[stream_id]
        info = self._stream_info.get(stream_id)

        try:
            # 设置读取超时
            cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, timeout_ms)
            cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, timeout_ms)

            # 读取一帧
            ret, frame = cap.read()

            if not ret or frame is None:
                # 错误计数
                if info:
                    info.error_count += 1
                    if info.error_count >= self._max_errors:
                        print(f"[CameraStream] 流[{stream_id}] 连续错误过多，建议重新连接")
                        info.is_connected = False
                return None

            # 重置错误计数
            if info:
                info.error_count = 0
                info.is_connected = True

            return frame

        except Exception as e:
            print(f"[CameraStream] 读帧异常 [{stream_id}]: {e}")
            if info:
                info.error_count += 1
            return None

    async def encode_frame_to_jpeg(self, frame: np.ndarray, quality: int = 85) -> bytes:
        """将OpenCV帧编码为JPEG字节"""
        try:
            encode_params = [cv2.IMWRITE_JPEG_QUALITY, quality]
            _, jpeg_data = cv2.imencode('.jpg', frame, encode_params)
            return jpeg_data.tobytes()
        except Exception as e:
            print(f"[CameraStream] JPEG编码失败: {e}")
            return b''

    def get_stream_info(self, stream_id: str) -> Optional[StreamInfo]:
        """获取流信息"""
        return self._stream_info.get(stream_id)

    def get_all_streams_status(self) -> list:
        """获取所有流的状态列表"""
        result = []
        for sid, info in self._stream_info.items():
            result.append({
                'id': sid,
                'url': info.url,
                'type': info.stream_type,
                'resolution': f"{info.width}x{info.height}",
                'fps': round(info.fps, 1),
                'connected': info.is_connected
            })
        return result

    async def generate_mjpeg_stream(
        self, 
        stream_id: str, 
        url: str, 
        quality: int = 80,
        fps_limit: float = 15.0
    ) -> AsyncGenerator[bytes, None]:
        """
        生成MJPEG流数据
        
        用法(FastAPI StreamingResponse):
            return StreamingResponse(
                camera_service.generate_mjpeg_stream("cam1", rtsp_url),
                media_type="multipart/x-mixed-replace; boundary=frame"
            )
        """
        # 连接流
        success, msg = await self.connect_stream(stream_id, url)
        if not success:
            yield f"--frame\r\nContent-Type: text/plain\r\n\r\nERROR: {msg}\r\n".encode()
            return

        frame_interval = 1.0 / fps_limit if fps_limit > 0 else 0.066
        boundary = b"--frame"

        try:
            while True:
                start_time = asyncio.get_event_loop().time()

                # 获取帧
                frame = await self.get_frame(stream_id)
                if frame is None:
                    # 发送空白帧保持连接
                    blank_frame = np.zeros((480, 640, 3), dtype=np.uint8)
                    jpeg_data = await self.encode_frame_to_jpeg(blank_frame, quality)
                else:
                    # 编码为JPEG
                    jpeg_data = await self.encode_frame_to_jpeg(frame, quality)

                if len(jpeg_data) == 0:
                    continue

                # 构造MJPEG响应
                header = (
                    f"{boundary.decode()}\r\n"
                    f"Content-Type: image/jpeg\r\n"
                    f"Content-Length: {len(jpeg_data)}\r\n\r\n"
                ).encode()
                
                yield header + jpeg_data + b"\r\n"

                # 帧率控制
                elapsed = asyncio.get_event_loop().time() - start_time
                sleep_time = frame_interval - elapsed
                if sleep_time > 0:
                    await asyncio.sleep(sleep_time)

        except asyncio.CancelledError:
            print(f"[CameraStream] MJPEG流被取消: {stream_id}")
        finally:
            self.disconnect_stream(stream_id)

    async def capture_and_detect_frame(
        self, 
        stream_id: str, 
        url: str,
        model_predict_func=None
    ) -> dict:
        """
        从流中截取一帧并进行检测
        
        参数:
            stream_id: 流标识符
            url: 流地址
            model_predict_func: 检测函数(可选)，接收numpy数组返回检测结果
            
        返回:
            包含帧数据和检测结果的字典
        """
        # 确保连接
        if stream_id not in self._streams:
            success, _ = await self.connect_stream(stream_id, url)
            if not success:
                return {'success': False, 'message': '无法连接视频流'}

        # 获取帧
        frame = await self.get_frame(stream_id)
        if frame is None:
            return {'success': False, 'message': '无法获取帧数据'}

        # 编码为JPEG
        jpeg_bytes = await self.encode_frame_to_jpeg(frame)
        
        result = {
            'success': True,
            'width': frame.shape[1],
            'height': frame.shape[0],
            'frame_size': len(jpeg_bytes),
            'frame_jpeg': jpeg_bytes
        }

        # 如果提供了检测函数，执行检测
        if model_predict_func:
            try:
                detection_result = model_predict_func(frame)
                result['detection'] = detection_result
            except Exception as e:
                print(f"[CameraStream] 帧检测失败: {e}")
                result['detection_error'] = str(e)

        return result

    @staticmethod
    def validate_rtsp_url(url: str) -> Tuple[bool, str]:
        """验证RTSP URL格式"""
        if not url or not url.strip():
            return False, "URL不能为空"

        url = url.strip()
        
        # RTSP格式验证
        if url.startswith('rtsp://') or url.startswith('rtsps://'):
            parts = url.replace('rtsp://', '').replace('rtsps://', '').split('/')
            if len(parts) < 1 or '.' not in(parts[0]):
                return False, "无效的RTSP地址格式"
            return True, "OK"

        # MJPEG格式验证
        if url.startswith('http://') or url.startswith('https://'):
            if 'mjpg' in url.lower() or 'mjpeg' in url.lower() or \
               '/video' in url.lower() or ':8080' in url or ':8081' in url:
                return True, "OK"

        return False, "不支持的视频流格式，请输入RTSP或MJPEG地址"


# 全局实例
camera_stream_service = CameraStreamService()
