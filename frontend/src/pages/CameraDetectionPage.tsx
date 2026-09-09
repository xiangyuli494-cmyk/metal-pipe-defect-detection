import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera,
  Play,
  Pause,
  Square,
  AlertCircle,
  RefreshCw,
  Maximize,
  CameraOff,
  Upload,
  Download,
  Film,
  Save,
  X,
  AlertTriangle,
  Activity,
  Zap,
  Clock,
  FileVideo,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  FilmIcon,
  Webcam,
  Monitor,
  Trash2,
  Wifi,
  Settings,
  Image as ImageIcon,
  ZoomIn,
  ZoomOut,
  Info,
  Loader2,
  FileText
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  videoDetectionService,
  VideoDetectResult,
  VideoDetectProgress,
  DetectedFrame
} from '../services/VideoDetectionService';
import apiService from '../services/ApiService';

// 缺陷类型颜色映射
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
  '其他': '#6b7280',
  'crack': '#f97316',
  'corrosion': '#f59e0b',
  'pitting': '#8b5cf6',
  'scratch': '#06b6d4',
  'dent': '#ec4899',
  'wear': '#7c2d12',
  'rust': '#eab308',
  'hole': '#84cc16',
  'deformation': '#64748b',
  'other': '#6b7280'
};

interface DetectionBox {
  id: string;
  type: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

interface DetectionLog {
  id: string;
  timestamp: string;
  type: string;
  confidence: number;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'success';
  bbox?: { x: number; y: number; width: number; height: number };
  imageUrl?: string;
  // 保存的图片详情
  savedRecord?: {
    id: string;
    imageUrl: string;
    resultImageUrl?: string;
    defectType: string;
    defectCount: number;
    confidence: number;
    detectionTime: string;
    sourceType: 'video' | 'camera';
    sourceName: string;
    // 详细的缺陷列表
    detections?: Array<{
      class: string;
      confidence: number;
      bbox: { x: number; y: number; width: number; height: number };
    }>;
  };
}

interface CameraDetectionPageProps {
  initialMode?: 'video' | 'camera';
}

const CameraDetectionPage: React.FC<CameraDetectionPageProps> = ({ initialMode }) => {
  const { user } = useAuth();
  
  // 模式状态：'video' = 视频检测, 'camera' = 实时摄像头
  const [mode, setMode] = useState<'video' | 'camera'>(initialMode || 'video');
  // 视频检测子模式：'batch' = 批量检测（先处理后播放）, 'realtime' = 边播放边检测
  const [videoSubMode, setVideoSubMode] = useState<'batch' | 'realtime'>('batch');
  
  // 视频模式状态
  const [uploadedVideo, setUploadedVideo] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [detectResult, setDetectResult] = useState<VideoDetectResult | null>(null);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  const [detectProgress, setDetectProgress] = useState<VideoDetectProgress>({
    status: 'idle',
    progress: 0,
    message: ''
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [playbackFps, setPlaybackFps] = useState(10);
  
  // 边播放边检测相关状态
  const [isRealtimeDetecting, setIsRealtimeDetecting] = useState(false);
  const [realtimeFps, setRealtimeFps] = useState(0);
  const [realtimeTotalDefects, setRealtimeTotalDefects] = useState(0);
  const [realtimeVideoRef, setRealtimeVideoRef] = useState<HTMLVideoElement | null>(null);
  const [realtimeCanvasRef, setRealtimeCanvasRef] = useState<HTMLCanvasElement | null>(null);
  const realtimeDetectorRef = useRef<ReturnType<typeof videoDetectionService.createRealtimeDetector> | null>(null);
  
  // 视频实时流相关状态
  const [realtimeSessionId, setRealtimeSessionId] = useState<string | null>(null);
  const [realtimeVideoInfo, setRealtimeVideoInfo] = useState<any>(null);
  const [realtimeCurrentFrame, setRealtimeCurrentFrame] = useState(0);
  const [realtimeTotalFrames, setRealtimeTotalFrames] = useState(0);
  const [realtimeTimestamp, setRealtimeTimestamp] = useState(0);
  const [isRealtimePlaying, setIsRealtimePlaying] = useState(false);
  const [realtimeFrameRef, setRealtimeFrameRef] = useState<HTMLCanvasElement | null>(null);
  const realtimePollRef = useRef<number | null>(null);
  const isShouldContinueRef = useRef(true);  // 用于在异步轮询中检测是否应该继续
  const [isStartingRealtime, setIsStartingRealtime] = useState(false);  // 是否正在启动实时检测
  
  // 摄像头模式状态
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [isConnectingCamera, setIsConnectingCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraFps, setCameraFps] = useState(0);
  const [totalDefects, setTotalDefects] = useState(0);
  const [detectionBoxes, setDetectionBoxes] = useState<DetectionBox[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.5);
  const [isSavingImage, setIsSavingImage] = useState(false);
  
  // 摄像头设备列表
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [showDeviceSelect, setShowDeviceSelect] = useState(false);
  
  // 通用状态
  const [logs, setLogs] = useState<DetectionLog[]>([]);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [selectedSavedLog, setSelectedSavedLog] = useState<DetectionLog | null>(null);
  const [savedLogZoom, setSavedLogZoom] = useState(1);
  const [savedLogFullscreen, setSavedLogFullscreen] = useState(false);
  
  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playTimerRef = useRef<number | null>(null);
  
  // 摄像头相关Refs
  const streamRef = useRef<MediaStream | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const detectTimerRef = useRef<number | null>(null);
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(Date.now());
  const fpsCounterRef = useRef(0);
  
  // 视频信息
  const [videoInfo, setVideoInfo] = useState({
    fps: 0,
    width: 0,
    height: 0,
    duration: 0,
    totalFrames: 0
  });

  // 清理函数
  useEffect(() => {
    return () => {
      stopCamera();
      stopRealtimeDetection();
      stopRealtimeStream();
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      if (detectTimerRef.current) clearInterval(detectTimerRef.current);
      // 注意：不要在组件卸载时清理 videoUrl，因为它可能在切换模式后仍然需要
    };
  }, []);

  // 自动滚动日志
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = 0;
    }
  }, [logs]);

  // 监听边播边检状态，自动开始轮询
  useEffect(() => {
    // 当 realtimeSessionId 和 realtimeFrameRef 都准备好时，开始轮询
    if (!realtimeSessionId || !realtimeFrameRef) {
      return;
    }

    // 如果还没有开始检测，不轮询
    if (!isRealtimeDetecting) {
      return;
    }

    // 如果暂停了，不轮询
    if (!isRealtimePlaying) {
      console.log('[RealtimeMode] Paused, waiting...');
      return;
    }

    console.log('[RealtimeMode] Starting frame polling', { sessionId: realtimeSessionId, hasCanvas: !!realtimeFrameRef });
    
    // 重置继续标志
    isShouldContinueRef.current = true;

    const pollFrame = async () => {
      // 使用 ref 检查是否应该继续
      if (!isShouldContinueRef.current) {
        console.log('[RealtimeMode] Stopping poll - flag set to false');
        return;
      }

      try {
        const response = await fetch(
          `${apiService.getBaseUrl()}/api/video/realtime/frame?session_id=${realtimeSessionId}&action=play`
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.detail || '获取帧失败');
        }

        const pollResult = await response.json();

        if (pollResult.success && pollResult.data) {
          const data = pollResult.data;

          // 更新状态
          setRealtimeCurrentFrame(data.current_frame);
          setRealtimeTotalFrames(data.total_frames);
          setRealtimeTimestamp(data.timestamp);
          setIsRealtimePlaying(data.is_playing);

          // 绘制帧图片到 Canvas
          if (data.frame_data && data.frame_data.length > 0 && realtimeFrameRef) {
            const canvas = realtimeFrameRef;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              const videoWidth = data.video_width || 640;
              const videoHeight = data.video_height || 480;

              if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
                canvas.width = videoWidth;
                canvas.height = videoHeight;
                console.log('[RealtimeMode] Canvas resized:', videoWidth, 'x', videoHeight);
              }

              const img = new Image();
              img.onload = () => {
                if (canvas.width !== img.width || canvas.height !== img.height) {
                  canvas.width = img.width;
                  canvas.height = img.height;
                }
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                console.log('[RealtimeMode] Frame drawn:', img.width, 'x', img.height);
              };
              img.onerror = () => {
                console.error('[RealtimeMode] Failed to load frame image');
              };
              img.src = data.frame_data;
            }
          } else {
            console.warn('[RealtimeMode] No frame_data:', data.frame_data ? 'has data but empty' : 'null/undefined');
          }

          // 更新检测框
          if (data.detections && data.detections.length > 0) {
            const videoWidth = data.video_width || 640;
            const videoHeight = data.video_height || 480;

            const newBoxes: DetectionBox[] = data.detections.map((det: any, idx: number) => {
              const className = det.class || det.type || '未知';
              const conf = det.confidence || 0;

              let bx = det.bbox?.x || det.x || 0;
              let by = det.bbox?.y || det.y || 0;
              let bw = det.bbox?.width || det.width || 50;
              let bh = det.bbox?.height || det.height || 50;

              return {
                id: `${Date.now()}-${idx}`,
                type: className,
                confidence: conf,
                x: (bx / videoWidth) * 100,
                y: (by / videoHeight) * 100,
                width: (bw / videoWidth) * 100,
                height: (bh / videoHeight) * 100,
                color: DEFECT_COLOR_MAP[className] || '#ef4444'
              };
            });

            setDetectionBoxes(newBoxes);

            // 更新缺陷统计
            setRealtimeTotalDefects(prev => prev + data.defect_count);

            // 记录日志
            if (data.defect_count > 0) {
              const defectTypes = data.detections.map((d: any) => d.class || d.type).join(', ');
              addLog('检测', 'warning',
                `帧 ${data.current_frame}: 检测到 ${data.defect_count} 个缺陷 [${defectTypes}]`
              );
            }
          } else {
            setDetectionBoxes([]);
          }

          // 如果播放结束，停止检测
          if (!data.is_playing) {
            console.log('[RealtimeMode] Playback ended');
            setIsRealtimeDetecting(false);
            return;
          }

          // 继续轮询（200ms间隔）
          if (isShouldContinueRef.current) {
            realtimePollRef.current = window.setTimeout(pollFrame, 200);
          }
        }
      } catch (error: any) {
        console.error('[RealtimeMode] Frame poll error:', error);
        // 发生错误时也停止检测
        isShouldContinueRef.current = false;
        setIsRealtimeDetecting(false);
      }
    };

    // 开始轮询
    pollFrame();

    // 清理函数
    return () => {
      isShouldContinueRef.current = false;
      if (realtimePollRef.current) {
        clearTimeout(realtimePollRef.current);
        realtimePollRef.current = null;
      }
    };
  }, [realtimeSessionId, realtimeFrameRef, isRealtimeDetecting, isRealtimePlaying]);

  // 添加日志
  const addLog = useCallback((type: string, severity: DetectionLog['severity'], message: string, savedRecord?: DetectionLog['savedRecord']) => {
    const newLog: DetectionLog = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date().toLocaleTimeString(),
      type,
      confidence: savedRecord?.confidence || 0,
      message,
      severity,
      savedRecord
    };
    setLogs(prev => [newLog, ...prev].slice(0, 100));
  }, []);

  // ============ 视频模式功能 ============

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      stopVideoPlayback();
      setDetectResult(null);
      
      const validTypes = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-matroska'];
      const validExtensions = /\.(mp4|webm|ogg|mov|mkv|avi)$/i;
      
      if (validTypes.includes(file.type) || validExtensions.test(file.name)) {
        setUploadedVideo(file);
        // 清理旧的 Blob URL
        if (videoUrl) {
          URL.revokeObjectURL(videoUrl);
        }
        const url = URL.createObjectURL(file);
        setVideoUrl(url);
        console.log('[VideoUpload] Created Blob URL:', url, 'File:', file.name, 'Size:', file.size);
        addLog('系统', 'info', `已加载视频: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
        addLog('系统', 'info', '注意：边播边检模式会自动转换视频格式');
      } else {
        addLog('系统', 'error', '不支持的视频格式，请使用 MP4、WebM、MOV、MKV 等格式');
      }
    }
  };

  const processVideo = async () => {
    if (!uploadedVideo) {
      addLog('系统', 'error', '请先上传视频');
      return;
    }

    setIsProcessingVideo(true);
    setDetectProgress({ status: 'uploading', progress: 0, message: '正在上传视频...' });
    addLog('系统', 'info', '开始视频检测...');

    try {
      const result = await videoDetectionService.detectVideo(uploadedVideo, {
        frameInterval: 5,
        maxFrames: 200,
        confidenceThreshold: confidenceThreshold,
        iouThreshold: 0.45,
        userId: user?.id?.toString(),
        username: user?.user_metadata?.username || user?.email || '未知操作员',
        onProgress: (progress) => {
          setDetectProgress(progress);
          if (progress.status === 'processing') {
            addLog('系统', 'info', progress.message);
          }
          if (progress.error) {
            addLog('系统', 'error', progress.error);
          }
        }
      });

      setDetectResult(result);
      setVideoInfo({
        fps: result.video_info.fps,
        width: result.video_info.width,
        height: result.video_info.height,
        duration: result.video_info.duration,
        totalFrames: result.frames.length
      });
      
      const totalDefectsInVideo = result.frames.reduce((sum, f) => sum + f.defect_count, 0);
      addLog('系统', 'info', `检测完成: 共 ${result.frames.length} 帧，检测到 ${totalDefectsInVideo} 个缺陷`);
      
      if (result.frames.length > 0) {
        drawVideoFrame(result.frames[0]);
        setCurrentFrameIndex(0);
      }
      
    } catch (error: any) {
      addLog('系统', 'error', `检测失败: ${error.message}`);
    } finally {
      setIsProcessingVideo(false);
    }
  };

  // ============ 边播放边检测功能 ============

  // 开始边播放边检测
  const startRealtimeDetection = (videoEl: HTMLVideoElement, canvasEl: HTMLCanvasElement) => {
    if (isRealtimeDetecting) {
      console.log('[RealtimeDetection] Already detecting');
      return;
    }
    
    console.log('[RealtimeDetection] Starting realtime detection');
    setIsRealtimeDetecting(true);
    setRealtimeTotalDefects(0);
    addLog('系统', 'info', '开始视频实时检测...');
    
    realtimeDetectorRef.current = videoDetectionService.createRealtimeDetector(videoEl, canvasEl, {
      detectInterval: 500,
      confidenceThreshold: confidenceThreshold,
      iouThreshold: 0.45,
      onDetection: (frame) => {
        // 实时更新检测统计
        if (frame.defect_count > 0) {
          setRealtimeTotalDefects(prev => prev + frame.defect_count);
          const defectTypes = frame.detections.map(d => d.class).join(', ');
          addLog('检测', 'warning', 
            `检测到 ${frame.defect_count} 个缺陷 [${defectTypes}] ${(frame.detections[0]?.confidence * 100).toFixed(0)}%`
          );
        }
      },
      onStatsUpdate: (stats) => {
        setRealtimeFps(stats.fps);
      },
      onError: (error) => {
        console.error('[RealtimeDetection] Error:', error);
        addLog('系统', 'error', `检测错误: ${error.message}`);
      }
    });
    
    realtimeDetectorRef.current.start();
  };

  // 停止边播放边检测
  const stopRealtimeDetection = () => {
    if (realtimeDetectorRef.current) {
      realtimeDetectorRef.current.stop();
      realtimeDetectorRef.current = null;
    }
    setIsRealtimeDetecting(false);
    setRealtimeFps(0);
    addLog('系统', 'info', '已停止边播放边检测');
  };
  
  // ============ 视频实时流功能 ============
  
  // 处理实时帧数据
  const processRealtimeFrame = useCallback(async () => {
    if (!realtimeSessionId) return;
    
    try {
      // 每次都使用 'play' action，让后端自动播放
      const response = await fetch(
        `${apiService.getBaseUrl()}/api/video/realtime/frame?session_id=${realtimeSessionId}&action=play`
      );
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || '获取帧失败');
      }
      
      const result = await response.json();
      
      if (result.success && result.data) {
        const data = result.data;
        
        // 更新状态
        setRealtimeCurrentFrame(data.current_frame);
        setRealtimeTotalFrames(data.total_frames);
        setRealtimeTimestamp(data.timestamp);
        setIsRealtimePlaying(data.is_playing);
        
        // 绘制帧图片到 Canvas
        console.log('[RealtimeStream] Frame data:', data.frame_data ? `length=${data.frame_data.length}` : 'null');
        if (data.frame_data && data.frame_data.length > 0 && realtimeFrameRef) {
          const canvas = realtimeFrameRef;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            // 设置 Canvas 尺寸
            const videoWidth = data.video_width || 640;
            const videoHeight = data.video_height || 480;
            
            // 确保 Canvas 尺寸已设置
            if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
              canvas.width = videoWidth;
              canvas.height = videoHeight;
              console.log('[RealtimeStream] Canvas resized to:', videoWidth, 'x', videoHeight);
            }
            
            // 处理 base64 数据（后端已返回 data:image/jpeg;base64,... 格式）
            const src = data.frame_data;
            
            const img = new Image();
            img.onload = () => {
              console.log('[RealtimeStream] Image loaded:', img.width, 'x', img.height);
              // 确保 Canvas 尺寸与图片匹配
              if (canvas.width !== img.width || canvas.height !== img.height) {
                canvas.width = img.width;
                canvas.height = img.height;
              }
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            };
            img.onerror = (e) => {
              console.error('[RealtimeStream] Image load error:', e);
            };
            img.src = src;
          }
        } else {
          console.warn('[RealtimeStream] No frame_data or canvas ref');
        }
        
        // 更新检测框
        if (data.detections && data.detections.length > 0) {
          const videoWidth = data.video_width || 640;
          const videoHeight = data.video_height || 480;
          
          const newBoxes: DetectionBox[] = data.detections.map((det: any, idx: number) => {
            const className = det.class || det.type || '未知';
            const conf = det.confidence || 0;
            
            let bx = det.bbox?.x || det.x || 0;
            let by = det.bbox?.y || det.y || 0;
            let bw = det.bbox?.width || det.width || 50;
            let bh = det.bbox?.height || det.height || 50;
            
            return {
              id: `${Date.now()}-${idx}`,
              type: className,
              confidence: conf,
              x: (bx / videoWidth) * 100,
              y: (by / videoHeight) * 100,
              width: (bw / videoWidth) * 100,
              height: (bh / videoHeight) * 100,
              color: DEFECT_COLOR_MAP[className] || '#ef4444'
            };
          });
          
          setDetectionBoxes(newBoxes);
          
          // 更新缺陷统计
          setRealtimeTotalDefects(prev => prev + data.defect_count);
          
          // 记录日志
          if (data.defect_count > 0) {
            const defectTypes = data.detections.map((d: any) => d.class || d.type).join(', ');
            addLog('检测', 'warning', 
              `帧 ${data.current_frame}: 检测到 ${data.defect_count} 个缺陷 [${defectTypes}]`
            );
          }
        } else {
          setDetectionBoxes([]);
        }
        
        // 如果播放结束，停止检测
        if (!data.is_playing) {
          console.log('[RealtimeStream] Playback ended');
          setIsRealtimeDetecting(false);
          return;
        }
      }
    } catch (error: any) {
      console.error('[RealtimeStream] Error:', error);
      // 静默处理，避免刷屏
    }
    
    // 继续轮询
    const shouldContinue = realtimeSessionId && isRealtimeDetecting;
    if (shouldContinue) {
      realtimePollRef.current = window.setTimeout(() => {
        processRealtimeFrame();
      }, 200);  // 每200ms获取一帧，加快速度
    }
  }, [realtimeSessionId, realtimeFrameRef]);
  
  // 开始视频实时流检测
  const startRealtimeStream = useCallback(() => {
    if (!realtimeSessionId) {
      addLog('系统', 'error', '视频会话未启动');
      return;
    }
    
    console.log('[RealtimeStream] Starting stream detection');
    isShouldContinueRef.current = true;
    setIsRealtimeDetecting(true);
    setIsRealtimePlaying(true);
    setRealtimeTotalDefects(0);
    setDetectionBoxes([]);
    addLog('系统', 'info', '开始视频实时检测...');
    
    // 轮询会自动由 useEffect 触发
  }, [realtimeSessionId]);
  
  // 停止视频实时流检测
  const stopRealtimeStream = useCallback(async () => {
    if (realtimePollRef.current) {
      clearTimeout(realtimePollRef.current);
      realtimePollRef.current = null;
    }
    
    setIsRealtimeDetecting(false);
    setIsRealtimePlaying(false);
    
    if (realtimeSessionId) {
      try {
        await fetch(`${apiService.getBaseUrl()}/api/video/realtime/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: realtimeSessionId })
        });
      } catch (error) {
        console.error('[RealtimeStream] Failed to stop session:', error);
      }
      setRealtimeSessionId(null);
    }
    
    addLog('系统', 'info', '已停止视频实时检测');
  }, [realtimeSessionId]);
  
  // 暂停/继续视频实时流
  const pauseRealtimeStream = async () => {
    isShouldContinueRef.current = false;
    setIsRealtimePlaying(false);
    // 清除现有的轮询
    if (realtimePollRef.current) {
      clearTimeout(realtimePollRef.current);
      realtimePollRef.current = null;
    }
    // 调用后端暂停
    if (realtimeSessionId) {
      try {
        await fetch(`${apiService.getBaseUrl()}/api/video/realtime/frame?session_id=${realtimeSessionId}&action=pause`);
      } catch (e) {
        console.error('[RealtimeMode] Pause error:', e);
      }
    }
    console.log('[RealtimeMode] Paused');
  };
  
  const resumeRealtimeStream = () => {
    isShouldContinueRef.current = true;
    setIsRealtimePlaying(true);
    // 继续轮询会在 useEffect 中自动触发
  };
  
  // 设置帧 Canvas ref
  const setFrameCanvasRef = (el: HTMLCanvasElement | null) => {
    setRealtimeFrameRef(el);
  };

  // 暂停/继续边播放边检测
  const pauseRealtimeDetection = () => {
    if (realtimeDetectorRef.current) {
      realtimeDetectorRef.current.pause();
    }
  };

  const resumeRealtimeDetection = () => {
    if (realtimeDetectorRef.current) {
      realtimeDetectorRef.current.resume();
    }
  };

  // 设置refs回调
  const setVideoElementRef = (el: HTMLVideoElement | null) => {
    setRealtimeVideoRef(el);
    // video元素挂载后，如果已经有足够的数据，立即初始化canvas
    if (el && el.readyState >= 1 && realtimeCanvasRef) {
      realtimeCanvasRef.width = el.videoWidth;
      realtimeCanvasRef.height = el.videoHeight;
      console.log('[VideoRef] Initialized canvas from ref callback:', el.videoWidth, 'x', el.videoHeight);
    }
  };

  const setCanvasElementRef = (el: HTMLCanvasElement | null) => {
    setRealtimeCanvasRef(el);
    // canvas元素挂载后，如果video已经有数据，立即初始化
    if (el && realtimeVideoRef && realtimeVideoRef.readyState >= 1) {
      el.width = realtimeVideoRef.videoWidth;
      el.height = realtimeVideoRef.videoHeight;
      console.log('[CanvasRef] Initialized canvas from ref callback:', el.width, 'x', el.height);
    }
  };

  // 开始/停止实时检测按钮处理
  const toggleRealtimeDetection = () => {
    console.log('[RealtimeDetection] toggleRealtimeDetection called', {
      isRealtimeDetecting,
      hasVideoRef: !!realtimeVideoRef,
      hasCanvasRef: !!realtimeCanvasRef
    });
    
    if (isRealtimeDetecting) {
      console.log('[RealtimeDetection] Stopping detection');
      stopRealtimeDetection();
    } else if (!realtimeVideoRef || !realtimeCanvasRef) {
      console.error('[RealtimeDetection] Video or Canvas ref is null!');
      addLog('系统', 'error', '视频元素未初始化，请刷新页面');
    } else {
      console.log('[RealtimeDetection] Starting detection');
      startRealtimeDetection(realtimeVideoRef, realtimeCanvasRef);
    }
  };

  // 切换到边播放边检测模式 - 上传视频到后端，后端用 OpenCV 读取并检测
  const switchToRealtimeMode = async () => {
    console.log('[switchToRealtimeMode] Called', { uploadedVideo: !!uploadedVideo });
    
    // 停止现有的播放和检测
    stopVideoPlayback();
    stopRealtimeDetection();
    stopRealtimeStream();  // 停止之前的实时流
    setIsPlaying(false);
    setDetectResult(null);
    
    // 确保视频已加载
    if (!uploadedVideo) {
      console.error('[switchToRealtimeMode] No uploadedVideo');
      addLog('系统', 'error', '请先上传视频');
      return;
    }
    
    addLog('系统', 'info', '正在启动视频实时检测...');
    setIsStartingRealtime(true);
    
    try {
      // 上传视频到后端，启动会话
      const formData = new FormData();
      formData.append('file', uploadedVideo);
      formData.append('confidence_threshold', String(confidenceThreshold));
      formData.append('iou_threshold', '0.45');
      formData.append('user_id', user?.id?.toString() || '');
      formData.append('username', user?.user_metadata?.username || user?.email || '未知操作员');
      
      const response = await fetch(`${apiService.getBaseUrl()}/api/video/realtime/start`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || '启动视频会话失败');
      }
      
      const result = await response.json();
      
      if (result.success) {
        setRealtimeSessionId(result.data.session_id);
        setRealtimeVideoInfo(result.data.video_info);
        setRealtimeTotalFrames(result.data.video_info.total_frames);
        setRealtimeCurrentFrame(0);
        setRealtimeTimestamp(0);
        setIsStartingRealtime(false);
        
        console.log('[switchToRealtimeMode] Session started:', result.data.session_id);
        addLog('系统', 'info', `视频已加载: ${result.data.video_info.total_frames} 帧, ${result.data.video_info.fps} FPS`);
        addLog('系统', 'info', '点击播放按钮开始检测');
        
        // 不自动开始，等待用户点击播放按钮
        setIsRealtimeDetecting(false);
        setIsRealtimePlaying(false);
        setRealtimeTotalDefects(0);
        setDetectionBoxes([]);
        
      } else {
        throw new Error('启动视频会话失败');
      }
      
    } catch (error: any) {
      console.error('[switchToRealtimeMode] Error:', error);
      addLog('系统', 'error', `启动视频实时检测失败: ${error.message}`);
      setIsStartingRealtime(false);
    }
  };

  // 切换到批量检测模式
  const switchToBatchMode = () => {
    setIsStartingRealtime(false);  // 重置启动状态
    stopRealtimeStream();  // 停止实时流
    setVideoSubMode('batch');
  };

  // 保存当前实时检测帧
  const saveRealtimeFrame = async () => {
    if (!realtimeCanvasRef || !realtimeVideoRef) {
      addLog('系统', 'error', '没有可保存的帧');
      return;
    }

    setIsSavingImage(true);
    addLog('系统', 'info', '正在保存当前帧...');

    try {
      // 从canvas获取当前标注帧
      const dataUrl = realtimeCanvasRef.toDataURL('image/jpeg', 0.9);
      const base64Data = dataUrl.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/jpeg' });
      const file = new File([blob], `realtime_frame_${Date.now()}.jpg`, { type: 'image/jpeg' });

      // 上传到后端
      const formData = new FormData();
      formData.append('file', file);
      formData.append('user_id', user?.id?.toString() || '');
      formData.append('username', user?.user_metadata?.username || user?.email || '未知操作员');
      formData.append('confidence_threshold', String(confidenceThreshold));
      formData.append('iou_threshold', '0.45');
      formData.append('detection_type', 'video');

      const response = await fetch(`${apiService.getBaseUrl()}/api/model/predict`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('保存失败');
      }

      const result = await response.json();
      if (result.success) {
        addLog('系统', 'success', '帧已保存到历史记录');
      } else {
        throw new Error(result.message || '保存失败');
      }
    } catch (error: any) {
      addLog('系统', 'error', `保存失败: ${error.message}`);
    } finally {
      setIsSavingImage(false);
    }
  };

  // ============ 批量检测模式函数 ============

  const drawVideoFrame = (frame: DetectedFrame) => {
    const canvas = canvasRef.current;
    if (!canvas || !frame.annotated_image) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = frame.annotated_image;
  };

  const startVideoPlayback = () => {
    if (!detectResult || detectResult.frames.length === 0) return;
    
    setIsPlaying(true);
    const interval = 1000 / playbackFps;
    
    playTimerRef.current = window.setInterval(() => {
      setCurrentFrameIndex(prev => {
        const nextFrame = prev + 1;
        if (nextFrame >= detectResult.frames.length) {
          clearInterval(playTimerRef.current!);
          setIsPlaying(false);
          return 0;
        }
        drawVideoFrame(detectResult.frames[nextFrame]);
        return nextFrame;
      });
    }, interval);
  };

  const pauseVideoPlayback = () => {
    if (playTimerRef.current) {
      clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    }
    setIsPlaying(false);
  };

  const stopVideoPlayback = () => {
    pauseVideoPlayback();
    setCurrentFrameIndex(0);
    if (detectResult && detectResult.frames.length > 0) {
      drawVideoFrame(detectResult.frames[0]);
    }
  };

  const seekVideoTo = (index: number) => {
    if (!detectResult || index < 0 || index >= detectResult.frames.length) return;
    setCurrentFrameIndex(index);
    drawVideoFrame(detectResult.frames[index]);
  };

  // 保存视频当前帧到历史记录
  const saveVideoFrameToHistory = async () => {
    if (!detectResult || currentFrameIndex >= detectResult.frames.length) {
      addLog('系统', 'error', '没有可保存的帧');
      return;
    }

    const frame = detectResult.frames[currentFrameIndex];
    if (!frame.annotated_image) {
      addLog('系统', 'error', '当前帧没有标注图片');
      return;
    }

    setIsSavingImage(true);
    addLog('系统', 'info', '正在保存当前帧到历史记录...');

    try {
      // 将 base64 转换为 File
      const base64Data = frame.annotated_image.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/jpeg' });
      const file = new File([blob], `video_frame_${Date.now()}.jpg`, { type: 'image/jpeg' });

      // 调用 predict API 保存到 detection_records 表，detection_type='video'
      const result = await apiService.predict(file, {
        userId: user?.id?.toString(),
        username: user?.user_metadata?.username || user?.email || '未知操作员',
        confidenceThreshold: confidenceThreshold,
        detectionType: 'video'
      });

      // 从检测结果中获取缺陷信息
      const detections = frame.detections || [];
      const defectCount = detections.length;
      const defectType = detections[0]?.class || '未知';
      const conf = detections[0]?.confidence || 0;

      // 保存到日志记录 - 使用驼峰格式以匹配详情弹窗
      const savedRecord: any = {
        id: result.record_id || Date.now().toString(),
        sourceType: 'video',
        sourceName: uploadedVideo?.name || `视频帧 ${currentFrameIndex + 1}`,
        defectType: defectType,
        confidence: conf,
        severity: conf > 0.8 ? 'error' : conf > 0.5 ? 'warning' : 'info',
        message: `视频帧: 检测到 ${defectCount} 个缺陷`,
        imageUrl: result.filename ? `/uploads/camera/${result.filename}` : '',
        saved: true,
        createdAt: new Date().toISOString(),
        // 额外的详细信息
        resultImageUrl: result.result?.annotated_image || '',
        defectCount: defectCount,
        detectionTime: new Date().toISOString(),
        detections: detections.map((d: any) => ({
          class: d.class || d.type || '未知',
          confidence: d.confidence || 0,
          bbox: d.bbox || { x: 0, y: 0, width: 0, height: 0 }
        }))
      };

      addLog('系统', 'success',
        `已保存帧 ${currentFrameIndex + 1} 到历史记录${defectCount > 0 ? `，检测到 ${defectCount} 个缺陷` : ''}`,
        savedRecord
      );
    } catch (error: any) {
      addLog('系统', 'error', `保存失败: ${error.message}`);
    } finally {
      setIsSavingImage(false);
    }
  };

  // 保存摄像头当前帧到历史记录
  const saveCameraFrameToHistory = async () => {
    const video = cameraVideoRef.current;
    if (!video || !isCameraActive) {
      addLog('摄像头', 'error', '摄像头未激活，无法保存');
      return;
    }

    setIsSavingImage(true);
    addLog('摄像头', 'info', '正在保存当前帧到历史记录...');

    try {
      // 截取当前帧
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建画布上下文');

      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

      // 转换 base64 为 File
      const base64Data = dataUrl.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/jpeg' });
      const file = new File([blob], `camera_frame_${Date.now()}.jpg`, { type: 'image/jpeg' });

      // 上传到后端
      const result = await apiService.predict(file, {
        userId: user?.id?.toString(),
        username: user?.user_metadata?.username || user?.email || '未知操作员',
        confidenceThreshold: confidenceThreshold,
        detectionType: 'camera'
      });

      // 获取保存的记录详情
      if (result && result.result) {
        const detections = result.result.detections || [];
        const savedRecord = {
          id: result.record_id || Date.now().toString(),
          imageUrl: result.filename ? `/uploads/single/${result.filename}` : '',
          resultImageUrl: result.result.annotated_image || '',
          defectType: detections[0]?.class || '未知',
          defectCount: result.result.count || 0,
          confidence: detections[0]?.confidence || 0,
          detectionTime: new Date().toISOString(),
          sourceType: 'camera' as const,
          sourceName: selectedCameraId || '摄像头',
          detections: detections.map((d: any) => ({
            class: d.class || d.type || '未知',
            confidence: d.confidence || 0,
            bbox: d.bbox || { x: 0, y: 0, width: 0, height: 0 }
          }))
        };

        addLog('摄像头', 'success', `已保存当前帧到历史记录，检测到 ${savedRecord.defectCount} 个缺陷`, savedRecord);
      } else {
        addLog('摄像头', 'success', '已保存当前帧到历史记录');
      }
    } catch (error: any) {
      addLog('摄像头', 'error', `保存失败: ${error.message}`);
    } finally {
      setIsSavingImage(false);
    }
  };

  const exportVideo = async () => {
    if (!detectResult || detectResult.frames.length === 0) return;
    
    addLog('系统', 'info', '正在生成标注视频...');
    
    try {
      const { downloadUrl } = await videoDetectionService.exportAnnotatedVideo(detectResult.frames, {
        fps: playbackFps,
      });
      
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `annotated_video_${Date.now()}.webm`;
      a.click();
      
      addLog('系统', 'info', '标注视频已导出');
    } catch (error: any) {
      addLog('系统', 'error', `导出失败: ${error.message}`);
    }
  };

  // ============ 摄像头模式功能 ============

  // 获取可用摄像头列表
  const loadCameraDevices = async () => {
    // 检查 mediaDevices API 是否可用（需要安全上下文：localhost 或 HTTPS）
    if (!navigator.mediaDevices) {
      setCameraError('当前页面非安全连接（需要 localhost 或 HTTPS），无法使用摄像头');
      addLog('摄像头', 'error', 'mediaDevices API 不可用');
      return false;
    }

    try {
      // 先请求权限，这样才能获取到设备列表
      await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (error: any) {
      console.error('获取摄像头权限失败:', error.name, error.message);

      // 尝试枚举设备（不请求权限），判断是否有物理摄像头
      let hasCamera = false;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        hasCamera = devices.some(d => d.kind === 'videoinput');
      } catch {}

      if (error.name === 'NotAllowedError') {
        setCameraError('摄像头权限被拒绝，请在浏览器设置中允许访问摄像头');
      } else if (error.name === 'NotFoundError' || !hasCamera) {
        setCameraError('未检测到摄像头设备');
      } else if (error.name === 'NotReadableError') {
        setCameraError('摄像头被其他应用占用，请关闭后重试');
      } else {
        // SecurityError 等：非安全上下文（需要通过 localhost 或 HTTPS 访问）
        const isSecure = window.isSecureContext;
        setCameraError(
          isSecure
            ? '无法访问摄像头，请检查系统摄像头驱动'
            : '当前页面非安全连接（需要 localhost 或 HTTPS），无法使用摄像头'
        );
      }
      addLog('摄像头', 'error', error.message || '无法获取摄像头列表');
      return false;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');

      setCameraDevices(videoDevices);

      if (videoDevices.length === 0) {
        setCameraError('未检测到摄像头设备');
        addLog('摄像头', 'error', '未检测到摄像头设备');
        return false;
      }

      // 如果只有一个设备，自动选中
      if (videoDevices.length === 1) {
        setSelectedCameraId(videoDevices[0].deviceId);
      } else if (!selectedCameraId) {
        // 默认选择第一个设备
        setSelectedCameraId(videoDevices[0].deviceId);
      }

      return true;
    } catch (error: any) {
      console.error('枚举摄像头设备失败:', error);
      setCameraError('无法获取摄像头列表，请刷新页面重试');
      addLog('摄像头', 'error', '无法获取摄像头列表');
      return false;
    }
  };

  const startCamera = async () => {
    setCameraError(null);
    setIsCameraLoading(true);
    setIsConnectingCamera(true);
    
    // 如果还没有加载设备列表，先加载
    if (cameraDevices.length === 0) {
      const hasDevices = await loadCameraDevices();
      if (!hasDevices) {
        setIsCameraLoading(false);
        setIsConnectingCamera(false);
        return;
      }
    }
    
    addLog('摄像头', 'info', '正在连接摄像头...');

    try {
      // 构建视频约束
      const videoConstraints: MediaTrackConstraints = {
        width: { ideal: 1280, min: 640 },
        height: { ideal: 720, min: 480 },
      };
      
      // 如果选择了特定设备，添加设备 ID 约束
      if (selectedCameraId) {
        (videoConstraints as any).deviceId = { exact: selectedCameraId };
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false
      });

      streamRef.current = stream;
      
      const videoEl = cameraVideoRef.current;
      if (!videoEl) {
        throw new Error('视频元素未初始化');
      }
      
      // 设置视频源
      videoEl.srcObject = stream;
      
      // 等待视频加载完成
      await new Promise<void>((resolve, reject) => {
        const onCanPlay = () => {
          videoEl.removeEventListener('canplay', onCanPlay);
          videoEl.removeEventListener('error', onError);
          resolve();
        };
        const onError = () => {
          videoEl.removeEventListener('canplay', onCanPlay);
          videoEl.removeEventListener('error', onError);
          reject(new Error('视频加载失败'));
        };
        
        videoEl.addEventListener('canplay', onCanPlay);
        videoEl.addEventListener('error', onError);
        videoEl.load(); // 开始加载
      });
      
      // 开始播放
      await videoEl.play();
      
      console.log('摄像头启动成功，视频尺寸:', videoEl.videoWidth, 'x', videoEl.videoHeight);
      
      // 获取当前使用的设备名称
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      const deviceLabel = settings.deviceId || '未知设备';
      
      addLog('摄像头', 'info', `摄像头已连接: ${videoEl.videoWidth}x${videoEl.videoHeight}`);

      setIsCameraActive(true);
      setIsConnectingCamera(false);
      setIsDetecting(true);
      setTotalDefects(0);
      setDetectionBoxes([]);
      frameCountRef.current = 0;
      lastFpsTimeRef.current = Date.now();
      fpsCounterRef.current = 0;
      setShowDeviceSelect(false);

      // 开始检测循环
      startCameraDetection();

    } catch (error: any) {
      console.error('摄像头访问失败:', error);
      let errorMsg = '无法访问摄像头';
      
      // 解析错误信息
      const errorName = error?.name || '';
      const errorMessage = error?.message || error?.toString() || '';
      
      if (errorName === 'NotAllowedError' || errorMessage.includes('Permission')) {
        errorMsg = '摄像头权限被拒绝，请在浏览器设置中允许访问摄像头';
      } else if (errorName === 'NotFoundError' || errorMessage.includes('DevicesNotFound')) {
        errorMsg = '未找到摄像头设备，请确认摄像头已连接';
      } else if (errorName === 'NotReadableError' || errorMessage.includes('TrackStartError')) {
        errorMsg = '摄像头被其他应用占用，请关闭其他使用摄像头的程序';
      } else if (errorName === 'OverconstrainedError' || errorMessage.includes('overconstrained')) {
        errorMsg = '摄像头不支持请求的分辨率，请检查摄像头设置';
      } else {
        errorMsg = `无法访问摄像头: ${errorMessage}`;
      }
      
      setCameraError(errorMsg);
      setIsCameraActive(false);
      setIsConnectingCamera(false);
      addLog('摄像头', 'error', errorMsg);
    } finally {
      setIsCameraLoading(false);
      setIsConnectingCamera(false);
    }
  };

  const stopCamera = () => {
    // 停止检测循环
    if (detectTimerRef.current) {
      clearInterval(detectTimerRef.current);
      detectTimerRef.current = null;
    }

    // 停止摄像头流
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }

    setIsCameraActive(false);
    setIsDetecting(false);
    setCameraFps(0);
    setDetectionBoxes([]);
    
    addLog('摄像头', 'info', '摄像头已断开');
  };

  const startCameraDetection = () => {
    if (detectTimerRef.current) return;

    const detectInterval = 2000; // 每2秒检测一次，减少API调用频率

    detectTimerRef.current = window.setInterval(async () => {
      await processCameraFrame();
    }, detectInterval);
  };

  const processCameraFrame = async () => {
    const video = cameraVideoRef.current;
    const canvas = videoCanvasRef.current;
    if (!video || !canvas) return;
    
    // 等待视频准备好
    if (video.readyState < 2) {
      console.log('视频未准备好, readyState:', video.readyState);
      return;
    }

    try {
      // 获取视频尺寸
      const videoWidth = video.videoWidth || 640;
      const videoHeight = video.videoHeight || 480;
      
      console.log('处理帧, videoWidth:', videoWidth, 'videoHeight:', videoHeight, 'paused:', video.paused);

      // 如果视频尺寸为 0，说明视频可能没有正确加载
      if (videoWidth === 0 || videoHeight === 0) {
        console.log('视频尺寸为0，等待元数据加载...');
        return;
      }

      // 绘制当前帧到 canvas
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = videoWidth;
      canvas.height = videoHeight;
      ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

      // FPS 计算
      frameCountRef.current++;
      fpsCounterRef.current++;
      const now = Date.now();
      if (now - lastFpsTimeRef.current >= 1000) {
        setCameraFps(fpsCounterRef.current);
        fpsCounterRef.current = 0;
        lastFpsTimeRef.current = now;
      }

      // 转换为 Blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('Canvas toBlob failed'));
        }, 'image/jpeg', 0.8);
      });

      const file = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });

      // 调用 API 检测
      const result = await apiService.predict(file, {
        userId: user?.id?.toString(),
        username: user?.user_metadata?.username || user?.email || '未知操作员',
        confidenceThreshold: confidenceThreshold,
        detectionType: 'camera'
      });

      const detectionData = result?.result || result || {};
      const detections = detectionData?.detections || [];
      
      // 更新检测框 (使用百分比坐标，相对于视频容器)
      const newBoxes: DetectionBox[] = detections.map((det: any, idx: number) => {
        const className = det.class || det.type || '未知';
        const conf = det.confidence || 0;
        
        let bx = det.bbox?.x || det.x || 0;
        let by = det.bbox?.y || det.y || 0;
        let bw = det.bbox?.width || det.width || 50;
        let bh = det.bbox?.height || det.height || 50;

        return {
          id: `${Date.now()}-${idx}`,
          type: className,
          confidence: conf,
          x: (bx / videoWidth) * 100,
          y: (by / videoHeight) * 100,
          width: (bw / videoWidth) * 100,
          height: (bh / videoHeight) * 100,
          color: DEFECT_COLOR_MAP[className] || '#ef4444'
        };
      });

      setDetectionBoxes(newBoxes);

      // 更新缺陷总数
      if (detections.length > 0) {
        setTotalDefects(prev => prev + detections.length);
        
        // 记录日志
        const defect = detections[0];
        const className = defect.class || defect.type || '未知';
        const conf = defect.confidence || 0;
        addLog('检测', conf > 0.8 ? 'error' : 'warning', 
          `检测到${className}，置信度 ${(conf * 100).toFixed(1)}%`);
      }

    } catch (error) {
      // 静默处理检测错误，避免刷屏
    }
  };

  // ============ 渲染 ============

  const currentFrame = detectResult?.frames[currentFrameIndex];
  const totalDefectsInVideo = detectResult?.frames.reduce((sum, f) => sum + f.defect_count, 0) || 0;

  return (
    <div className="space-y-4 p-4" style={{ minHeight: 'calc(100vh - 56px)' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">
            {initialMode === 'camera' ? '摄像头检测' : '视频检测'}
          </h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            {initialMode === 'camera' ? '支持RTSP流和本地摄像头实时检测' : '支持视频文件批量检测和实时检测'}
          </p>
        </div>
      </div>

      {/* ============ 视频检测模式 ============ */}
      {initialMode !== 'camera' && mode === 'video' && (
        <div className="grid grid-cols-12 gap-2">
          {/* 主视频区域 */}
          <div className="col-span-9 space-y-2 flex flex-col">
            <div
              ref={containerRef}
              className="relative bg-black rounded-xl overflow-hidden aspect-video border border-[var(--border-color)] flex-1 min-h-0"
            >
              {/* 未上传视频时 - 显示模式选择 */}
              {!uploadedVideo && !detectResult && videoSubMode === 'batch' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <Film size={64} className="text-orange-500 mb-6" />
                  <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">批量检测模式</h2>
                  <p className="text-[var(--text-muted)] text-center mb-6 max-w-md">
                    先完整分析视频，检测所有帧后播放查看结果
                  </p>
                  
                  <div className="flex items-center gap-4 mb-6">
                    <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span>检测精度高</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                      <div className="w-2 h-2 rounded-full bg-amber-400" />
                      <span>需要等待处理</span>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
                  >
                    <Upload size={18} />
                    上传视频开始检测
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/mp4,video/webm,video/ogg,video/quicktime,video/x-matroska,.mp4,.webm,.ogg,.mov,.mkv,.avi"
                    onChange={handleVideoUpload}
                    className="hidden"
                  />
                  
                  <button
                    onClick={() => {
                      stopVideoPlayback();
                      stopRealtimeDetection();
                      setIsPlaying(false);
                      setDetectResult(null);
                      setUploadedVideo(null);
                      if (videoUrl) URL.revokeObjectURL(videoUrl);
                      setVideoUrl(null);
                      setVideoSubMode('realtime');
                    }}
                    className="mt-4 flex items-center gap-2 px-4 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <Activity size={16} />
                    切换到边播边检模式
                  </button>
                </div>
              )}

              {/* 未上传视频时 - 边播边检模式选择 */}
              {!uploadedVideo && !detectResult && videoSubMode === 'realtime' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <Activity size={64} className="text-emerald-500 mb-6" />
                  <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">边播边检模式</h2>
                  <p className="text-[var(--text-muted)] text-center mb-6 max-w-md">
                    实时检测，边播放边显示检测结果
                  </p>
                  
                  <div className="flex items-center gap-4 mb-6">
                    <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span>实时预览</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                      <div className="w-2 h-2 rounded-full bg-amber-400" />
                      <span>无需等待</span>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-6 py-3 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600"
                  >
                    <Upload size={18} />
                    上传视频开始检测
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/mp4,video/webm,video/ogg,video/quicktime,video/x-matroska,.mp4,.webm,.ogg,.mov,.mkv,.avi"
                    onChange={handleVideoUpload}
                    className="hidden"
                  />
                  
                  <button
                    onClick={() => {
                      setIsStartingRealtime(false);
                      stopRealtimeStream();
                      setVideoSubMode('batch');
                    }}
                    className="mt-4 flex items-center gap-2 px-4 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <Zap size={16} />
                    切换到批量检测模式
                  </button>
                </div>
              )}

              {/* 已上传视频 - 批量检测模式处理中 */}
              {uploadedVideo && !detectResult && videoSubMode === 'batch' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <Film size={48} className="text-orange-500 mb-4" />
                  <p className="text-[var(--text-primary)] font-medium">{uploadedVideo.name}</p>
                  <p className="text-[var(--text-muted)] text-sm mt-1">{(uploadedVideo.size / 1024 / 1024).toFixed(2)} MB</p>
                  
                  {isProcessingVideo ? (
                    <div className="mt-6 flex flex-col items-center">
                      <div className="w-48 h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-orange-500 transition-all duration-300"
                          style={{ width: `${detectProgress.progress}%` }}
                        />
                      </div>
                      <p className="text-sm text-[var(--text-muted)] mt-2">{detectProgress.message}</p>
                    </div>
                  ) : (
                    <div className="mt-6 flex flex-col items-center gap-4">
                      <button
                        onClick={processVideo}
                        className="flex items-center gap-2 px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
                      >
                        <Zap size={18} />
                        开始批量检测
                      </button>
                      <button
                        onClick={() => switchToRealtimeMode()}
                        className="flex items-center gap-2 px-4 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        <Activity size={16} />
                        切换到边播边检
                      </button>
                      <button
                        onClick={() => {
                          setUploadedVideo(null);
                          if (videoUrl) URL.revokeObjectURL(videoUrl);
                          setVideoUrl(null);
                        }}
                        className="text-sm text-[var(--text-muted)] hover:text-red-400"
                      >
                        重新选择视频
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 已上传视频 - 边播边检模式 */}
              {uploadedVideo && !detectResult && videoSubMode === 'realtime' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <Activity size={48} className="text-emerald-500 mb-4" />
                  <p className="text-[var(--text-primary)] font-medium">{uploadedVideo.name}</p>
                  <p className="text-[var(--text-muted)] text-sm mt-1">{(uploadedVideo.size / 1024 / 1024).toFixed(2)} MB</p>
                  
                  <div className="mt-6 flex flex-col items-center gap-4">
                    <button
                      onClick={() => switchToRealtimeMode()}
                      className="flex items-center gap-2 px-6 py-3 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600"
                    >
                      <Play size={18} />
                      开始边播边检
                    </button>
                    <button
                      onClick={() => {
                        setIsStartingRealtime(false);
                        stopRealtimeStream();
                        setVideoSubMode('batch');
                      }}
                      className="flex items-center gap-2 px-4 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      <Zap size={16} />
                      切换到批量检测
                    </button>
                    <button
                      onClick={() => {
                        setUploadedVideo(null);
                        if (videoUrl) URL.revokeObjectURL(videoUrl);
                        setVideoUrl(null);
                      }}
                      className="text-sm text-[var(--text-muted)] hover:text-red-400"
                    >
                      重新选择视频
                    </button>
                  </div>
                </div>
              )}
              {/* 边播放边检测模式 - 后端读取视频帧，前端显示检测结果 */}
              {videoSubMode === 'realtime' && uploadedVideo && realtimeSessionId && (
                <div className="absolute inset-0 flex items-center justify-center bg-black">
                  {/* 显示当前帧的 Canvas - 使用固定尺寸确保可见性 */}
                  <canvas
                    ref={setFrameCanvasRef}
                    className="max-w-full max-h-full object-contain"
                    style={{ 
                      backgroundColor: '#000',
                      width: '100%',
                      height: '100%',
                      display: 'block'
                    }}
                  />
                  
                  {/* 检测框叠加层 - 禁用，因为后端已返回带标注的图片 */}
                  {/* {detectionBoxes.map((box) => (
                    <motion.div
                      key={box.id}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute border-2 rounded"
                      style={{
                        left: `${box.x}%`,
                        top: `${box.y}%`,
                        width: `${box.width}%`,
                        height: `${box.height}%`,
                        borderColor: box.color,
                        boxShadow: `0 0 10px ${box.color}40`
                      }}
                    >
                      <span
                        className="absolute -top-6 left-0 px-2 py-0.5 text-white text-xs rounded font-medium whitespace-nowrap"
                        style={{ backgroundColor: box.color }}
                      >
                        {box.type} {(box.confidence * 100).toFixed(0)}%
                      </span>
                    </motion.div>
                  ))} */}
                  
                  {/* HUD 状态栏 */}
                  <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
                    <div className="flex items-center gap-4 bg-black/60 backdrop-blur-sm px-4 py-2 rounded-lg border border-white/10">
                      <div className="flex items-center gap-2">
                        <Activity size={16} className="text-emerald-400" />
                        <span className="text-white text-sm font-mono">
                          {realtimeCurrentFrame + 1} / {realtimeTotalFrames}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock size={16} className="text-blue-400" />
                        <span className="text-white text-sm font-mono">
                          {realtimeTimestamp.toFixed(1)}s
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Zap size={16} className="text-orange-400" />
                        <span className="text-white text-sm">YOLOv11</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isRealtimeDetecting ? 'bg-emerald-400 animate-pulse' : 'bg-gray-400'}`} />
                        <span className="text-white text-sm">{isRealtimeDetecting ? '检测中' : '已停止'}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <div className="bg-black/60 backdrop-blur-sm px-3 py-2 rounded-lg border border-white/10 text-white text-sm">
                        <span className="text-gray-400">帧: </span>
                        <span className="font-mono">{realtimeCurrentFrame}</span>
                      </div>
                      <div className="bg-black/60 backdrop-blur-sm px-3 py-2 rounded-lg border border-white/10 text-white text-sm">
                        <span className="text-gray-400">缺陷: </span>
                        <span className="font-mono text-red-400">{realtimeTotalDefects}</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* 控制栏 */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 z-10">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {/* 播放/暂停 - 点击播放自动开始检测 */}
                        <button
                          onClick={() => {
                            if (isRealtimePlaying) {
                              // 正在播放 → 暂停
                              pauseRealtimeStream();
                            } else if (isRealtimeDetecting) {
                              // 正在检测但暂停 → 继续播放
                              resumeRealtimeStream();
                            } else {
                              // 未开始检测 → 点击播放自动开始检测
                              startRealtimeStream();
                            }
                          }}
                          className="p-3 bg-orange-500 hover:bg-orange-600 rounded-full text-white"
                        >
                          {isRealtimePlaying ? <Pause size={24} /> : <Play size={24} />}
                        </button>
                        
                        {/* 停止检测 */}
                        <button
                          onClick={() => {
                            stopRealtimeStream();
                          }}
                          className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors bg-red-500 text-white hover:bg-red-600"
                        >
                          <Square size={16} />
                          停止
                        </button>
                        
                        {/* 下载当前帧 */}
                        {realtimeSessionId && (
                          <button
                            onClick={() => {
                              // 从Canvas获取当前帧图片并下载
                              if (realtimeFrameRef) {
                                const canvas = realtimeFrameRef;
                                const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
                                const link = document.createElement('a');
                                link.download = `frame_${realtimeCurrentFrame}_${Date.now()}.jpg`;
                                link.href = dataUrl;
                                link.click();
                                addLog('系统', 'success', `已下载第 ${realtimeCurrentFrame} 帧图片`);
                              } else {
                                addLog('系统', 'error', '无法获取当前帧');
                              }
                            }}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors bg-blue-500 text-white hover:bg-blue-600"
                          >
                            <Download size={16} />
                            下载帧
                          </button>
                        )}
                        
                        {/* 保存到历史记录 */}
                        {realtimeSessionId && (
                          <button
                            onClick={async () => {
                              // 暂停检测以便保存当前帧
                              const wasPlaying = isRealtimePlaying;
                              if (wasPlaying) {
                                await pauseRealtimeStream();
                              }
                              
                              if (realtimeFrameRef) {
                                const canvas = realtimeFrameRef;
                                const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
                                
                                // 转换为 Blob
                                const response = await fetch(dataUrl);
                                const blob = await response.blob();
                                const file = new File([blob], `video_frame_${Date.now()}.jpg`, { type: 'image/jpeg' });
                                
                                setIsSavingImage(true);
                                addLog('系统', 'info', '正在保存到历史记录...');
                                
                                try {
                                  // 使用 predict API 保存到 detection_records 表，detection_type='video'
                                  const result = await apiService.predict(file, {
                                    userId: user?.id?.toString(),
                                    username: user?.user_metadata?.username || user?.email || '未知操作员',
                                    confidenceThreshold: confidenceThreshold,
                                    detectionType: 'video'
                                  });
                                  
                                  addLog('系统', 'success', '已保存到历史记录');
                                } catch (e) {
                                  addLog('系统', 'error', `保存失败: ${e}`);
                                } finally {
                                  setIsSavingImage(false);
                                }
                              }
                            }}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors bg-green-500 text-white hover:bg-green-600"
                          >
                            <Save size={16} />
                            保存历史
                          </button>
                        )}
                        )}
                      </div>
                      
                      {/* 进度条 */}
                      <div className="flex-1 mx-4">
                        <input
                          type="range"
                          min={0}
                          max={Math.max(0, realtimeTotalFrames - 1)}
                          value={realtimeCurrentFrame}
                          onChange={async (e) => {
                            const frame = parseInt(e.target.value);
                            setRealtimeCurrentFrame(frame);
                            try {
                              await fetch(
                                `${apiService.getBaseUrl()}/api/video/realtime/frame?session_id=${realtimeSessionId}&action=seek&frame_index=${frame}`
                              );
                            } catch (err) {
                              console.error('Seek error:', err);
                            }
                          }}
                          className="w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer accent-orange-500"
                        />
                      </div>
                      
                      {/* 实时统计 */}
                      <div className="flex items-center gap-4 text-white text-sm">
                        {isRealtimeDetecting && (
                          <>
                            <div className="flex items-center gap-1">
                              <Activity size={14} className="text-emerald-400" />
                              <span>检测中</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <AlertTriangle size={14} className="text-red-400" />
                              <span>缺陷: {realtimeTotalDefects}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* 模式切换 */}
                  <div className="absolute top-4 right-4 z-10">
                    <button
                      onClick={() => {
                        stopRealtimeStream();
                        setVideoSubMode('batch');
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 bg-black/50 text-white text-sm rounded-lg hover:bg-black/70"
                    >
                      <Zap size={14} />
                      切换批量检测
                    </button>
                  </div>
                </div>
              )}
              
              {/* 边播边检模式 - 视频上传后显示开始按钮 */}
              {videoSubMode === 'realtime' && uploadedVideo && !realtimeSessionId && !isStartingRealtime && (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <Activity size={48} className="text-emerald-500 mb-4" />
                  <p className="text-[var(--text-primary)] font-medium">{uploadedVideo.name}</p>
                  <p className="text-[var(--text-muted)] text-sm mt-1">{(uploadedVideo.size / 1024 / 1024).toFixed(2)} MB</p>
                  
                  <div className="mt-6 flex flex-col items-center gap-4">
                    <button
                      onClick={() => switchToRealtimeMode()}
                      className="flex items-center gap-2 px-6 py-3 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600"
                    >
                      <Play size={18} />
                      开始边播边检
                    </button>
                    <button
                      onClick={() => {
                        setIsStartingRealtime(false);
                        stopRealtimeStream();
                        setVideoSubMode('batch');
                      }}
                      className="flex items-center gap-2 px-4 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      <Zap size={16} />
                      切换到批量检测
                    </button>
                    <button
                      onClick={() => {
                        setUploadedVideo(null);
                        if (videoUrl) URL.revokeObjectURL(videoUrl);
                        setVideoUrl(null);
                      }}
                      className="text-sm text-[var(--text-muted)] hover:text-red-400"
                    >
                      重新选择视频
                    </button>
                  </div>
                </div>
              )}
              
              {/* 边播边检模式 - 正在启动中 */}
              {videoSubMode === 'realtime' && uploadedVideo && (isStartingRealtime || (!realtimeSessionId && isStartingRealtime)) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <Loader2 size={48} className="text-emerald-500 mb-4 animate-spin" />
                  <p className="text-[var(--text-primary)] font-medium">正在启动视频实时检测...</p>
                  <p className="text-[var(--text-muted)] text-sm mt-2">后端正在处理视频，请稍候</p>
                </div>
              )}

              {detectResult && detectResult.frames.length > 0 && (
                <>
                  <canvas 
                    ref={canvasRef}
                    className="max-w-full max-h-full"
                    style={{ 
                      objectFit: 'contain',
                      display: 'block',
                      margin: 'auto',
                      backgroundColor: '#000'
                    }}
                  />
                  
                  {/* 控制栏 */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                    <div className="mb-3">
                      <input
                        type="range"
                        min={0}
                        max={(detectResult.frames.length || 1) - 1}
                        value={currentFrameIndex}
                        onChange={(e) => seekVideoTo(parseInt(e.target.value))}
                        className="w-full h-1 bg-gray-600 rounded-full appearance-none cursor-pointer accent-orange-500"
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button onClick={() => seekVideoTo(0)} className="p-2 hover:bg-white/20 rounded-lg text-white">
                          <SkipBack size={18} />
                        </button>
                        <button onClick={() => seekVideoTo(Math.max(0, currentFrameIndex - 10))} className="p-2 hover:bg-white/20 rounded-lg text-white">
                          <ChevronLeft size={18} />
                        </button>
                        <button
                          onClick={isPlaying ? pauseVideoPlayback : startVideoPlayback}
                          className="p-3 bg-orange-500 hover:bg-orange-600 rounded-full text-white"
                        >
                          {isPlaying ? <Pause size={24} /> : <Play size={24} />}
                        </button>
                        <button onClick={() => seekVideoTo(Math.min(detectResult.frames.length - 1, currentFrameIndex + 10))} className="p-2 hover:bg-white/20 rounded-lg text-white">
                          <ChevronRight size={18} />
                        </button>
                        <button onClick={stopVideoPlayback} className="p-2 hover:bg-white/20 rounded-lg text-white">
                          <Square size={18} />
                        </button>
                        
                        <select
                          value={playbackFps}
                          onChange={(e) => setPlaybackFps(parseInt(e.target.value))}
                          className="ml-4 px-2 py-1 bg-white/20 text-white text-sm rounded border-none outline-none"
                        >
                          <option value={5}>5 FPS</option>
                          <option value={10}>10 FPS</option>
                          <option value={15}>15 FPS</option>
                          <option value={30}>30 FPS</option>
                        </select>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        <div className="text-white text-sm">
                          <span className="font-mono">{currentFrameIndex + 1}</span>
                          <span className="text-gray-400 mx-1">/</span>
                          <span className="font-mono">{detectResult.frames.length}</span>
                          <span className="text-gray-400 ml-2">帧</span>
                        </div>
                        
                        <div className="flex items-center gap-2 text-white">
                          <AlertTriangle size={16} className="text-red-400" />
                          <span className="font-mono">{currentFrame?.defect_count || 0}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* 检测信息 */}
                  {currentFrame && currentFrame.detections.length > 0 && (
                    <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-sm rounded-lg p-3 max-w-xs">
                      <div className="text-white text-xs mb-2">当前帧检测结果</div>
                      <div className="space-y-1">
                        {currentFrame.detections.slice(0, 3).map((det, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs">
                            <span className="text-white">{det.class}</span>
                            <span className="text-orange-400">{(det.confidence * 100).toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 视频信息栏 */}
            {detectResult && (
              <div className="flex items-center justify-between bg-[var(--bg-card)] rounded-lg p-3 border border-[var(--border-color)]">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <FilmIcon size={16} className="text-[var(--text-muted)]" />
                    <span className="text-sm text-[var(--text-secondary)]">视频信息</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
                    <span>{videoInfo.width}×{videoInfo.height}</span>
                    <span>{videoInfo.fps} FPS</span>
                    <span>{videoInfo.duration.toFixed(1)}秒</span>
                  </div>
                </div>
                      <div className="flex items-center gap-4">
                        <span className="text-[var(--text-muted)]">共 <span className="text-white font-mono">{detectResult.frames.length}</span> 帧</span>
                        <span className="text-[var(--text-muted)]">检测到 <span className="text-red-400 font-mono">{totalDefectsInVideo}</span> 个缺陷</span>
                        {/* 下载当前帧按钮 */}
                        <button
                          onClick={() => {
                            const frame = detectResult?.frames[currentFrameIndex];
                            if (frame?.annotated_image) {
                              // 下载标注图片
                              const link = document.createElement('a');
                              link.href = frame.annotated_image;
                              link.download = `缺陷检测_帧${currentFrameIndex + 1}_${Date.now()}.jpg`;
                              link.click();
                              addLog('系统', 'success', `已下载第 ${currentFrameIndex + 1} 帧标注图片`);
                            } else {
                              addLog('系统', 'error', '当前帧没有标注图片');
                            }
                          }}
                          disabled={!currentFrame?.annotated_image}
                          className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <ImageIcon size={14} />
                          下载图片
                        </button>
                        {/* 导出详细信息按钮 */}
                        <button
                          onClick={() => {
                            const frame = detectResult?.frames[currentFrameIndex];
                            if (frame) {
                              // 生成详细信息文本
                              const now = new Date();
                              let info = `=== 缺陷检测报告 ===\n`;
                              info += `生成时间: ${now.toLocaleString('zh-CN')}\n`;
                              info += `视频信息: ${videoInfo.width}×${videoInfo.height}, ${videoInfo.fps} FPS\n`;
                              info += `帧信息: 第 ${currentFrameIndex + 1} / ${detectResult.frames.length} 帧\n`;
                              info += `检测时间: ${frame.timestamp || now.toISOString()}\n`;
                              info += `\n--- 检测结果 ---\n`;
                              info += `缺陷数量: ${frame.defect_count} 个\n`;
                              if (frame.detections && frame.detections.length > 0) {
                                info += `\n详细列表:\n`;
                                frame.detections.forEach((det: any, idx: number) => {
                                  info += `\n[${idx + 1}] ${det.class || '未知缺陷'}\n`;
                                  info += `  置信度: ${((det.confidence || 0) * 100).toFixed(2)}%\n`;
                                  if (det.bbox) {
                                    info += `  位置: (${det.bbox.x}, ${det.bbox.y})\n`;
                                    info += `  尺寸: ${det.bbox.width}×${det.bbox.height}\n`;
                                  }
                                });
                              }
                              info += `\n--- 报告结束 ---\n`;
                              
                              // 下载文本文件
                              const blob = new Blob([info], { type: 'text/plain;charset=utf-8' });
                              const url = URL.createObjectURL(blob);
                              const link = document.createElement('a');
                              link.href = url;
                              link.download = `缺陷报告_帧${currentFrameIndex + 1}_${Date.now()}.txt`;
                              link.click();
                              URL.revokeObjectURL(url);
                              addLog('系统', 'success', `已导出第 ${currentFrameIndex + 1} 帧详细信息`);
                            }
                          }}
                          disabled={!currentFrame}
                          className="flex items-center gap-2 px-3 py-1.5 bg-purple-500 text-white rounded-lg hover:bg-purple-600 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <FileText size={14} />
                          导出报告
                        </button>
                        <button
                          onClick={saveVideoFrameToHistory}
                          disabled={isSavingImage || isPlaying}
                          className="flex items-center gap-2 px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Save size={14} />
                          {isSavingImage ? '保存中...' : '保存当前帧'}
                        </button>
                        <button
                          onClick={exportVideo}
                          className="flex items-center gap-2 px-3 py-1.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm"
                        >
                          <Download size={14} />
                          导出视频
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 右侧面板 */}
          <div className="col-span-3 space-y-2">
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border-color)]">
                <h3 className="text-sm font-medium text-[var(--text-primary)]">检测日志</h3>
              </div>
              <div ref={logContainerRef} className="max-h-64 overflow-y-auto p-2 space-y-2">
                {logs.length === 0 ? (
                  <div className="text-center py-4 text-[var(--text-muted)]">
                    <Clock size={20} className="mx-auto mb-2 opacity-50" />
                    <p className="text-xs">暂无日志</p>
                  </div>
                ) : (
                  logs.map((log) => (
                    <div
                      key={log.id}
                      className={`p-2 rounded-lg text-xs cursor-pointer transition-all hover:scale-[1.02] ${
                        log.severity === 'error' 
                          ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                          : log.severity === 'warning'
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          : log.severity === 'success'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                      } ${log.savedRecord ? 'ring-2 ring-orange-500/30' : ''}`}
                      onClick={() => log.savedRecord && setSelectedSavedLog(log)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium flex items-center gap-1">
                          {log.type}
                          {log.savedRecord && <ImageIcon size={10} />}
                        </span>
                        <span className="opacity-70">{log.timestamp}</span>
                      </div>
                      <p className="opacity-80">{log.message}</p>
                      {log.savedRecord && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-[10px] bg-orange-500/20 px-1.5 py-0.5 rounded">
                            {log.savedRecord.defectCount}个缺陷
                          </span>
                          <span className="text-[10px] opacity-70">
                            {(log.savedRecord.confidence * 100).toFixed(0)}%置信度
                          </span>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============ 摄像头模式 ============ */}
      {initialMode === 'camera' && (
        <div className="grid grid-cols-12 gap-2">
          {/* 主摄像头区域 */}
          <div className="col-span-9 space-y-2 flex flex-col">
            <div
              ref={containerRef}
              className="relative bg-black rounded-xl overflow-hidden aspect-video border border-[var(--border-color)] flex-1 min-h-0"
            >
              {!isCameraActive && !isCameraLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <Webcam size={64} className="text-[var(--text-muted)] mb-4" />
                  <p className="text-[var(--text-muted)]">摄像头未连接</p>
                  
                  {cameraError && (
                    <div className="mt-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg max-w-md">
                      <p className="text-red-400 text-sm text-center">{cameraError}</p>
                    </div>
                  )}
                  
                  {/* 设备选择区域 */}
                  <div className="mt-4 w-full max-w-md px-4">
                    <div className="bg-[var(--bg-tertiary)] rounded-lg p-4 space-y-4">
                      {/* 摄像头选择 */}
                      <div>
                        <label className="block text-sm text-[var(--text-secondary)] mb-2">选择摄像头设备</label>
                        <select
                          value={selectedCameraId}
                          onChange={(e) => setSelectedCameraId(e.target.value)}
                          className="w-full px-3 py-2 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-orange-500"
                        >
                          <option value="">-- 选择摄像头 --</option>
                          {cameraDevices.map((device, index) => (
                            <option key={device.deviceId} value={device.deviceId}>
                              {device.label || `摄像头 ${index + 1}`}
                            </option>
                          ))}
                        </select>
                        {cameraDevices.length === 0 && (
                          <p className="text-xs text-[var(--text-muted)] mt-2">
                            点击"扫描设备"获取可用摄像头列表
                          </p>
                        )}
                      </div>
                      
                      {/* 扫描设备按钮 */}
                      <button
                        onClick={async () => {
                          const hasDevices = await loadCameraDevices();
                          if (hasDevices && cameraDevices.length > 1) {
                            addLog('系统', 'info', `发现 ${cameraDevices.length} 个摄像头设备`);
                          }
                        }}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/30"
                      >
                        <RefreshCw size={16} />
                        扫描设备
                      </button>
                      
                      {/* 连接按钮 */}
                      <button
                        onClick={startCamera}
                        disabled={!selectedCameraId}
                        className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg ${
                          selectedCameraId
                            ? 'bg-orange-500 text-white hover:bg-orange-600'
                            : 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        <Camera size={18} />
                        {selectedCameraId ? '连接摄像头' : '请先选择摄像头'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {isCameraLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  >
                    <RefreshCw size={48} className="text-orange-500 mb-4" />
                  </motion.div>
                  <p className="text-[var(--text-muted)]">正在连接摄像头...</p>
                </div>
              )}

              {(isCameraActive || isConnectingCamera) && (
                <>
                  {/* 摄像头视频 - 直接显示 */}
                  <video
                    ref={cameraVideoRef}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' }}
                    playsInline
                    muted
                    autoPlay
                  />
                  
                  {/* 用于截取帧的 Canvas (隐藏) */}
                  <canvas
                    ref={videoCanvasRef}
                    style={{ display: 'none' }}
                  />
                  
                  {/* 检测框叠加层 - 仅在摄像头完全激活时显示 */}
                  {isCameraActive && detectionBoxes.map((box) => (
                    <motion.div
                      key={box.id}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute border-2 rounded"
                      style={{
                        left: `${box.x}%`,
                        top: `${box.y}%`,
                        width: `${box.width}%`,
                        height: `${box.height}%`,
                        borderColor: box.color,
                        boxShadow: `0 0 10px ${box.color}40`
                      }}
                    >
                      <span
                        className="absolute -top-6 left-0 px-2 py-0.5 text-white text-xs rounded font-medium whitespace-nowrap"
                        style={{ backgroundColor: box.color }}
                      >
                        {box.type} {(box.confidence * 100).toFixed(0)}%
                      </span>
                    </motion.div>
                  ))}
                  
                  {/* HUD 状态栏 - 仅在摄像头完全激活时显示 */}
                  {isCameraActive && (
                    <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
                      <div className="flex items-center gap-4 bg-black/60 backdrop-blur-sm px-4 py-2 rounded-lg border border-white/10">
                        <div className="flex items-center gap-2">
                          <Activity size={16} className="text-emerald-400" />
                          <span className="text-white text-sm font-mono">{cameraFps} FPS</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Zap size={16} className="text-orange-400" />
                          <span className="text-white text-sm">YOLOv11</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${isDetecting ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                          <span className="text-white text-sm">{isDetecting ? '检测中' : '已暂停'}</span>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <div className="bg-black/60 backdrop-blur-sm px-3 py-2 rounded-lg border border-white/10 text-white text-sm">
                          <span className="text-gray-400">帧: </span>
                          <span className="font-mono">{frameCountRef.current}</span>
                        </div>
                        <div className="bg-black/60 backdrop-blur-sm px-3 py-2 rounded-lg border border-white/10 text-white text-sm">
                          <span className="text-gray-400">缺陷: </span>
                          <span className="font-mono text-red-400">{totalDefects}</span>
                        </div>
                        <button
                          onClick={() => {
                            const elem = containerRef.current;
                            if (elem) {
                              if (document.fullscreenElement) {
                                document.exitFullscreen();
                              } else {
                                elem.requestFullscreen();
                              }
                            }
                          }}
                          className="p-2 bg-black/60 backdrop-blur-sm text-white rounded-lg hover:bg-black/80 border border-white/10"
                        >
                          <Maximize size={18} />
                        </button>
                      </div>
                    </div>
                  )}
                  
                  {/* 控制栏 - 仅在摄像头完全激活时显示 */}
                  {isCameraActive && (
                    <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={stopCamera}
                          className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm"
                        >
                          <CameraOff size={16} />
                          断开摄像头
                        </button>
                        <button
                          onClick={saveCameraFrameToHistory}
                          disabled={isSavingImage}
                          className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Save size={16} />
                          {isSavingImage ? '保存中...' : '保存当前帧'}
                        </button>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <label className="text-white text-sm">置信度:</label>
                          <input
                            type="range"
                            min="0.1"
                            max="1"
                            step="0.05"
                            value={confidenceThreshold}
                            onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                            className="w-24 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-orange-500"
                          />
                          <span className="text-white text-sm font-mono w-12">{confidenceThreshold.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* AI 处理中提示 - 仅在摄像头完全激活时显示 */}
                  {isCameraActive && (
                    <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 bg-black/70 backdrop-blur-sm text-white px-4 py-2 rounded-full text-sm flex items-center gap-2">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      >
                        <RefreshCw size={14} />
                      </motion.div>
                      AI推理中...
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 摄像头状态栏 */}
            {(isCameraActive || isConnectingCamera) && (
              <div className="flex items-center justify-between bg-[var(--bg-card)] rounded-lg p-3 border border-[var(--border-color)]">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-sm text-[var(--text-secondary)]">摄像头已连接</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
                  <span>实时检测模式</span>
                  <span>|</span>
                  <span>检测间隔: 1秒</span>
                </div>
              </div>
            )}
          </div>

          {/* 右侧面板 */}
          <div className="col-span-3 space-y-2">
            {/* 参数设置 */}
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-3">
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2 flex items-center gap-2">
                <Settings size={14} className="text-[var(--text-muted)]" />
                检测参数
              </h3>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-[var(--text-muted)]">置信度阈值</label>
                    <span className="text-xs font-mono text-[var(--text-primary)]">{confidenceThreshold.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={confidenceThreshold}
                    onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                    className="w-full h-2 bg-[var(--bg-tertiary)] rounded-lg appearance-none cursor-pointer accent-orange-500"
                  />
                </div>
              </div>
            </div>

            {/* 检测日志 */}
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between">
                <h3 className="text-sm font-medium text-[var(--text-primary)]">检测日志</h3>
                <button
                  onClick={() => setLogs([])}
                  className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-muted)]"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div ref={logContainerRef} className="max-h-64 overflow-y-auto p-2 space-y-2">
                {logs.length === 0 ? (
                  <div className="text-center py-4 text-[var(--text-muted)]">
                    <Clock size={20} className="mx-auto mb-2 opacity-50" />
                    <p className="text-xs">暂无日志</p>
                  </div>
                ) : (
                  logs.map((log) => (
                    <div
                      key={log.id}
                      className={`p-2 rounded-lg text-xs cursor-pointer transition-all hover:scale-[1.02] ${
                        log.severity === 'error' 
                          ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                          : log.severity === 'warning'
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          : log.severity === 'success'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                      } ${log.savedRecord ? 'ring-2 ring-orange-500/30' : ''}`}
                      onClick={() => log.savedRecord && setSelectedSavedLog(log)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium flex items-center gap-1">
                          {log.type}
                          {log.savedRecord && <ImageIcon size={10} />}
                        </span>
                        <span className="opacity-70">{log.timestamp}</span>
                      </div>
                      <p className="opacity-80">{log.message}</p>
                      {log.savedRecord && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-[10px] bg-orange-500/20 px-1.5 py-0.5 rounded">
                            {log.savedRecord.defectCount}个缺陷
                          </span>
                          <span className="text-[10px] opacity-70">
                            {(log.savedRecord.confidence * 100).toFixed(0)}%置信度
                          </span>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 使用说明 */}
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-3">
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2 flex items-center gap-2">
                <Webcam size={14} className="text-[var(--text-muted)]" />
                摄像头检测说明
              </h3>
              <div className="space-y-1 text-xs text-[var(--text-muted)]">
                <div className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-orange-500/20 text-orange-500 flex items-center justify-center flex-shrink-0 text-center text-[10px]">1</span>
                  <p>点击"连接摄像头"按钮</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-orange-500/20 text-orange-500 flex items-center justify-center flex-shrink-0 text-center text-[10px]">2</span>
                  <p>允许浏览器访问摄像头的权限</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-orange-500/20 text-orange-500 flex items-center justify-center flex-shrink-0 text-center text-[10px]">3</span>
                  <p>系统将自动从摄像头画面中检测缺陷</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-orange-500/20 text-orange-500 flex items-center justify-center flex-shrink-0 text-center text-[10px]">4</span>
                  <p>检测框会实时叠加在视频画面上</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 保存记录详情弹窗 */}
      <AnimatePresence>
        {selectedSavedLog && selectedSavedLog.savedRecord && (
          <motion.div
            key="saved-record-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
            onClick={() => setSelectedSavedLog(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[var(--bg-card)] rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden border border-[var(--border-color)]"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    selectedSavedLog.savedRecord.sourceType === 'video'
                      ? 'bg-blue-500/20'
                      : 'bg-emerald-500/20'
                  }`}>
                    {selectedSavedLog.savedRecord.sourceType === 'video' ? (
                      <FileVideo size={20} className="text-blue-500" />
                    ) : (
                      <Camera size={20} className="text-emerald-500" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-base font-medium text-[var(--text-primary)]">
                      保存的检测记录
                      <span className={`ml-2 inline-block px-2 py-0.5 rounded text-xs ${
                        selectedSavedLog.savedRecord.sourceType === 'video'
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'bg-emerald-500/20 text-emerald-400'
                      }`}>
                        {selectedSavedLog.savedRecord.sourceType === 'video' ? '视频检测' : '摄像头检测'}
                      </span>
                    </h3>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      保存时间: {new Date(selectedSavedLog.savedRecord.detectionTime).toLocaleString('zh-CN')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selectedSavedLog.savedRecord.resultImageUrl && (
                    <>
                      <button
                        onClick={() => setSavedLogFullscreen(true)}
                        className="flex items-center gap-1 px-3 py-2 text-sm text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                      >
                        <Maximize size={16} />
                        全屏
                      </button>
                      <button
                        onClick={() => {
                          const a = document.createElement('a');
                          a.href = selectedSavedLog.savedRecord!.resultImageUrl!.startsWith('data:')
                            ? selectedSavedLog.savedRecord!.resultImageUrl!
                            : `/uploads${selectedSavedLog.savedRecord!.resultImageUrl}`;
                          a.download = `检测截图_${selectedSavedLog.id}.png`;
                          a.click();
                        }}
                        className="flex items-center gap-1 px-3 py-2 text-sm text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors"
                      >
                        <Download size={16} />
                        下载
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setSelectedSavedLog(null)}
                    className="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-secondary)]"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 100px)' }}>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* 左侧：图片预览 */}
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-[var(--text-primary)]">检测截图</h4>
                        {selectedSavedLog.savedRecord.resultImageUrl && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setSavedLogZoom(z => Math.max(0.5, z - 0.25))}
                              className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)]"
                            >
                              <ZoomOut size={14} />
                            </button>
                            <span className="text-xs text-[var(--text-muted)] w-12 text-center">
                              {Math.round(savedLogZoom * 100)}%
                            </span>
                            <button
                              onClick={() => setSavedLogZoom(z => Math.min(3, z + 0.25))}
                              className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)]"
                            >
                              <ZoomIn size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                      <div
                        className="bg-[var(--bg-tertiary)]/50 rounded-lg overflow-hidden flex items-center justify-center cursor-pointer"
                        style={{ height: '300px' }}
                        onClick={() => selectedSavedLog.savedRecord?.resultImageUrl && setSavedLogFullscreen(true)}
                      >
                        {selectedSavedLog.savedRecord.resultImageUrl ? (
                          <img
                            src={selectedSavedLog.savedRecord.resultImageUrl.startsWith('data:')
                              ? selectedSavedLog.savedRecord.resultImageUrl
                              : `/uploads${selectedSavedLog.savedRecord.resultImageUrl}`}
                            alt="检测截图"
                            className="max-w-full max-h-full object-contain transition-transform"
                            style={{ transform: `scale(${savedLogZoom})` }}
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-[var(--text-muted)]">
                            <ImageIcon size={48} className="mb-2 opacity-50" />
                            <p className="text-sm">暂无截图</p>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-2 text-center">
                        点击图片可全屏查看
                      </p>
                    </div>
                  </div>

                  {/* 右侧：详细信息 */}
                  <div className="space-y-4">
                    {/* 检测结果摘要 */}
                    <div className="bg-gradient-to-r from-orange-500/10 to-orange-600/10 rounded-xl border border-orange-500/20 p-4">
                      <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">检测结果</h4>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-[var(--bg-card)]/50 rounded-lg p-3">
                          <div className="text-xs text-[var(--text-muted)] mb-1">来源</div>
                          <div className="flex items-center gap-2">
                            {selectedSavedLog.savedRecord.sourceType === 'video' ? (
                              <FileVideo size={16} className="text-blue-500" />
                            ) : (
                              <Camera size={16} className="text-emerald-500" />
                            )}
                            <span className="text-sm font-medium text-[var(--text-primary)]">
                              {selectedSavedLog.savedRecord.sourceType === 'video' ? '视频' : '摄像头'}
                            </span>
                          </div>
                        </div>
                        <div className="bg-[var(--bg-card)]/50 rounded-lg p-3">
                          <div className="text-xs text-[var(--text-muted)] mb-1">缺陷数量</div>
                          <div className="text-xl font-bold text-orange-500">
                            {selectedSavedLog.savedRecord.defectCount}
                          </div>
                        </div>
                        <div className="bg-[var(--bg-card)]/50 rounded-lg p-3">
                          <div className="text-xs text-[var(--text-muted)] mb-1">置信度</div>
                          <div className="text-xl font-bold text-emerald-500">
                            {(selectedSavedLog.savedRecord.confidence * 100).toFixed(1)}%
                          </div>
                        </div>
                        <div className="bg-[var(--bg-card)]/50 rounded-lg p-3">
                          <div className="text-xs text-[var(--text-muted)] mb-1">缺陷类型</div>
                          <div className="text-sm font-medium text-[var(--text-primary)]">
                            {selectedSavedLog.savedRecord.defectType || '无'}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 详细信息 */}
                    <div className="bg-[var(--bg-tertiary)]/30 rounded-xl border border-[var(--border-color)] p-4">
                      <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">详细信息</h4>
                      <div className="space-y-3">
                        <div className="flex items-start justify-between">
                          <span className="text-xs text-[var(--text-muted)]">来源类型</span>
                          <span className="text-sm text-[var(--text-primary)]">
                            {selectedSavedLog.savedRecord.sourceType === 'video' ? '视频文件检测' : '实时摄像头检测'}
                          </span>
                        </div>
                        <div className="flex items-start justify-between">
                          <span className="text-xs text-[var(--text-muted)]">设备/文件</span>
                          <span className="text-sm text-[var(--text-primary)]">{selectedSavedLog.savedRecord.sourceName}</span>
                        </div>
                        <div className="flex items-start justify-between">
                          <span className="text-xs text-[var(--text-muted)]">保存时间</span>
                          <span className="text-sm text-[var(--text-primary)]">
                            {new Date(selectedSavedLog.savedRecord.detectionTime).toLocaleString('zh-CN')}
                          </span>
                        </div>
                        <div className="flex items-start justify-between">
                          <span className="text-xs text-[var(--text-muted)]">记录ID</span>
                          <span className="text-sm font-mono text-[var(--text-secondary)]">#{selectedSavedLog.savedRecord.id}</span>
                        </div>
                      </div>
                    </div>

                    {/* 缺陷位置详情 */}
                    {selectedSavedLog.savedRecord.detections && selectedSavedLog.savedRecord.detections.length > 0 && (
                      <div className="bg-[var(--bg-tertiary)]/30 rounded-xl border border-[var(--border-color)] p-4">
                        <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">缺陷位置信息</h4>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {selectedSavedLog.savedRecord.detections.map((det, idx) => (
                            <div key={idx} className="bg-[var(--bg-card)]/50 rounded-lg p-2 text-xs">
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-medium text-orange-400">#{idx + 1} {det.class}</span>
                                <span className="text-emerald-400">{(det.confidence * 100).toFixed(1)}%</span>
                              </div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[var(--text-secondary)] font-mono">
                                <span>X: {Math.round(det.bbox.x)}</span>
                                <span>Y: {Math.round(det.bbox.y)}</span>
                                <span>W: {Math.round(det.bbox.width)}</span>
                                <span>H: {Math.round(det.bbox.height)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 操作提示 */}
                    <div className="bg-blue-500/10 rounded-xl border border-blue-500/20 p-4">
                      <div className="flex items-start gap-3">
                        <Info size={18} className="text-blue-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm text-[var(--text-primary)] font-medium mb-1">查看历史记录</p>
                          <p className="text-xs text-[var(--text-secondary)]">
                            此记录已保存到历史记录，可在"历史记录"页面查看所有保存的检测结果。
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 全屏图片查看器 */}
      <AnimatePresence>
        {savedLogFullscreen && selectedSavedLog?.savedRecord?.resultImageUrl && (
          <motion.div
            key="fullscreen-image-viewer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/95 flex items-center justify-center z-[100]"
            onClick={() => setSavedLogFullscreen(false)}
          >
            <button
              className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-lg text-white/70 hover:text-white transition-colors"
              onClick={() => setSavedLogFullscreen(false)}
            >
              <X size={24} />
            </button>
            <button
              className="absolute top-4 left-4 p-2 hover:bg-white/10 rounded-lg text-white/70 hover:text-white transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                const a = document.createElement('a');
                a.href = selectedSavedLog!.savedRecord!.resultImageUrl!.startsWith('data:')
                  ? selectedSavedLog!.savedRecord!.resultImageUrl!
                  : `/uploads${selectedSavedLog!.savedRecord!.resultImageUrl}`;
                a.download = `检测截图_${selectedSavedLog.id}.png`;
                a.click();
              }}
            >
              <Download size={24} />
            </button>
            <motion.img
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              src={selectedSavedLog!.savedRecord!.resultImageUrl!.startsWith('data:')
                ? selectedSavedLog!.savedRecord!.resultImageUrl!
                : `/uploads${selectedSavedLog!.savedRecord!.resultImageUrl}`}
              alt="全屏查看"
              className="max-w-[95vw] max-h-[95vh] object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CameraDetectionPage;
