import { v4 as uuidv4 } from 'uuid';

export interface DetectionRecord {
  id: string;
  detectionId: string;
  username: string;
  originalFilename: string;
  resultFilename?: string;
  defectCount: number;
  confidence: number;
  processingTime: number;
  createdAt: string;
  status: 'completed' | 'failed';
  defectDetails?: Array<{
    type: string;
    confidence: number;
    bbox: [number, number, number, number];
    severity: 'low' | 'medium' | 'high';
  }>;
  imageData?: string;
  resultImageData?: string;
}

export interface BatchDetection {
  id: string;
  batchId: string;
  username: string;
  totalFiles: number;
  successCount: number;
  failCount: number;
  totalDefects: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  records: DetectionRecord[];
}

export interface SystemUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  phone: string;
  department: string;
  role: 'admin' | 'operator' | 'viewer';
  status: 'active' | 'inactive';
  avatarUrl?: string;
  createdAt: string;
  lastLogin?: string;
  passwordHash: string;
}

export interface SystemConfig {
  detection: {
    confidenceThreshold: number;
    iouThreshold: number;
    imageSize: number;
    device: 'cpu' | 'gpu';
  };
  notification: {
    emailEnabled: boolean;
    pushEnabled: boolean;
    defectAlert: boolean;
    systemAlert: boolean;
    dailyReport: boolean;
  };
  storage: {
    maxStorageDays: number;
    autoCleanup: boolean;
  };
  security: {
    sessionTimeout: number;
    maxLoginAttempts: number;
    passwordMinLength: number;
  };
}

export interface OperationLog {
  id: string;
  username: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  createdAt: string;
}

const STORAGE_KEYS = {
  DETECTION_RECORDS: 'metal_defect_detection_records',
  BATCH_DETECTIONS: 'metal_defect_batch_detections',
  USERS: 'metal_defect_users',
  SYSTEM_CONFIG: 'metal_defect_system_config',
  OPERATION_LOGS: 'metal_defect_operation_logs',
  CURRENT_USER: 'metal_defect_current_user'
};

class LocalStorageService {
  private getItem<T>(key: string, defaultValue: T): T {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  private setItem<T>(key: string, value: T): void {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // Detection Records
  getDetectionRecords(): DetectionRecord[] {
    return this.getItem<DetectionRecord[]>(STORAGE_KEYS.DETECTION_RECORDS, []);
  }

  saveDetectionRecord(record: Omit<DetectionRecord, 'id' | 'detectionId' | 'createdAt'>): DetectionRecord {
    const records = this.getDetectionRecords();
    const newRecord: DetectionRecord = {
      ...record,
      id: uuidv4(),
      detectionId: `DET-${Date.now()}`,
      createdAt: new Date().toISOString()
    };
    records.unshift(newRecord);
    this.setItem(STORAGE_KEYS.DETECTION_RECORDS, records);
    return newRecord;
  }

  deleteDetectionRecord(id: string): boolean {
    const records = this.getDetectionRecords();
    const filtered = records.filter(r => r.id !== id);
    if (filtered.length !== records.length) {
      this.setItem(STORAGE_KEYS.DETECTION_RECORDS, filtered);
      return true;
    }
    return false;
  }

  getDetectionRecordById(id: string): DetectionRecord | null {
    const records = this.getDetectionRecords();
    return records.find(r => r.id === id) || null;
  }

  // Batch Detections
  getBatchDetections(): BatchDetection[] {
    return this.getItem<BatchDetection[]>(STORAGE_KEYS.BATCH_DETECTIONS, []);
  }

  saveBatchDetection(batch: Omit<BatchDetection, 'id' | 'batchId' | 'createdAt'>): BatchDetection {
    const batches = this.getBatchDetections();
    const newBatch: BatchDetection = {
      ...batch,
      id: uuidv4(),
      batchId: `BATCH-${Date.now()}`,
      createdAt: new Date().toISOString()
    };
    batches.unshift(newBatch);
    this.setItem(STORAGE_KEYS.BATCH_DETECTIONS, batches);
    return newBatch;
  }

  updateBatchDetection(id: string, updates: Partial<BatchDetection>): BatchDetection | null {
    const batches = this.getBatchDetections();
    const index = batches.findIndex(b => b.id === id);
    if (index !== -1) {
      batches[index] = { ...batches[index], ...updates };
      this.setItem(STORAGE_KEYS.BATCH_DETECTIONS, batches);
      return batches[index];
    }
    return null;
  }

  // Users
  getUsers(): SystemUser[] {
    return this.getItem<SystemUser[]>(STORAGE_KEYS.USERS, [
      {
        id: '1',
        username: 'admin',
        displayName: '系统管理员',
        email: 'admin@example.com',
        phone: '13800138000',
        department: '技术部',
        role: 'admin',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        passwordHash: 'admin123'
      },
      {
        id: '2',
        username: 'operator',
        displayName: '操作员',
        email: 'operator@example.com',
        phone: '13800138001',
        department: '生产部',
        role: 'operator',
        status: 'active',
        createdAt: '2026-01-15T00:00:00Z',
        passwordHash: 'operator123'
      },
      {
        id: '3',
        username: 'viewer',
        displayName: '查看员',
        email: 'viewer@example.com',
        phone: '13800138002',
        department: '质检部',
        role: 'viewer',
        status: 'active',
        createdAt: '2026-02-01T00:00:00Z',
        passwordHash: 'viewer123'
      }
    ]);
  }

  saveUser(user: Omit<SystemUser, 'id' | 'createdAt'>): SystemUser {
    const users = this.getUsers();
    const newUser: SystemUser = {
      ...user,
      id: uuidv4(),
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    this.setItem(STORAGE_KEYS.USERS, users);
    return newUser;
  }

  updateUser(id: string, updates: Partial<SystemUser>): SystemUser | null {
    const users = this.getUsers();
    const index = users.findIndex(u => u.id === id);
    if (index !== -1) {
      users[index] = { ...users[index], ...updates };
      this.setItem(STORAGE_KEYS.USERS, users);
      return users[index];
    }
    return null;
  }

  deleteUser(id: string): boolean {
    const users = this.getUsers();
    const filtered = users.filter(u => u.id !== id);
    if (filtered.length !== users.length) {
      this.setItem(STORAGE_KEYS.USERS, filtered);
      return true;
    }
    return false;
  }

  getUserByUsername(username: string): SystemUser | null {
    const users = this.getUsers();
    return users.find(u => u.username === username) || null;
  }

  // System Config
  getSystemConfig(): SystemConfig {
    return this.getItem<SystemConfig>(STORAGE_KEYS.SYSTEM_CONFIG, {
      detection: {
        confidenceThreshold: 0.5,
        iouThreshold: 0.45,
        imageSize: 640,
        device: 'cpu'
      },
      notification: {
        emailEnabled: true,
        pushEnabled: true,
        defectAlert: true,
        systemAlert: true,
        dailyReport: false
      },
      storage: {
        maxStorageDays: 90,
        autoCleanup: true
      },
      security: {
        sessionTimeout: 30,
        maxLoginAttempts: 5,
        passwordMinLength: 6
      }
    });
  }

  updateSystemConfig(config: Partial<SystemConfig>): void {
    const current = this.getSystemConfig();
    this.setItem(STORAGE_KEYS.SYSTEM_CONFIG, { ...current, ...config });
  }

  // Operation Logs
  getOperationLogs(): OperationLog[] {
    return this.getItem<OperationLog[]>(STORAGE_KEYS.OPERATION_LOGS, []);
  }

  addOperationLog(log: Omit<OperationLog, 'id' | 'createdAt'>): OperationLog {
    const logs = this.getOperationLogs();
    const newLog: OperationLog = {
      ...log,
      id: uuidv4(),
      createdAt: new Date().toISOString()
    };
    logs.unshift(newLog);
    // Keep only last 1000 logs
    if (logs.length > 1000) {
      logs.pop();
    }
    this.setItem(STORAGE_KEYS.OPERATION_LOGS, logs);
    return newLog;
  }

  // Statistics
  getStatistics(days: number = 30): {
    totalDetections: number;
    totalDefects: number;
    avgAccuracy: number;
    detectionRate: number;
    dailyStats: Array<{
      date: string;
      detections: number;
      defects: number;
    }>;
    defectTypeDistribution: Record<string, number>;
  } {
    const records = this.getDetectionRecords();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const filteredRecords = records.filter(r =>
      new Date(r.createdAt) >= cutoffDate
    );

    const totalDetections = filteredRecords.length;
    const totalDefects = filteredRecords.reduce((sum, r) => sum + r.defectCount, 0);
    const avgAccuracy = totalDetections > 0
      ? filteredRecords.reduce((sum, r) => sum + r.confidence, 0) / totalDetections
      : 0;
    const detectionRate = totalDetections > 0
      ? (filteredRecords.filter(r => r.defectCount > 0).length / totalDetections) * 100
      : 0;

    // Daily stats
    const dailyStats: Array<{ date: string; detections: number; defects: number }> = [];
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayRecords = filteredRecords.filter(r =>
        r.createdAt.startsWith(dateStr)
      );
      dailyStats.unshift({
        date: dateStr,
        detections: dayRecords.length,
        defects: dayRecords.reduce((sum, r) => sum + r.defectCount, 0)
      });
    }

    // Defect type distribution
    const defectTypeDistribution: Record<string, number> = {};
    filteredRecords.forEach(r => {
      r.defectDetails?.forEach(d => {
        defectTypeDistribution[d.type] = (defectTypeDistribution[d.type] || 0) + 1;
      });
    });

    return {
      totalDetections,
      totalDefects,
      avgAccuracy,
      detectionRate,
      dailyStats,
      defectTypeDistribution
    };
  }

  // Clear all data
  clearAllData(): void {
    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
  }

  // Export data
  exportData(): string {
    const data = {
      detectionRecords: this.getDetectionRecords(),
      batchDetections: this.getBatchDetections(),
      users: this.getUsers(),
      systemConfig: this.getSystemConfig(),
      operationLogs: this.getOperationLogs(),
      exportedAt: new Date().toISOString()
    };
    return JSON.stringify(data, null, 2);
  }

  // Import data
  importData(jsonString: string): boolean {
    try {
      const data = JSON.parse(jsonString);
      if (data.detectionRecords) {
        this.setItem(STORAGE_KEYS.DETECTION_RECORDS, data.detectionRecords);
      }
      if (data.batchDetections) {
        this.setItem(STORAGE_KEYS.BATCH_DETECTIONS, data.batchDetections);
      }
      if (data.users) {
        this.setItem(STORAGE_KEYS.USERS, data.users);
      }
      if (data.systemConfig) {
        this.setItem(STORAGE_KEYS.SYSTEM_CONFIG, data.systemConfig);
      }
      if (data.operationLogs) {
        this.setItem(STORAGE_KEYS.OPERATION_LOGS, data.operationLogs);
      }
      return true;
    } catch {
      return false;
    }
  }
}

export const localStorageService = new LocalStorageService();
export default localStorageService;
