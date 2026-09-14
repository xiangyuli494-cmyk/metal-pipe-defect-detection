/**
 * VideoDetectionService - 视频抽帧检测服务
 *
 * 支持两种模式：
 * 1. 批量检测：上传视频到后端，后端用 OpenCV 抽帧 + YOLO 检测，返回标注后的帧序列
 * 2. 边播放边检测：前端使用原生video播放，通过 canvas 叠加标注，实时发送帧到后端检测
 */

import apiService from './ApiService';

export interface DetectedFrame {
  frame_index: number;
  timestamp: number;
  annotated_image: string;  // data:image/jpeg;base64,...
  detections: Array<{
    class: string;
    confidence: number;
    bbox: { x: number; y: number; width: number; height: number };
  }>;
  defect_count: number;
}

export interface VideoInfo {
  total_frames: number;
  fps: number;
  width: number;
  height: number;
  duration: number;
}

export interface VideoDetectResult {
  video_info: VideoInfo;
  frames: DetectedFrame[];
  total_detected: number;
  processing_time: number;
  frame_interval: number;
}

export interface VideoDetectProgress {
  status: 'idle' | 'uploading' | 'processing' | 'completed' | 'error';
  progress: number;         // 0-100
  message: string;
  result?: VideoDetectResult;
  error?: string;
}

class VideoDetectionService {
  private abortController: AbortController | null = null;

  /** 视频相关接口已加鉴权，统一带上 JWT */
  private authHeaders(): Record<string, string> {
    const token = localStorage.getItem('accessToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /**
   * 上传视频并执行抽帧检测
   */
  async detectVideo(
    file: File,
    options: {
      frameInterval?: number;
      maxFrames?: number;
      confidenceThreshold?: number;
      iouThreshold?: number;
      userId?: string;
      username?: string;
      onProgress?: (progress: VideoDetectProgress) => void;
    } = {}
  ): Promise<VideoDetectResult> {
    const {
      frameInterval = 5,
      maxFrames = 200,
      confidenceThreshold = 0.5,
      iouThreshold = 0.45,
      userId,
      username,
      onProgress
    } = options;

    this.abortController = new AbortController();

    // 通知上传开始
    onProgress?.({ status: 'uploading', progress: 0, message: '正在上传视频...' });

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('frame_interval', String(frameInterval));
      formData.append('max_frames', String(maxFrames));
      formData.append('confidence_threshold', String(confidenceThreshold));
      formData.append('iou_threshold', String(iouThreshold));
      if (userId) formData.append('user_id', userId);
      if (username) formData.append('username', username);

      // 通知处理中
      onProgress?.({ status: 'processing', progress: 30, message: '后端正在抽帧检测...' });

      // 使用 fetch 直接调用（因为要传 FormData + File）
      const response = await fetch(`${apiService.getBaseUrl()}/api/video/detect`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: formData,
        signal: this.abortController.signal,
        // 不设置 Content-Type，让浏览器自动设置 multipart/form-data
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `服务器错误: ${response.status}`);
      }

      const json = await response.json();

      if (!json.success) {
        throw new Error(json.detail || '视频检测失败');
      }

      const result: VideoDetectResult = json.data;

      onProgress?.({ status: 'completed', progress: 100, message: '检测完成', result });

      return result;

    } catch (error: any) {
      if (error.name === 'AbortError') {
        onProgress?.({ status: 'error', progress: 0, message: '已取消', error: '已取消' });
        throw error;
      }
      const errMsg = error instanceof Error ? error.message : '视频检测请求失败';
      onProgress?.({ status: 'error', progress: 0, message: errMsg, error: errMsg });
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * 取消正在进行的检测
   */
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * 单帧实时检测 - 用于边播放边检测
   * 
   * @param frameBlob 帧图片的Blob数据
   * @param frameIndex 帧序号
   * @param timestamp 时间戳（秒）
   * @param options 检测参数
   */
  async detectFrame(
    frameBlob: Blob,
    frameIndex: number,
    timestamp: number,
    options: {
      confidenceThreshold?: number;
      iouThreshold?: number;
    } = {}
  ): Promise<DetectedFrame> {
    const { confidenceThreshold = 0.5, iouThreshold = 0.45 } = options;

    try {
      const formData = new FormData();
      formData.append('file', frameBlob, `frame_${frameIndex}.jpg`);
      formData.append('frame_index', String(frameIndex));
      formData.append('timestamp', String(timestamp));
      formData.append('confidence_threshold', String(confidenceThreshold));
      formData.append('iou_threshold', String(iouThreshold));

      const response = await fetch(`${apiService.getBaseUrl()}/api/video/detect-frame`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `服务器错误: ${response.status}`);
      }

      const json = await response.json();
      if (!json.success) {
        throw new Error(json.detail || '帧检测失败');
      }

      return json.data;
    } catch (error) {
      console.error(`帧 ${frameIndex} 检测失败:`, error);
      // 返回空结果而不是抛出错误，避免中断播放
      return {
        frame_index: frameIndex,
        timestamp: timestamp,
        annotated_image: '',
        detections: [],
        defect_count: 0
      };
    }
  }

  /**
   * 边播放边检测 - 创建实时检测控制器
   * 
   * 使用HTML5 video播放视频，同时通过canvas叠加标注，实时检测每一帧
   * 
   * @param videoElement 原始video元素
   * @param canvasElement 叠加标注的canvas元素
   * @param options 检测和播放参数
   */
  createRealtimeDetector(
    videoElement: HTMLVideoElement,
    canvasElement: HTMLCanvasElement,
    options: {
      detectInterval?: number;  // 检测间隔（毫秒），默认500ms检测一次
      confidenceThreshold?: number;
      iouThreshold?: number;
      onDetection?: (frame: DetectedFrame) => void;
      onError?: (error: Error) => void;
      onStatsUpdate?: (stats: { fps: number; totalDetections: number }) => void;
    } = {}
  ) {
    const {
      detectInterval = 500,
      confidenceThreshold = 0.5,
      iouThreshold = 0.45,
      onDetection,
      onError,
      onStatsUpdate
    } = options;

    let isRunning = false;
    let detectTimer: number | null = null;
    let lastFrameIndex = -1;
    let frameCount = 0;
    let startTime = Date.now();
    let totalDetections = 0;
    const ctx = canvasElement.getContext('2d');

    // 将 syncCanvas 定义在外部作用域，让 start 和 stop 都能访问
    let isDrawingAnnotated = false;  // 标记是否正在绘制标注帧
    
    const syncCanvas = () => {
      if (!ctx || !videoElement.src) return;
      if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) return;
      // 如果正在绘制标注帧，不打断
      if (isDrawingAnnotated) return;
      if (canvasElement.width !== videoElement.videoWidth || canvasElement.height !== videoElement.videoHeight) {
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
      }
      // 绘制当前视频帧（无标注）
      ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
      ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
    };

    // 绘制带标注的帧
    const drawAnnotatedFrame = (annotatedImage: string) => {
      if (!ctx) return;
      
      const img = new Image();
      img.onload = () => {
        // 确保canvas尺寸与图片匹配
        if (canvasElement.width !== img.width || canvasElement.height !== img.height) {
          canvasElement.width = img.width;
          canvasElement.height = img.height;
        }
        isDrawingAnnotated = true;
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        ctx.drawImage(img, 0, 0);
        // 短暂延迟后恢复同步
        setTimeout(() => { isDrawingAnnotated = false; }, 100);
      };
      img.onerror = () => {
        console.error('[VideoDetectionService] Failed to load annotated image');
        isDrawingAnnotated = false;
      };
      img.src = annotatedImage;
    };

    // 检测当前帧
    const detectCurrentFrame = async () => {
      if (!isRunning) {
        console.log('[VideoDetectionService] detectCurrentFrame skipped - not running');
        return;
      }
      
      // 确保视频有尺寸
      if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
        console.warn('[VideoDetectionService] Video has no dimensions yet', {
          width: videoElement.videoWidth,
          height: videoElement.videoHeight,
          readyState: videoElement.readyState
        });
        return;
      }

      // 计算当前帧序号（基于播放时间）
      const currentTime = videoElement.currentTime;
      const playbackRate = videoElement.playbackRate || 1;
      const fps = 30 / playbackRate;
      const currentFrameIndex = Math.floor(currentTime * fps);

      console.log('[VideoDetectionService] Processing frame:', {
        currentTime,
        playbackRate,
        fps,
        currentFrameIndex,
        lastFrameIndex,
        paused: videoElement.paused
      });

      // 避免重复检测同一帧（仅在播放时）
      if (!videoElement.paused && currentFrameIndex === lastFrameIndex) {
        console.log('[VideoDetectionService] Skipping - same frame and video is playing');
        return;
      }
      lastFrameIndex = currentFrameIndex;

      try {
        // 从video截取当前帧
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = videoElement.videoWidth;
        tempCanvas.height = videoElement.videoHeight;
        const tempCtx = tempCanvas.getContext('2d');
        if (tempCtx) {
          tempCtx.drawImage(videoElement, 0, 0);
        }

        // 转换为blob
        const blob = await new Promise<Blob>((resolve, reject) => {
          tempCanvas.toBlob((b) => {
            if (b) resolve(b);
            else reject(new Error('无法将帧转换为blob'));
          }, 'image/jpeg', 0.85);
        });

        console.log('[VideoDetectionService] Calling detectFrame API...');

        // 调用检测API
        const result = await this.detectFrame(blob, currentFrameIndex, currentTime, {
          confidenceThreshold,
          iouThreshold
        });

        console.log('[VideoDetectionService] Detection result:', {
          frameIndex: result.frame_index,
          defectCount: result.defect_count,
          hasAnnotatedImage: !!result.annotated_image
        });

        frameCount++;
        totalDetections += result.defect_count;

        // 绘制带标注的帧
        if (result.annotated_image) {
          console.log('[VideoDetectionService] Drawing annotated frame');
          drawAnnotatedFrame(result.annotated_image);
        }

        // 计算FPS
        const elapsed = (Date.now() - startTime) / 1000;
        const currentFps = frameCount / elapsed;

        // 回调
        onDetection?.(result);
        onStatsUpdate?.({ fps: Math.round(currentFps), totalDetections });

      } catch (error) {
        console.error('[VideoDetectionService] Detection error:', error);
        onError?.(error as Error);
      }
    };

    // 开始检测
    const start = async () => {
      console.log('[VideoDetectionService] start() called, isRunning:', isRunning);
      if (isRunning) {
        console.log('[VideoDetectionService] Already running, returning');
        return;
      }
      isRunning = true;
      lastFrameIndex = -1;
      frameCount = 0;
      startTime = Date.now();
      totalDetections = 0;

      console.log('[VideoDetectionService] Video state before sync:', {
        readyState: videoElement.readyState,
        videoWidth: videoElement.videoWidth,
        videoHeight: videoElement.videoHeight,
        paused: videoElement.paused,
        currentTime: videoElement.currentTime
      });

      // 立即尝试绘制（视频可能已经准备好了）
      if (videoElement.readyState >= 1) {
        console.log('[VideoDetectionService] Syncing canvas immediately');
        syncCanvas();
        // 如果视频暂停了，自动开始播放
        if (videoElement.paused) {
          try {
            await videoElement.play();
            console.log('[VideoDetectionService] Video started playing');
          } catch (e) {
            console.error('[VideoDetectionService] Failed to auto-play video:', e);
          }
        }
      }
      
      // 使用 addEventListener 确保事件处理器被注册
      videoElement.addEventListener('loadedmetadata', () => {
        console.log('[VideoDetectionService] loadedmetadata event fired');
        syncCanvas();
        // 视频加载完成后，如果暂停了就自动播放
        if (videoElement.paused && isRunning) {
          videoElement.play().catch(e => console.error('[VideoDetectionService] Auto-play failed:', e));
        }
      }, { once: true });
      
      // 视频播放时同步canvas
      videoElement.addEventListener('play', syncCanvas);
      videoElement.addEventListener('seeked', syncCanvas);
      videoElement.addEventListener('resize', syncCanvas);

      // 启动定时检测
      console.log('[VideoDetectionService] Starting detect timer with interval:', detectInterval);
      detectTimer = window.setInterval(detectCurrentFrame, detectInterval);
      console.log('[VideoDetectionService] Timer started, detectTimer:', detectTimer);
    };

    // 停止检测
    const stop = () => {
      console.log('[VideoDetectionService] stop() called, isRunning:', isRunning);
      isRunning = false;
      if (detectTimer !== null) {
        console.log('[VideoDetectionService] Clearing timer:', detectTimer);
        clearInterval(detectTimer);
        detectTimer = null;
      }
      // 移除事件监听器
      videoElement.removeEventListener('play', syncCanvas);
      videoElement.removeEventListener('seeked', syncCanvas);
      videoElement.removeEventListener('resize', syncCanvas);
      // 清除canvas
      if (ctx) {
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
      }
      console.log('[VideoDetectionService] Stopped, isRunning:', isRunning);
    };

    // 暂停/继续
    const pause = () => {
      if (detectTimer !== null) {
        clearInterval(detectTimer);
        detectTimer = null;
      }
    };

    const resume = () => {
      if (isRunning && detectTimer === null) {
        detectTimer = window.setInterval(detectCurrentFrame, detectInterval);
      }
    };

    return {
      start,
      stop,
      pause,
      resume,
      get isRunning() { return isRunning; },
      get stats() { 
        const elapsed = (Date.now() - startTime) / 1000;
        return { 
          fps: Math.round(frameCount / elapsed),
          totalFrames: frameCount,
          totalDetections 
        }; 
      }
    };
  }

  /**
   * 导出标注视频（将检测帧合成为视频）
   * 使用 Canvas + MediaRecorder API 在前端合成视频
   */
  async exportAnnotatedVideo(
    frames: DetectedFrame[],
    options: {
      fps?: number;
      outputFormat?: 'video/webm';
      onProgress?: (progress: number) => void;
    } = {}
  ): Promise<{ downloadUrl: string; blob: Blob }> {
    const { fps = 10, outputFormat = 'video/webm', onProgress } = options;

    return new Promise((resolve, reject) => {
      try {
        if (frames.length === 0) {
          reject(new Error('没有可导出的帧'));
          return;
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          reject(new Error('无法创建 Canvas 2D 上下文'));
          return;
        }

        // 先加载第一帧获取尺寸
        const firstImg = new Image();
        firstImg.onload = () => {
          canvas.width = firstImg.width;
          canvas.height = firstImg.height;

          // 检查浏览器是否支持请求的格式
          const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            ? 'video/webm;codecs=vp9'
            : 'video/webm';
          
          // 创建 MediaRecorder
          const stream = canvas.captureStream(0);  // 不自动传帧
          const mediaRecorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: 5000000  // 5 Mbps
          });

          const chunks: Blob[] = [];
          mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
              chunks.push(e.data);
            }
          };

          mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: mimeType });
            const downloadUrl = URL.createObjectURL(blob);
            resolve({ downloadUrl, blob });
          };

          mediaRecorder.start(100); // 每 100ms 收集一次数据

          // 逐帧绘制
          let frameIndex = 0;
          const totalFrames = frames.length;
          let startTime = performance.now();

          const drawFrame = () => {
            if (frameIndex >= totalFrames) {
              // 所有帧绘制完成后停止录制
              setTimeout(() => {
                mediaRecorder.stop();
              }, 100);
              return;
            }

            const frame = frames[frameIndex];
            const img = new Image();
            
            img.onload = () => {
              // 清空画布并绘制当前帧
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              
              frameIndex++;
              const progress = Math.round((frameIndex / totalFrames) * 100);
              onProgress?.(progress);

              // 根据 fps 控制帧率（fps = 每秒帧数）
              const delay = 1000 / fps;
              setTimeout(drawFrame, delay);
            };

            img.onerror = () => {
              frameIndex++;
              setTimeout(drawFrame, 0);
            };

            img.src = frame.annotated_image;
          };

          drawFrame();
        };

        firstImg.onerror = () => {
          reject(new Error('无法加载第一帧图片'));
        };

        firstImg.src = frames[0].annotated_image;
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 播放检测后的帧序列（模拟视频播放）
   * 返回一个控制对象
   */
  createFramePlayer(
    container: HTMLElement,
    frames: DetectedFrame[],
    videoInfo: VideoInfo,
    options: {
      fps?: number;
      onFrameChange?: (frame: DetectedFrame, index: number) => void;
      onEnded?: () => void;
    } = {}
  ) {
    const { fps = 10, onFrameChange, onEnded } = options;
    
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.objectFit = 'contain';
    container.appendChild(canvas);
    
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 Canvas');

    let currentFrame = 0;
    let isPlaying = false;
    let animationId: number | null = null;
    let lastFrameTime = 0;
    const frameInterval = 1000 / fps;

    const loadAndDrawFrame = (frame: DetectedFrame) => {
      return new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = frame.annotated_image;
      });
    };

    const play = async () => {
      if (currentFrame >= frames.length) {
        isPlaying = false;
        onEnded?.();
        return;
      }

      isPlaying = true;
      await loadAndDrawFrame(frames[currentFrame]);
      onFrameChange?.(frames[currentFrame], currentFrame);
      currentFrame++;

      if (isPlaying && currentFrame < frames.length) {
        const now = performance.now();
        const elapsed = now - lastFrameTime;
        const delay = Math.max(0, frameInterval - elapsed);
        lastFrameTime = now + delay;
        animationId = window.setTimeout(play, delay);
      } else if (currentFrame >= frames.length) {
        isPlaying = false;
        onEnded?.();
      }
    };

    const pause = () => {
      isPlaying = false;
      if (animationId) {
        clearTimeout(animationId);
        animationId = null;
      }
    };

    const seekTo = async (index: number) => {
      pause();
      currentFrame = Math.max(0, Math.min(index, frames.length - 1));
      await loadAndDrawFrame(frames[currentFrame]);
      onFrameChange?.(frames[currentFrame], currentFrame);
    };

    const destroy = () => {
      pause();
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    };

    return {
      play,
      pause,
      seekTo,
      destroy,
      get currentFrame() { return currentFrame; },
      get totalFrames() { return frames.length; },
      get isPlaying() { return isPlaying; },
    };
  }
}

export const videoDetectionService = new VideoDetectionService();
export default videoDetectionService;
