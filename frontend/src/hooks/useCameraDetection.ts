/**
 * useCameraDetection - 摄像头/视频实时检测Hook
 * 
 * 核心功能：
 * - 帧提取：从video/img元素截取帧画面
 * - AI推理：调用后端/api/model/predict进行YOLO模型检测
 * - 结果解析：将检测结果转为UI可用的坐标格式
 * - 检测框管理：自动过期清理、状态维护
 * - 日志记录：实时预警日志生成
 * - 自动截图：按设置的时间间隔自动保存截图到后端
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import apiService from '../services/ApiService';

// ============ 类型定义 ============

export interface DetectionBox {
  id: string;
  type: string;
  confidence: number;
  x: number;       // 百分比
  y: number;       // 百分比
  width: number;   // 百分比
  height: number;  // 百分比
  color: string;
  timestamp: number;
}

export interface DetectionLog {
  id: string;
  timestamp: string;
  type: string;
  confidence: number;
  message: string;
  severity: 'info' | 'warning' | 'error';
  bbox?: { x: number; y: number; width: number; height: number };
  imageUrl?: string;
  saved: boolean;
}

export interface CapturedFrame {
  id: string;
  timestamp: string;
  imageUrl: string;
  defectCount: number;
  source: 'camera' | 'video';
  sourceName?: string;
  defects?: Array<{ type: string; confidence: number; x: number; y: number; width: number; height: number }>;
}

export type SourceType = 'webcam' | 'video' | 'mjpeg' | 'rtsp';

export interface CameraDetectionOptions {
  /** 视频源类型 */
  sourceType: SourceType;
  /** 置信度阈值 */
  confidenceThreshold: number;
  /** IOU阈值 */
  iouThreshold: number;
  /** 检测间隔(毫秒) */
  detectInterval: number;
  /** 自动截图间隔(秒)，0表示不自动截图 */
  autoCaptureInterval?: number;
  /** 用户ID */
  userId?: string;
  /** 用户名 */
  username?: string;
  /** 外部传入的 video 元素 ref（可选） */
  externalVideoRef?: React.MutableRefObject<HTMLVideoElement | null>;
}

// 缺陷类型颜色映射（与后端model_service保持一致）
const DEFECT_COLOR_MAP: Record<string, string> = {
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
};

function getColorForClass(className: string): string {
  return DEFECT_COLOR_MAP[className] || '#ef4444';
}

export interface UseCameraDetectionReturn {
  // 状态
  isDetecting: boolean;
  isPaused: boolean;
  fps: number;
  frameCount: number;
  totalDefects: number;
  detectionBoxes: DetectionBox[];
  logs: DetectionLog[];
  capturedFrames: CapturedFrame[];
  isProcessingFrame: boolean;
  lastError: string | null;
  autoSaveEnabled: boolean;

  // 控制方法
  startDetection: (videoEl: HTMLVideoElement | HTMLImageElement | null, sourceName?: string) => void;
  stopDetection: () => void;
  togglePause: () => void;
  captureFrame: (videoEl: HTMLVideoElement | HTMLImageElement | null) => Promise<void>;
  setAutoSaveEnabled: (enabled: boolean) => void;

  // 清理方法
  clearLogs: () => void;
  clearCapturedFrames: () => void;
}

// ============ 主Hook ============

export function useCameraDetection(options: CameraDetectionOptions): UseCameraDetectionReturn {
  const {
    sourceType,
    confidenceThreshold,
    iouThreshold,
    detectInterval = 1000,
    autoCaptureInterval = 0,  // 默认不自动截图
    userId,
    username,
    externalVideoRef
  } = options;

  // 状态
  const [isDetecting, setIsDetecting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [fps, setFps] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [totalDefects, setTotalDefects] = useState(0);
  const [detectionBoxes, setDetectionBoxes] = useState<DetectionBox[]>([]);
  const [logs, setLogs] = useState<DetectionLog[]>([]);
  const [capturedFrames, setCapturedFrames] = useState<CapturedFrame[]>([]);
  const [isProcessingFrame, setIsProcessingFrame] = useState(false);
  const [lastError, SetLastError] = useState<string | null>(null);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(autoCaptureInterval > 0);

  // Refs
  const detectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const internalVideoRef = useRef<HTMLVideoElement | HTMLImageElement | null>(null);
  const sourceNameRef = useRef<string>('');
  const frameTimestampsRef = useRef<number[]>([]);  // 用于FPS计算
  const stopRequestedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const autoCaptureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoCaptureRef = useRef<number>(0);

  // 统一获取 video 元素的逻辑
  const getVideoElement = useCallback((): HTMLVideoElement | HTMLImageElement | null => {
    if (externalVideoRef?.current) {
      return externalVideoRef.current;
    }
    return internalVideoRef.current;
  }, [externalVideoRef]);

  // 获取或创建离屏Canvas
  const getCanvas = useCallback(() => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = 640;
      canvasRef.current.height = 480;
    }
    return canvasRef.current;
  }, []);

  // 从视频/图片元素截取帧并返回File对象
  const captureFrameToFile = useCallback((
    element: HTMLVideoElement | HTMLImageElement
  ): File | null => {
    const canvas = getCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // 获取原始尺寸
    let srcWidth: number, srcHeight: number;
    if (element instanceof HTMLVideoElement) {
      srcWidth = element.videoWidth || 640;
      srcHeight = element.videoHeight || 480;
    } else {
      srcWidth = element.naturalWidth || 640;
      srcHeight = element.naturalHeight || 480;
    }

    if (srcWidth === 0 || srcHeight === 0) return null;

    // 设置canvas尺寸（限制最大分辨率）
    const maxDim = 640;
    const scale = Math.min(maxDim / srcWidth, maxDim / srcHeight, 1);
    canvas.width = Math.round(srcWidth * scale);
    canvas.height = Math.round(srcHeight * scale);

    // 绘制帧到canvas
    ctx.drawImage(element, 0, 0, canvas.width, canvas.height);

    // 转为Blob再构造File
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    // 将base64转换为Blob
    const byteString = atob(dataUrl.split(',')[1]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: 'image/jpeg' });
    
    return new File([blob], `frame_${Date.now()}.jpg`, { type: 'image/jpeg' });
  }, [getCanvas]);

  // 执行单次AI检测
  const runDetection = useCallback(async (
    element: HTMLVideoElement | HTMLImageElement
  ) => {
    if (isProcessingFrame) return;
    setIsProcessingFrame(true);

    try {
      // 截取帧
      const imageFile = captureFrameToFile(element);
      if (!imageFile) {
        console.warn('帧截取失败，跳过本次检测');
        return;
      }

      // 更新帧计数
      setFrameCount(prev => prev + 1);

      // 记录时间戳用于FPS计算
      const now = Date.now();
      frameTimestampsRef.current.push(now);
      // 保留最近10个时间戳
      if (frameTimestampsRef.current.length > 10) {
        frameTimestampsRef.current.shift();
      }
      // 计算FPS
      if (frameTimestampsRef.current.length >= 2) {
        const elapsed = (frameTimestampsRef.current[frameTimestampsRef.current.length - 1] 
                      - frameTimestampsRef.current[0]);
        const currentFps = Math.round((frameTimestampsRef.current.length - 1) / (elapsed / 1000));
        setFps(currentFps);
      }

      // 调用后端AI预测接口
      const result = await apiService.predict(imageFile, {
        userId: userId || undefined,
        username: username || undefined,
        confidenceThreshold: confidenceThreshold,
        iouThreshold: iouThreshold,
        detectionType: sourceType === 'video' ? 'video' : 'camera'
      });

      // 解析检测结果
      const detectionData = result?.result || result || {};
      const detections = detectionData?.detections || [];
      const count = detectionData?.count || detections.length;
      
      // 获取标注图片URL（如果有）
      const annotatedImage = detectionData?.annotated_image || detectionData?.original_image_url;

      // 坐标转换：像素坐标 -> 百分比坐标
      const canvas = getCanvas();
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      
      const newBoxes: DetectionBox[] = detections.map((det: any, idx: number) => {
        const className = det.class || det.type || '未知';
        const conf = det.confidence || 0;
        
        // YOLO返回的是xyxy格式的bbox或者xywh
        let bx: number, by: number, bw: number, bh: number;
        if (det.bbox) {
          bx = det.bbox.x;
          by = det.bbox.y;
          bw = det.bbox.width;
          bh = det.bbox.height;
        } else if (det.x !== undefined && det.y !== undefined) {
          // 使用det数据中的坐标
          bx = det.x;
          by = det.y;
          bw = det.width || 50;
          bh = det.height || 50;
        } else {
          // 如果没有bbox，使用默认值
          bx = 50 + Math.random() * 30;
          by = 30 + Math.random() * 40;
          bw = 15;
          bh = 15;
        }

        return {
          id: `${Date.now()}-${idx}`,
          type: className,
          confidence: conf,
          x: (bx / imgWidth) * 100,
          y: (by / imgHeight) * 100,
          width: (bw / imgWidth) * 100,
          height: (bh / imgHeight) * 100,
          color: getColorForClass(className),
          timestamp: Date.now()
        };
      });

      // 更新检测框（保留最近4个）
      setDetectionBoxes(prev => [...prev.slice(-3), ...newBoxes].slice(-4));

      // 更新缺陷总数
      if (count > 0) {
        setTotalDefects(prev => prev + count);
      }

      // 生成日志记录
      if (detections.length > 0) {
        for (const det of detections.slice(0, 2)) {  // 最多记录前2个缺陷
          const className = det.class || det.type || '未知';
          const conf = det.confidence || 0;
          
          const newLog: DetectionLog = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toLocaleTimeString(),
            type: className,
            confidence: conf,
            message: `检测到${className}，置信度 ${(conf * 100).toFixed(1)}%`,
            severity: conf > 0.85 ? 'error' : conf > 0.65 ? 'warning' : 'info',
            imageUrl: annotatedImage,
            saved: false
          };

          if (det.bbox) {
            newLog.bbox = det.bbox;
          } else if (det.x !== undefined) {
            newLog.bbox = { x: det.x, y: det.y, width: det.width || 50, height: det.height || 50 };
          }

          setLogs(prev => [newLog, ...prev].slice(0, 100));
        }
        
        // 自动截图保存（有缺陷时）
        if (autoSaveEnabled && autoCaptureInterval > 0) {
          const timeSinceLastCapture = (Date.now() - lastAutoCaptureRef.current) / 1000;
          if (timeSinceLastCapture >= autoCaptureInterval) {
            lastAutoCaptureRef.current = Date.now();
            // 异步保存截图
            saveFrameToBackend(element, detections, annotatedImage);
          }
        }
      }

      SetLastError(null);

    } catch (error) {
      console.error('检测失败:', error);
      const errorMsg = error instanceof Error ? error.message : '检测请求失败';
      SetLastError(errorMsg);
      
      // 记录错误日志
      const errorLog: DetectionLog = {
        id: `error-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        type: '系统',
        confidence: 0,
        message: `检测失败: ${errorMsg}`,
        severity: 'error',
        saved: false
      };
      setLogs(prev => [errorLog, ...prev].slice(0, 100));
    } finally {
      setIsProcessingFrame(false);
    }
  }, [
    isProcessingFrame, captureFrameToFile, getCanvas,
    userId, username, confidenceThreshold, iouThreshold, sourceType,
    autoSaveEnabled, autoCaptureInterval
  ]);

  // 保存帧到后端（自动截图功能）
  const saveFrameToBackend = useCallback(async (
    element: HTMLVideoElement | HTMLImageElement,
    detections: any[],
    annotatedImage?: string
  ) => {
    try {
      const imageFile = captureFrameToFile(element);
      if (!imageFile) return;

      const canvas = getCanvas();
      const defectCount = detections.length;
      const hasDefects = defectCount > 0;

      // 构建FormData保存截图
      const formData = new FormData();
      formData.append('image', imageFile);
      formData.append('source_type', sourceType === 'video' ? 'video' : 'camera');
      formData.append('source_name', sourceNameRef.current || sourceType);
      formData.append('defect_type', hasDefects ? (detections[0]?.class || detections[0]?.type || 'defect') : 'normal');
      formData.append('confidence', hasDefects ? String(detections[0]?.confidence || 0.8) : '0');
      formData.append('severity', hasDefects ? 'warning' : 'info');
      formData.append('message', `自动截图：检测到 ${defectCount} 个缺陷`);
      if (userId) formData.append('user_id', userId.toString());

      if (hasDefects && detections[0]?.bbox) {
        formData.append('bbox', JSON.stringify(detections[0].bbox));
      }

      // 调用后端API保存（会保存到 camera_detections 表）
      const result = await apiService.saveCameraLogWithImage(formData);
      console.log(`[CameraDetection] 截图已保存到后端:`, result);

      // 更新本地截图历史（使用后端返回的URL）
      const newFrame: CapturedFrame = {
        id: `auto_${Date.now()}`,
        timestamp: new Date().toLocaleString(),
        imageUrl: result?.data?.image_url || annotatedImage || canvas.toDataURL('image/jpeg'),
        defectCount: defectCount,
        source: sourceType === 'video' ? 'video' : 'camera',
        sourceName: sourceNameRef.current,
        defects: detections.map((d: any) => ({
          type: d.class || d.type || '未知',
          confidence: d.confidence || 0,
          x: (d.bbox?.x || d.x || 0) / canvas.width * 100,
          y: (d.bbox?.y || d.y || 0) / canvas.height * 100,
          width: (d.bbox?.width || d.width || 50) / canvas.width * 100,
          height: (d.bbox?.height || d.height || 50) / canvas.height * 100
        }))
      };

      setCapturedFrames(prev => [newFrame, ...prev].slice(0, 50));
      console.log(`[CameraDetection] 自动截图已保存，缺陷数: ${defectCount}`);

    } catch (error) {
      console.error('[CameraDetection] 自动截图保存失败:', error);
    }
  }, [captureFrameToFile, getCanvas, sourceType, userId]);

  // 检测循环
  const detectLoop = useCallback(async () => {
    if (stopRequestedRef.current || !isDetecting || isPaused) return;

    const el = getVideoElement();
    if (!el) {
      // 元素不存在，停止检测
      stopDetection();
      return;
    }

    // 检查视频源是否就绪
    if (el instanceof HTMLVideoElement && (el.readyState < 2 || el.paused)) {
      // 视频还没准备好或已暂停，等待下次
      detectTimerRef.current = setTimeout(detectLoop, 500);
      return;
    }

    await runDetection(el);

    // 安排下一次检测（如果仍在运行且未暂停）
    if (!stopRequestedRef.current && isDetecting && !isPaused) {
      detectTimerRef.current = setTimeout(detectLoop, detectInterval);
    }
  }, [isDetecting, isPaused, runDetection, detectInterval, getVideoElement]);

  // 停止检测（必须声明在 startDetection 之前：
  // startDetection 的 useCallback 依赖数组会在渲染时读取 stopDetection，
  // 声明在后会触发 TDZ 错误，导致摄像头页面一打开就崩溃）
  const stopDetection = useCallback(() => {
    stopRequestedRef.current = true;
    setIsDetecting(false);
    setIsPaused(false);
    setFps(0);

    if (detectTimerRef.current) {
      clearTimeout(detectTimerRef.current);
      detectTimerRef.current = null;
    }

    if (autoCaptureTimerRef.current) {
      clearTimeout(autoCaptureTimerRef.current);
      autoCaptureTimerRef.current = null;
    }

    console.log('[CameraDetection] 检测已停止');
  }, []);

  // 开始检测
  const startDetection = useCallback((
    videoEl: HTMLVideoElement | HTMLImageElement | null,
    sourceName?: string
  ) => {
    // 如果传入了 videoEl 且没有外部 ref，使用传入的
    // 否则如果有外部 ref，使用外部 ref
    const targetEl = videoEl || getVideoElement();
    
    if (!targetEl) {
      console.error('无法启动检测：视频元素为空');
      return;
    }

    // 清除之前的检测状态
    stopDetection();

    // 保存到内部 ref（作为备选）
    internalVideoRef.current = targetEl;
    sourceNameRef.current = sourceName || '';
    stopRequestedRef.current = false;
    lastAutoCaptureRef.current = Date.now();
    
    setIsDetecting(true);
    setIsPaused(false);
    setFrameCount(0);
    setTotalDefects(0);
    setDetectionBoxes([]);
    setFps(0);
    SetLastError(null);
    frameTimestampsRef.current = [];

    console.log(`[CameraDetection] 开始${sourceType}检测，间隔: ${detectInterval}ms，自动截图: ${autoCaptureInterval}s`);

    // 启动检测循环
    detectTimerRef.current = setTimeout(detectLoop, 500);  // 首次延迟500ms
  }, [sourceType, detectInterval, autoCaptureInterval, detectLoop, stopDetection, getVideoElement]);

  // 切换暂停
  const togglePause = useCallback(() => {
    if (!isDetecting) return;

    setIsPaused(prev => {
      const newState = !prev;
      if (newState) {
        // 暂停时清除定时器
        if (detectTimerRef.current) {
          clearTimeout(detectTimerRef.current);
          detectTimerRef.current = null;
        }
      } else {
        // 恢复时重启检测循环
        stopRequestedRef.current = false;
        detectTimerRef.current = setTimeout(detectLoop, detectInterval);
      }

      console.log(`[CameraDetection] ${newState ? '已暂停' : '已继续'}`);
      return newState;
    });
  }, [isDetecting, detectLoop, detectInterval]);

  // 手动抓拍保存
  const captureFrame = useCallback(async (
    videoEl: HTMLVideoElement | HTMLImageElement | null
  ) => {
    if (!videoEl) return;

    try {
      const imageFile = captureFrameToFile(videoEl);
      if (!imageFile) return;

      const canvas = getCanvas();
      const dataUrl = canvas.toDataURL('image/png');

      const newFrame: CapturedFrame = {
        id: `${Date.now()}`,
        timestamp: new Date().toLocaleString(),
        imageUrl: dataUrl,
        defectCount: detectionBoxes.length,
        source: sourceType === 'video' ? 'video' : 'camera',
        sourceName: sourceNameRef.current,
        defects: detectionBoxes.map(box => ({
          type: box.type,
          confidence: box.confidence,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height
        }))
      };

      setCapturedFrames(prev => [newFrame, ...prev].slice(0, 50));

      // 通过API保存到后端
      const formData = new FormData();
      formData.append('image', imageFile);
      formData.append('source_type', sourceType === 'video' ? 'video' : 'camera');
      formData.append('source_name', sourceNameRef.current || sourceType);
      formData.append('defect_type', detectionBoxes.length > 0 ? 'defect_detected' : 'normal');
      formData.append('confidence', detectionBoxes.length > 0 ? '0.8' : '0');
      formData.append('severity', detectionBoxes.length > 0 ? 'warning' : 'info');
      formData.append('message', `检测到 ${detectionBoxes.length} 个缺陷`);
      if (userId) formData.append('user_id', userId.toString());

      if (detectionBoxes.length > 0) {
        formData.append('bbox', JSON.stringify({
          x: 0, y: 0,
          width: canvas.width,
          height: canvas.height
        }));
      }

      await apiService.saveCameraLogWithImage(formData);
      console.log('[CameraDetection] 截图已保存到后端');

    } catch (error) {
      console.error('截图保存失败:', error);
    }
  }, [captureFrameToFile, getCanvas, detectionBoxes, sourceType, userId]);

  // 清空日志
  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  // 清空截图历史
  const clearCapturedFrames = useCallback(() => {
    setCapturedFrames([]);
  }, []);

  // 自动清理过期的检测框
  useEffect(() => {
    if (detectionBoxes.length > 0) {
      const timeout = setTimeout(() => {
        setDetectionBoxes(prev => prev.slice(1));
      }, 2500);  // 2.5秒后移除最旧的检测框
      return () => clearTimeout(timeout);
    }
  }, [detectionBoxes]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      stopDetection();
    };
  }, [stopDetection]);

  // 自动保存开关控制
  const setAutoSaveEnabledFn = useCallback((enabled: boolean) => {
    setAutoSaveEnabled(enabled);
    console.log(`[CameraDetection] 自动截图: ${enabled ? '已开启' : '已关闭'}`);
  }, []);

  return {
    // 状态
    isDetecting,
    isPaused,
    fps,
    frameCount,
    totalDefects,
    detectionBoxes,
    logs,
    capturedFrames,
    isProcessingFrame,
    lastError,
    autoSaveEnabled,

    // 控制方法
    startDetection,
    stopDetection,
    togglePause,
    captureFrame,
    setAutoSaveEnabled: setAutoSaveEnabledFn,

    // 清理方法
    clearLogs,
    clearCapturedFrames
  };
}

export default useCameraDetection;
