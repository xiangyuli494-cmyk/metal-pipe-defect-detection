/**
 * API服务 - 与后端Python服务通信
 * 支持云数据库和本地MySQL切换
 */

// 修复：使用相对路径，依赖nginx/webpack代理转发到后端
// 内网穿透环境：请求 /api/* 会被代理到后端 8002
const API_BASE_URL = '';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

// 检测记录
export interface DetectionRecord {
  id: string | number;
  user_id?: string;
  detection_type: 'single' | 'batch' | 'camera' | 'video';
  original_filename?: string;
  filename?: string;
  defect_count: number;
  defect_details?: Array<{
    type: string;
    confidence: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  image_url?: string;
  original_image_url?: string;
  result_image_url?: string;
  processing_time?: number;
  confidence_threshold: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
  updated_at?: string;
}

// 批量检测任务
export interface BatchDetection {
  id: string;
  user_id?: string;
  batch_name: string;
  total_files: number;
  processed_files: number;
  total_defects: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  file_list?: string[];
  created_at: string;
  completed_at?: string;
}

// 摄像头检测日志
export interface CameraDetectionLog {
  id: string;
  user_id?: string;
  source_type: 'camera' | 'video';
  source_name: string;
  defect_type: string;
  confidence: number;
  severity: 'info' | 'warning' | 'error';
  message: string;
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  image_url?: string;
  saved: boolean;
  created_at: string;
}

// 统计数据
export interface Statistics {
  total_detections: number;
  total_defects: number;
  total_batches: number;
  total_camera_logs: number;
}

// 每日统计
export interface DailyStatistics {
  date: string;
  count: number;
  defects: number;
}

// 缺陷类型统计
export interface DefectTypeStatistics {
  type: string;
  count: number;
}

// 系统设置
export interface SystemSettings {
  [key: string]: string;
}

// 模型状态
export interface ModelStatus {
  is_loaded: boolean;
  model_path?: string;
  model_type?: string;
  class_names: string[];
  confidence_threshold: number;
  iou_threshold: number;
}

class ApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  /** 获取后端 API 基础 URL，供外部使用 */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /** 获取 access token */
  private getAccessToken(): string | null {
    return localStorage.getItem('accessToken');
  }

  /** 获取 refresh token */
  private getRefreshToken(): string | null {
    return localStorage.getItem('refreshToken');
  }

  /** 存储 tokens */
  setTokens(accessToken: string, refreshToken: string): void {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
  }

  /** 清除 tokens */
  clearTokens(): void {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('currentUser');
    // 通知 AuthContext 同步状态
    window.dispatchEvent(new CustomEvent('auth:tokenCleared'));
  }

  /** 尝试刷新 token，成功返回新的 access token */
  private async tryRefreshToken(): Promise<string | null> {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return null;

    try {
      const response = await fetch(`${this.baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data?.access_token) {
          localStorage.setItem('accessToken', data.data.access_token);
          return data.data.access_token;
        }
      }
    } catch (e) {
      console.error('Token 刷新失败:', e);
    }

    // 刷新失败，清除所有认证信息
    this.clearTokens();
    return null;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retryOn401: boolean = true
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    // 添加 Authorization header
    const token = this.getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // 401 时尝试刷新 token 并重试
    if (response.status === 401 && retryOn401) {
      const newToken = await this.tryRefreshToken();
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
        const retryResponse = await fetch(url, {
          ...options,
          headers,
        });
        if (!retryResponse.ok) {
          const error = await retryResponse.json().catch(() => ({ message: '请求失败' }));
          throw new Error(error.detail || error.message || `HTTP ${retryResponse.status}`);
        }
        try {
          return await retryResponse.json();
        } catch (error) {
          throw new Error('响应格式错误');
        }
      }
      // 刷新失败，跳转登录页
      window.location.hash = '#/login';
      throw new Error('认证已过期，请重新登录');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: '请求失败' }));
      throw new Error(error.detail || error.message || `HTTP ${response.status}`);
    }

    try {
      return await response.json();
    } catch (error) {
      console.error('JSON parse error:', error, 'Response:', response);
      throw new Error('响应格式错误');
    }
  }

  /**
   * 通用 fetch 封装，支持 FormData 和 blob 响应，自动处理 401 刷新重试。
   * 不强制设置 Content-Type（FormData 需要浏览器自动设置 boundary）。
   */
  private async fetchWithAuth(
    url: string,
    options: RequestInit = {},
    retryOn401: boolean = true
  ): Promise<Response> {
    const token = this.getAccessToken();
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> || {}),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401 && retryOn401) {
      const newToken = await this.tryRefreshToken();
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
        const retryResponse = await fetch(url, { ...options, headers });
        if (!retryResponse.ok) {
          const error = await retryResponse.json().catch(() => ({ message: '请求失败' }));
          throw new Error(error.detail || error.message || `HTTP ${retryResponse.status}`);
        }
        return retryResponse;
      }
      window.location.hash = '#/login';
      throw new Error('认证已过期，请重新登录');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: '请求失败' }));
      throw new Error(error.detail || error.message || `HTTP ${response.status}`);
    }

    return response;
  }

  // ============ 健康检查 ============
  async healthCheck(): Promise<{ status: string; database_type: string }> {
    const response = await this.request<{ status: string; database_type: string }>('/health');
    return response.data!;
  }

  // ============ 检测记录API ============
  async getDetectionRecords(
    userId?: string,
    detectionType?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<DetectionRecord[]> {
    const params = new URLSearchParams();
    // 只有非空字符串才添加到参数
    if (userId && userId.trim()) params.append('user_id', userId);
    if (detectionType && detectionType.trim()) params.append('detection_type', detectionType);
    params.append('limit', limit.toString());
    params.append('offset', offset.toString());

    const response = await this.request<DetectionRecord[]>(
      `/api/detection-records?${params.toString()}`
    );
    return response.data || [];
  }

  async getDetectionRecord(recordId: string): Promise<DetectionRecord> {
    const response = await this.request<DetectionRecord>(`/api/detection-records/${recordId}`);
    return response.data!;
  }

  async createDetectionRecord(data: {
    user_id?: string;
    confidence_threshold?: number;
    iou_threshold?: number;
  }): Promise<DetectionRecord> {
    const response = await this.request<DetectionRecord>('/api/detection-records', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data!;
  }

  async uploadDetectionImage(recordId: string, file: File): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await this.fetchWithAuth(`${this.baseUrl}/api/detection-records/${recordId}/image`, {
      method: 'POST',
      body: formData,
    });

    return response.json();
  }

  async deleteDetectionRecord(recordId: string): Promise<void> {
    await this.request(`/api/detection-records/${recordId}`, {
      method: 'DELETE',
    });
  }

  // ============ 批量检测API ============
  async getBatchDetections(
    userId?: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<BatchDetection[]> {
    const params = new URLSearchParams();
    if (userId) params.append('user_id', userId);
    params.append('limit', limit.toString());
    params.append('offset', offset.toString());

    const response = await this.request<BatchDetection[]>(
      `/api/batch-detections?${params.toString()}`
    );
    return response.data || [];
  }

  async createBatchDetection(data: {
    user_id?: string;
    batch_name: string;
    confidence_threshold?: number;
    iou_threshold?: number;
  }): Promise<BatchDetection> {
    const response = await this.request<BatchDetection>('/api/batch-detections', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data!;
  }

  async uploadBatchFiles(batchId: string, files: File[]): Promise<any> {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));

    const response = await this.fetchWithAuth(`${this.baseUrl}/api/batch-detections/${batchId}/upload`, {
      method: 'POST',
      body: formData,
    });

    return response.json();
  }

  async getBatchStatus(batchId: string): Promise<BatchDetection> {
    const response = await this.request<BatchDetection>(`/api/batch-detections/${batchId}/status`);
    return response.data!;
  }

  // ============ 摄像头检测日志API ============
  async getCameraLogs(
    userId?: string,
    sourceType?: string,
    savedOnly: boolean = false,
    limit: number = 100,
    offset: number = 0
  ): Promise<CameraDetectionLog[]> {
    const params = new URLSearchParams();
    if (userId) params.append('user_id', userId);
    if (sourceType) params.append('source_type', sourceType);
    params.append('saved_only', savedOnly.toString());
    params.append('limit', limit.toString());
    params.append('offset', offset.toString());

    const response = await this.request<CameraDetectionLog[]>(
      `/api/camera-logs?${params.toString()}`
    );
    return response.data || [];
  }

  async createCameraLog(data: {
    user_id?: string;
    source_type: 'camera' | 'video';
    source_name: string;
    defect_type: string;
    confidence: number;
    severity?: 'info' | 'warning' | 'error';
    message: string;
    bbox?: { x: number; y: number; width: number; height: number };
    image_url?: string;
  }): Promise<CameraDetectionLog> {
    const response = await this.request<CameraDetectionLog>('/api/camera-logs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data!;
  }

  async saveCameraLogs(logIds: string[], userId?: string): Promise<{ saved_count: number }> {
    const response = await this.request<{ saved_count: number }>('/api/camera-logs/save', {
      method: 'POST',
      body: JSON.stringify({ log_ids: logIds, user_id: userId }),
    });
    return response.data!;
  }

  async deleteCameraLog(logId: string): Promise<void> {
    await this.request(`/api/camera-logs/${logId}`, {
      method: 'DELETE',
    });
  }

  // ============ 历史记录标注图片API ============
  async getAnnotatedImage(recordId: string): Promise<{ annotated_image: string; defect_count: number; filename: string }> {
    const response = await this.request<{ annotated_image: string; defect_count: number; filename: string }>(
      `/api/detection-records/${recordId}/annotated-image`
    );
    return response.data!;
  }

  // ============ 数据导出API ============
  async exportDetectionRecords(detectionType?: string, format: 'csv' | 'json' = 'csv'): Promise<any> {
    const params = new URLSearchParams();
    if (detectionType) params.append('detection_type', detectionType);
    params.append('format', format);

    const response = await this.fetchWithAuth(`${this.baseUrl}/api/detection-records/export?${params.toString()}`);

    if (format === 'csv') {
      return response.blob();
    }

    return response.json();
  }

  async exportDetectionDetail(recordId: string, format: 'csv' | 'json' = 'json'): Promise<any> {
    const params = new URLSearchParams();
    params.append('format', format);

    const response = await this.fetchWithAuth(`${this.baseUrl}/api/detection-records/${recordId}/export-detail?${params.toString()}`);

    if (format === 'csv') {
      return response.blob();
    }

    return response.json();
  }

  // ============ 统计API ============
  async getStatistics(userId?: string): Promise<Statistics> {
    const params = new URLSearchParams();
    if (userId) params.append('user_id', userId);

    const response = await this.request<Statistics>(`/api/statistics?${params.toString()}`);
    return response.data!;
  }

  async getDailyStatistics(userId?: string, days: number = 7): Promise<DailyStatistics[]> {
    const params = new URLSearchParams();
    if (userId) params.append('user_id', userId);
    params.append('days', days.toString());

    const response = await this.request<DailyStatistics[]>(
      `/api/statistics/daily?${params.toString()}`
    );
    return response.data || [];
  }

  async getDefectTypeStatistics(userId?: string): Promise<DefectTypeStatistics[]> {
    const params = new URLSearchParams();
    if (userId) params.append('user_id', userId);

    const response = await this.request<DefectTypeStatistics[]>(
      `/api/statistics/defect-types?${params.toString()}`
    );
    return response.data || [];
  }

  // ============ 系统设置API ============
  async getSettings(): Promise<SystemSettings> {
    const response = await this.request<SystemSettings>('/api/settings');
    return response.data || {};
  }

  async getSetting(key: string): Promise<string | null> {
    const response = await this.request<string>(`/api/settings/${key}`);
    return response.data || null;
  }

  async updateSetting(key: string, value: string): Promise<void> {
    await this.request(`/api/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
  }

  // ============ AI模型API ============
  async getModelStatus(): Promise<ModelStatus> {
    const response = await this.request<ModelStatus>('/api/model/status');
    return response.data!;
  }

  async loadModel(modelPath: string): Promise<any> {
    const response = await this.request('/api/model/load', {
      method: 'POST',
      body: JSON.stringify({ model_path: modelPath }),
    });
    return response.data;
  }

  async predict(
    file: File,
    options?: {
      userId?: string;
      username?: string;
      confidenceThreshold?: number;
      iouThreshold?: number;
      detectionType?: string;
    }
  ): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);

    const params = new URLSearchParams();
    if (options?.userId) params.append('user_id', options.userId);
    if (options?.username) params.append('username', options.username);
    if (options?.confidenceThreshold) params.append('confidence_threshold', options.confidenceThreshold.toString());
    if (options?.iouThreshold) params.append('iou_threshold', options.iouThreshold.toString());
    if (options?.detectionType) params.append('detection_type', options.detectionType);

    const url = `${this.baseUrl}/api/model/predict${params.toString() ? `?${params.toString()}` : ''}`;

    const response = await this.fetchWithAuth(url, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();

    if (data.success) {
      return data.data;
    } else {
      throw new Error(data.message || '预测失败');
    }
  }

  async predictBatch(
    files: File[],
    options?: {
      userId?: string;
      username?: string;
      batchName?: string;
      confidenceThreshold?: number;
      iouThreshold?: number;
    }
  ): Promise<any> {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));

    // 构建查询参数
    const params = new URLSearchParams();
    if (options?.userId) params.append('user_id', options.userId);
    if (options?.username) params.append('username', options.username);
    if (options?.batchName) params.append('batch_name', options.batchName);
    if (options?.confidenceThreshold) params.append('confidence_threshold', options.confidenceThreshold.toString());
    if (options?.iouThreshold) params.append('iou_threshold', options.iouThreshold.toString());

    const url = `${this.baseUrl}/api/model/predict-batch${params.toString() ? `?${params.toString()}` : ''}`;

    const response = await this.fetchWithAuth(url, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();

    if (data.success) {
      return data.data;
    } else {
      throw new Error(data.message || '批量预测失败');
    }
  }

  // ============ 用户管理API ============

  async getUsers(
    search?: string,
    role?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<any[]> {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (role) params.append('role', role);
    params.append('limit', limit.toString());
    params.append('offset', offset.toString());

    const response = await this.request<any[]>(
      `/api/users?${params.toString()}`
    );
    return response.data || [];
  }

  async createUser(data: {
    username: string;
    password: string;
    email?: string;
    full_name?: string;
    role?: string;
  }): Promise<any> {
    const response = await this.request<any>('/api/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data!;
  }

  async updateUser(
    userId: number,
    data: {
      full_name?: string;
      email?: string;
      role?: string;
      is_active?: boolean;
    }
  ): Promise<void> {
    await this.request(`/api/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteUser(userId: number): Promise<void> {
    await this.request(`/api/users/${userId}`, {
      method: 'DELETE',
    });
  }

  async toggleUserStatus(userId: number): Promise<{ is_active: boolean }> {
    const response = await this.request<{ is_active: boolean }>(
      `/api/users/${userId}/status`,
      { method: 'PATCH' }
    );
    return response.data!;
  }

  async resetPassword(userId: number, newPassword: string): Promise<void> {
    await this.request(`/api/users/${userId}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ new_password: newPassword }),
    });
  }

  // 摄像头日志保存（支持FormData图片上传）
  async saveCameraLogWithImage(formData: FormData): Promise<any> {
    const url = `${this.baseUrl}/api/camera-logs`;
    const response = await this.fetchWithAuth(url, {
      method: 'POST',
      body: formData,
    });

    return response.json();
  }

  // ============ 批量检测分组API ============

  async getGroupedBatchRecords(userId?: string, limit: number = 50, offset: number = 0): Promise<any[]> {
    const params = new URLSearchParams();
    if (userId) params.append('user_id', userId);
    params.append('limit', limit.toString());
    params.append('offset', offset.toString());

    const response = await this.request<any[]>(`/api/batch-records/grouped?${params.toString()}`);
    return response.data || [];
  }

  async getBatchRecordDetail(batchId: number): Promise<any> {
    const response = await this.request<any>(`/api/batch-records/${batchId}`);
    return response.data;
  }

  // ============ 通知API ============
  async getNotifications(limit: number = 50): Promise<any[]> {
    const response = await this.request<any[]>(`/api/notifications?limit=${limit}`);
    return response.data || [];
  }

  async getUnreadCount(): Promise<number> {
    const response = await this.request<any>(`/api/notifications/unread-count`);
    return response.data?.count || 0;
  }

  async markNotificationRead(id: number): Promise<void> {
    await this.request(`/api/notifications/${id}/read`, { method: 'PATCH' });
  }

  async markAllNotificationsRead(): Promise<void> {
    await this.request(`/api/notifications/read-all`, { method: 'PATCH' });
  }

  async deleteNotification(id: number): Promise<void> {
    await this.request(`/api/notifications/${id}`, { method: 'DELETE' });
  }

  async clearNotifications(): Promise<void> {
    await this.request(`/api/notifications`, { method: 'DELETE' });
  }

  async createNotification(data: {
    user_id?: number;
    type?: string;
    title: string;
    message?: string;
    link?: string;
  }): Promise<void> {
    await this.request('/api/notifications', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ============ 当前用户资料API ============
  async updateProfile(data: {
    user_id?: number;
    display_name?: string;
    email?: string;
    phone?: string;
    department?: string;
    avatar_url?: string;
  }): Promise<void> {
    await this.request('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async changePassword(userId: number | string | undefined, currentPassword: string, newPassword: string): Promise<void> {
    await this.request('/api/profile/password', {
      method: 'PUT',
      body: JSON.stringify({ 
        user_id: userId ? parseInt(userId.toString(), 10) : undefined,
        current_password: currentPassword, 
        new_password: newPassword 
      }),
    });
  }

  async uploadAvatar(file: File, userId: number): Promise<{ avatar_url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('user_id', userId.toString());

    const response = await this.fetchWithAuth(`${this.baseUrl}/api/profile/avatar`, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();
    return data.data;
  }

  // ============ 模型上传API ============
  async uploadModel(modelFile: File, classesFile?: File, modelName?: string): Promise<any> {
    const formData = new FormData();
    formData.append('model_file', modelFile);
    if (classesFile) {
      formData.append('classes_file', classesFile);
    }
    if (modelName) {
      formData.append('model_name', modelName);
    }

    const response = await this.fetchWithAuth(`${this.baseUrl}/api/models/upload`, {
      method: 'POST',
      body: formData,
    });

    return response.json();
  }

  async getAvailableModels(): Promise<any[]> {
    const response = await this.request<any[]>('/api/models');
    return response.data || [];
  }

  async renameModel(oldName: string, newName: string): Promise<any> {
    const response = await this.request('/api/models/rename', {
      method: 'POST',
      body: JSON.stringify({ old_name: oldName, new_name: newName }),
    });
    return response.data;
  }

  async deleteModel(modelName: string): Promise<void> {
    await this.request(`/api/models/${encodeURIComponent(modelName)}`, {
      method: 'DELETE',
    });
  }
}

export const apiService = new ApiService();
export default apiService;
