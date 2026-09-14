import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Settings,
  Bell,
  Shield,
  Database,
  Image as ImageIcon,
  Save,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  Server,
  Cpu,
  HardDrive,
  Activity,
  Loader2,
  Upload,
  FolderOpen,
  FileText,
  Brain,
  Trash2,
  X,
  Settings as SettingsIcon
} from 'lucide-react';
import apiService from '../services/ApiService';

interface SystemConfig {
  detection: {
    confidenceThreshold: number;
    iouThreshold: number;
    imageSize: number;
    device: 'cpu' | 'gpu';
    modelPath: string;
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
    backupEnabled: boolean;
    backupInterval: number;
  };
  security: {
    sessionTimeout: number;
    maxLoginAttempts: number;
    passwordMinLength: number;
    requireSpecialChar: boolean;
  };
}

interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

const defaultConfig: SystemConfig = {
  detection: {
    confidenceThreshold: 0.5,
    iouThreshold: 0.45,
    imageSize: 640,
    device: 'cpu',
    modelPath: ''
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
    autoCleanup: true,
    backupEnabled: true,
    backupInterval: 24
  },
  security: {
    sessionTimeout: 30,
    maxLoginAttempts: 5,
    passwordMinLength: 6,
    requireSpecialChar: false
  }
};

const SystemSettingsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'detection' | 'notification' | 'storage' | 'security' | 'system'>('detection');
  const [config, setConfig] = useState<SystemConfig>(defaultConfig);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [systemStatus, setSystemStatus] = useState({
    cpu: 0,
    memory: 0,
    disk: 0,
    uptime: '-',
    status: 'normal'
  });

  // 模型上传相关状态
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [modelName, setModelName] = useState('金属内壁缺陷检测模型'); // 默认模型名称
  const [classesFile, setClassesFile] = useState<File | null>(null);
  const [classNamesText, setClassNamesText] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);

  // 模型名称编辑状态
  const [editingModelName, setEditingModelName] = useState<string | null>(null);
  const [editingModelNewName, setEditingModelNewName] = useState('');

  // 当前已加载到内存中的模型路径
  const [loadedModelPath, setLoadedModelPath] = useState<string | null>(null);

  // Toast helper
  const addToast = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  // 加载设置数据
  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const data = await apiService.getSettings();
      console.log('加载的设置数据:', data);
      
      setConfig({
        detection: {
          confidenceThreshold: parseFloat(data.confidence_threshold) || 0.5,
          iouThreshold: parseFloat(data.iou_threshold) || 0.45,
          imageSize: 640,
          device: 'cpu',
          modelPath: data.model_path || defaultConfig.detection.modelPath
        },
        notification: {
          emailEnabled: data.notification_enabled === 'true',
          pushEnabled: data.push_enabled === 'true',
          defectAlert: data.defect_alert === 'true',
          systemAlert: data.system_alert === 'true',
          dailyReport: data.daily_report === 'true'
        },
        storage: {
          maxStorageDays: parseInt(data.log_retention_days) || 90,
          autoCleanup: data.auto_cleanup === 'true',
          backupEnabled: data.backup_enabled === 'true',
          backupInterval: parseInt(data.backup_interval) || 24
        },
        security: {
          sessionTimeout: 30,
          maxLoginAttempts: 5,
          passwordMinLength: 6,
          requireSpecialChar: false
        }
      });
    } catch (error) {
      console.error('加载设置失败:', error);
      addToast('error', '加载设置失败，使用默认配置');
    } finally {
      setIsLoading(false);
    }
  };

  // 加载系统状态
  const loadSystemStatus = async () => {
    try {
      // 从后端获取模型状态
      const modelStatus = await apiService.getModelStatus().catch(() => null);

      // 获取系统磁盘使用情况（接口已加鉴权，需带上 JWT）
      const diskToken = localStorage.getItem('accessToken');
      const diskUsage = await fetch('/api/system/disk', {
        headers: diskToken ? { Authorization: `Bearer ${diskToken}` } : {},
      }).then(r => r.json()).catch(() => ({ data: { usage: 45 } }));

      setSystemStatus({
        cpu: Math.floor(Math.random() * 30) + 20,
        memory: Math.floor(Math.random() * 40) + 30,
        disk: diskUsage.data?.usage || 45,
        uptime: modelStatus?.model_path || '-',
        status: modelStatus?.is_loaded ? 'normal' : 'warning'
      });

      // 记录当前加载到内存的模型路径
      if (modelStatus?.data?.is_loaded && modelStatus.data.model_path) {
        setLoadedModelPath(modelStatus.data.model_path);
      }
    } catch (error) {
      console.error('加载系统状态失败:', error);
    }
  };

  // 加载可用模型列表
  const loadAvailableModels = async () => {
    try {
      const models = await apiService.getAvailableModels();
      setAvailableModels(models || []);
    } catch (error) {
      console.error('加载模型列表失败:', error);
    }
  };

  // 处理模型上传
  const handleModelUpload = async () => {
    if (!modelFile) {
      addToast('error', '请选择模型文件');
      return;
    }

    if (!modelName.trim()) {
      addToast('error', '请输入模型名称');
      return;
    }

    setIsUploading(true);
    try {
      // 确定要上传的类别文件
      let classesFileToUpload = classesFile;
      if (!classesFileToUpload && classNamesText.trim()) {
        classesFileToUpload = new File([classNamesText.trim()], 'classes.txt', { type: 'text/plain' });
      }

      const data = await apiService.uploadModel(modelFile, classesFileToUpload || undefined, modelName.trim());

      if (data.success) {
        addToast('success', '模型上传成功');
        setShowUploadModal(false);
        setModelFile(null);
        setClassesFile(null);
        setClassNamesText('');
        setModelName('金属内壁缺陷检测模型');
        loadAvailableModels();
      } else {
        addToast('error', data.detail || '上传失败');
      }
    } catch (error: any) {
      addToast('error', error.message || '上传失败');
    } finally {
      setIsUploading(false);
    }
  };

  // 选择并加载模型
  const handleSelectModel = async (modelPath: string) => {
    try {
      // 保存模型路径到数据库
      await apiService.updateSetting('model_path', modelPath);
      setConfig(prev => ({
        ...prev,
        detection: { ...prev.detection, modelPath }
      }));

      // 加载模型到内存
      await apiService.loadModel(modelPath);
      setLoadedModelPath(modelPath);
      addToast('success', '模型已应用');
    } catch (error) {
      addToast('error', '应用模型失败');
    }
  };

  // 开始编辑模型名称
  const handleStartEditModelName = (model: any) => {
    setEditingModelName(model.name);
    setEditingModelNewName(model.name);
  };

  // 保存编辑的模型名称
  const handleSaveModelName = async () => {
    if (!editingModelName || !editingModelNewName.trim()) {
      addToast('error', '模型名称不能为空');
      return;
    }

    try {
      await apiService.renameModel(editingModelName, editingModelNewName.trim());
      addToast('success', '模型名称已修改');
      setEditingModelName(null);
      setEditingModelNewName('');
      loadAvailableModels();
    } catch (error: any) {
      addToast('error', error.message || '修改模型名称失败');
    }
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setEditingModelName(null);
    setEditingModelNewName('');
  };

  // 删除模型
  const handleDeleteModel = async (model: any) => {
    if (!confirm(`确定要删除模型 "${model.name}" 吗？\n此操作不可恢复，将删除模型目录及其中所有文件。`)) {
      return;
    }

    try {
      await apiService.deleteModel(model.name);
      addToast('success', `模型 "${model.name}" 已删除`);

      // 如果删除的是当前选中或已加载的模型，清除状态
      if (config.detection.modelPath === model.pt_file) {
        setConfig(prev => ({
          ...prev,
          detection: { ...prev.detection, modelPath: '' }
        }));
      }
      if (loadedModelPath === model.pt_file) {
        setLoadedModelPath(null);
      }

      loadAvailableModels();
    } catch (error: any) {
      addToast('error', error.message || '删除模型失败');
    }
  };

  useEffect(() => {
    loadSettings();
    loadSystemStatus();
    loadAvailableModels();

    // 每30秒刷新系统状态
    const interval = setInterval(loadSystemStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // 保存设置
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const settingsToSave = [
        { key: 'confidence_threshold', value: config.detection.confidenceThreshold.toString() },
        { key: 'iou_threshold', value: config.detection.iouThreshold.toString() },
        { key: 'model_path', value: config.detection.modelPath },
        { key: 'notification_enabled', value: config.notification.emailEnabled || config.notification.pushEnabled ? 'true' : 'false' },
        { key: 'backup_enabled', value: config.storage.backupEnabled ? 'true' : 'false' },
        { key: 'backup_interval', value: config.storage.backupInterval.toString() },
        { key: 'log_retention_days', value: config.storage.maxStorageDays.toString() },
        { key: 'auto_cleanup', value: config.storage.autoCleanup ? 'true' : 'false' }
      ];

      for (const setting of settingsToSave) {
        await apiService.updateSetting(setting.key, setting.value);
      }
      
      addToast('success', '设置已保存成功');
    } catch (error) {
      console.error('保存设置失败:', error);
      addToast('error', '保存设置失败');
    } finally {
      setIsSaving(false);
    }
  };

  // 重置为默认设置
  const handleReset = async () => {
    if (!confirm('确定要恢复默认设置吗？')) return;
    
    setConfig(defaultConfig);
    try {
      await apiService.updateSetting('confidence_threshold', '0.5');
      await apiService.updateSetting('iou_threshold', '0.45');
      addToast('success', '已恢复默认设置');
    } catch (error) {
      console.error('重置失败:', error);
    }
  };

  const tabs = [
    { id: 'detection', label: '检测设置', icon: <ImageIcon size={18} /> },
    { id: 'notification', label: '通知设置', icon: <Bell size={18} /> },
    { id: 'storage', label: '存储设置', icon: <Database size={18} /> },
    { id: 'security', label: '安全设置', icon: <Shield size={18} /> },
    { id: 'system', label: '系统状态', icon: <Server size={18} /> }
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={32} className="text-orange-500 animate-spin" />
        <span className="ml-3 text-[var(--text-muted)]">加载设置中...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 overflow-y-auto h-full">
      {/* Toast 通知 */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            className={`px-4 py-3 rounded-lg flex items-center gap-2 shadow-lg ${
              toast.type === 'success' ? 'bg-emerald-500/90 text-white' :
              toast.type === 'error' ? 'bg-red-500/90 text-white' :
              'bg-blue-500/90 text-white'
            }`}
          >
            {toast.type === 'success' && <CheckCircle size={18} />}
            {toast.type === 'error' && <AlertCircle size={18} />}
            <span>{toast.message}</span>
          </motion.div>
        ))}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">系统设置</h1>
          <p className="text-[var(--text-secondary)] mt-1">配置系统参数和监控运行状态</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 border border-[var(--border-color)] text-[var(--text-secondary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <RotateCcw size={18} />
            恢复默认
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            {isSaving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-1">
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] overflow-hidden">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  activeTab === tab.id
                    ? 'bg-orange-500/10 text-orange-500 border-l-4 border-orange-500'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] border-l-4 border-transparent'
                }`}
              >
                {tab.icon}
                <span className="font-medium">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="lg:col-span-3">
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-6">
            {/* Detection Settings */}
            {activeTab === 'detection' && (
              <div className="space-y-6">
                <div className="flex items-center gap-2 mb-6">
                  <ImageIcon size={20} className="text-orange-500" />
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">检测参数设置</h3>
                </div>
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">置信度阈值</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="0.1"
                        max="0.9"
                        step="0.05"
                        value={config.detection.confidenceThreshold}
                        onChange={(e) => setConfig(prev => ({
                          ...prev,
                          detection: { ...prev.detection, confidenceThreshold: parseFloat(e.target.value) }
                        }))}
                        className="flex-1 accent-orange-500"
                      />
                      <span className="text-sm font-mono text-[var(--text-primary)] w-14">
                        {(config.detection.confidenceThreshold * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-1">检测结果的最低置信度要求</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">IOU阈值</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="0.1"
                        max="0.9"
                        step="0.05"
                        value={config.detection.iouThreshold}
                        onChange={(e) => setConfig(prev => ({
                          ...prev,
                          detection: { ...prev.detection, iouThreshold: parseFloat(e.target.value) }
                        }))}
                        className="flex-1 accent-orange-500"
                      />
                      <span className="text-sm font-mono text-[var(--text-primary)] w-14">
                        {(config.detection.iouThreshold * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-1">非极大值抑制的IOU阈值</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">输入图像尺寸</label>
                    <select
                      value={config.detection.imageSize}
                      onChange={(e) => setConfig(prev => ({
                        ...prev,
                        detection: { ...prev.detection, imageSize: parseInt(e.target.value) }
                      }))}
                      className="w-full px-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                    >
                      <option value={320}>320x320</option>
                      <option value={416}>416x416</option>
                      <option value={640}>640x640</option>
                      <option value={1280}>1280x1280</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">推理设备</label>
                    <select
                      value={config.detection.device}
                      onChange={(e) => setConfig(prev => ({
                        ...prev,
                        detection: { ...prev.detection, device: e.target.value as 'cpu' | 'gpu' }
                      }))}
                      className="w-full px-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                    >
                      <option value="cpu">CPU</option>
                      <option value="gpu">GPU (CUDA)</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">选择模型</label>
                    <select
                      value={config.detection.modelPath}
                      onChange={(e) => {
                        const newPath = e.target.value;
                        if (newPath) handleSelectModel(newPath);
                      }}
                      className="w-full px-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                    >
                      {availableModels.length > 0 ? (
                        availableModels.map((model) => (
                          <option key={model.pt_file} value={model.pt_file}>
                            {model.name} ({model.pt_file?.split('/').pop()})
                          </option>
                        ))
                      ) : (
                        <option value={config.detection.modelPath}>
                          {config.detection.modelPath.split('/').pop()}
                        </option>
                      )}
                    </select>
                    <p className="text-xs text-[var(--text-muted)] mt-1">从已上传的模型中选择，或在下方手动输入路径</p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">模型路径</label>
                    <input
                      type="text"
                      value={config.detection.modelPath}
                      onChange={(e) => setConfig(prev => ({
                        ...prev,
                        detection: { ...prev.detection, modelPath: e.target.value }
                      }))}
                      className="w-full px-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                    />
                  </div>
                </div>

                {/* 模型管理区域 */}
                <div className="mt-8 pt-6 border-t border-[var(--border-color)]">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Brain size={20} className="text-orange-500" />
                      <h3 className="text-lg font-semibold text-[var(--text-primary)]">模型管理</h3>
                    </div>
                    <button
                      onClick={() => {
                        setModelFile(null);
                        setClassesFile(null);
                        setClassNamesText('');
                        setModelName('金属内壁缺陷检测模型');
                        setShowUploadModal(true);
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
                    >
                      <Upload size={16} />
                      上传模型
                    </button>
                  </div>

                  {/* 上传要求说明 */}
                  <div className="mb-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                    <h4 className="font-medium text-amber-500 mb-2">上传要求</h4>
                    <ul className="text-sm text-[var(--text-secondary)] space-y-1">
                      <li>1. 模型文件必须是 <code className="px-1 py-0.5 bg-[var(--bg-tertiary)] rounded">.pt</code> 格式（YOLO26训练结果）</li>
                      <li>2. 类别文件必须是 <code className="px-1 py-0.5 bg-[var(--bg-tertiary)] rounded">.txt</code> 格式，每行一个类别名称（可选但推荐）</li>
                      <li>3. 上传后模型会自动保存到系统模型目录</li>
                      <li>4. 目前仅支持 YOLO26 训练出来的模型</li>
                    </ul>
                  </div>

                  {/* 可用模型列表 */}
                  {availableModels.length > 0 ? (
                    <div className="grid md:grid-cols-2 gap-4">
                      {availableModels.map((model) => (
                        <div
                          key={model.name}
                          className={`p-4 rounded-lg border transition-all ${
                            loadedModelPath === model.pt_file
                              ? 'border-emerald-500 bg-emerald-500/10'
                              : config.detection.modelPath === model.pt_file
                                ? 'border-orange-500 bg-orange-500/10'
                                : 'border-[var(--border-color)] hover:border-orange-500/50'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg cursor-pointer ${
                              loadedModelPath === model.pt_file
                                ? 'bg-emerald-500/20 text-emerald-500'
                                : config.detection.modelPath === model.pt_file
                                  ? 'bg-orange-500/20 text-orange-500'
                                  : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                            }`} onClick={() => model.pt_file && handleSelectModel(model.pt_file)}>
                              <Brain size={24} />
                            </div>
                            <div className="flex-1 min-w-0">
                              {editingModelName === model.name ? (
                                // 编辑模式
                                <div className="space-y-2">
                                  <input
                                    type="text"
                                    value={editingModelNewName}
                                    onChange={(e) => setEditingModelNewName(e.target.value)}
                                    className="w-full px-3 py-1.5 text-sm border border-orange-500 rounded-lg focus:outline-none bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveModelName();
                                      if (e.key === 'Escape') handleCancelEdit();
                                    }}
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      onClick={handleSaveModelName}
                                      className="px-3 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600"
                                    >
                                      保存
                                    </button>
                                    <button
                                      onClick={handleCancelEdit}
                                      className="px-3 py-1 text-xs border border-[var(--border-color)] rounded hover:bg-[var(--bg-tertiary)]"
                                    >
                                      取消
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                // 显示模式
                                <>
                                  <div className="flex items-center gap-2">
                                    <h4 
                                      className="font-medium text-[var(--text-primary)] truncate cursor-pointer hover:text-orange-500"
                                      onClick={() => model.pt_file && handleSelectModel(model.pt_file)}
                                    >
                                      {model.name}
                                    </h4>
                                    {loadedModelPath === model.pt_file ? (
                                      <span className="px-2 py-0.5 text-xs bg-emerald-500 text-white rounded">已加载</span>
                                    ) : config.detection.modelPath === model.pt_file ? (
                                      <span className="px-2 py-0.5 text-xs bg-orange-500 text-white rounded">已选中</span>
                                    ) : null}
                                    <button
                                      onClick={() => handleDeleteModel(model)}
                                      className="p-1 hover:bg-red-500/10 rounded text-[var(--text-muted)] hover:text-red-500"
                                      title="删除模型"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                    <button
                                      onClick={() => handleStartEditModelName(model)}
                                      className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-muted)] hover:text-orange-500"
                                      title="修改名称"
                                    >
                                      <SettingsIcon size={14} />
                                    </button>
                                  </div>
                                  <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-muted)]">
                                    {model.has_classes && (
                                      <span className="flex items-center gap-1">
                                        <FileText size={12} />
                                        {model.class_count} 个类别
                                      </span>
                                    )}
                                    {model.pt_file && (
                                      <span className="flex items-center gap-1">
                                        <FolderOpen size={12} />
                                        {model.pt_file.split('/').pop()}
                                      </span>
                                    )}
                                  </div>
                                </>
                              )}
                              {!editingModelName || editingModelName !== model.name ? (
                                model.has_classes && model.class_names && (
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {model.class_names.slice(0, 5).map((name: string, i: number) => (
                                      <span key={i} className="px-2 py-0.5 text-xs bg-[var(--bg-tertiary)] rounded">
                                        {name}
                                      </span>
                                    ))}
                                    {model.class_names.length > 5 && (
                                      <span className="px-2 py-0.5 text-xs text-[var(--text-muted)]">
                                        +{model.class_names.length - 5} 更多
                                      </span>
                                    )}
                                  </div>
                                )
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-[var(--text-muted)]">
                      <Brain size={32} className="mx-auto mb-2 opacity-50" />
                      <p>暂无已上传的模型</p>
                      <p className="text-sm">点击上方按钮上传YOLO模型</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Notification Settings */}
            {activeTab === 'notification' && (
              <div className="space-y-6">
                <div className="flex items-center gap-2 mb-6">
                  <Bell size={20} className="text-orange-500" />
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">通知设置</h3>
                </div>
                <div className="space-y-4">
                  {[
                    { key: 'emailEnabled', label: '邮件通知', desc: '通过邮件接收系统通知', settingKey: 'email_notification' },
                    { key: 'pushEnabled', label: '推送通知', desc: '通过浏览器推送接收通知', settingKey: 'push_notification' },
                    { key: 'defectAlert', label: '缺陷警报', desc: '检测到严重缺陷时发送警报', settingKey: 'defect_alert' },
                    { key: 'systemAlert', label: '系统警报', desc: '系统异常时发送警报', settingKey: 'system_alert' },
                    { key: 'dailyReport', label: '日报', desc: '每日发送检测统计报告', settingKey: 'daily_report' }
                  ].map((item) => (
                    <div key={item.key} className="flex items-center justify-between p-4 bg-[var(--bg-tertiary)] rounded-lg">
                      <div>
                        <div className="font-medium text-[var(--text-primary)]">{item.label}</div>
                        <div className="text-sm text-[var(--text-muted)]">{item.desc}</div>
                      </div>
                      <button
                        onClick={() => setConfig(prev => ({
                          ...prev,
                          notification: { ...prev.notification, [item.key]: !prev.notification[item.key as keyof typeof prev.notification] }
                        }))}
                        className={`relative w-12 h-6 rounded-full transition-colors ${
                          config.notification[item.key as keyof typeof config.notification] ? 'bg-orange-500' : 'bg-gray-300'
                        }`}
                      >
                        <motion.div
                          className="absolute top-1 w-4 h-4 bg-white rounded-full shadow"
                          animate={{
                            left: config.notification[item.key as keyof typeof config.notification] ? '26px' : '2px'
                          }}
                          transition={{ duration: 0.2 }}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Storage Settings */}
            {activeTab === 'storage' && (
              <div className="space-y-6">
                <div className="flex items-center gap-2 mb-6">
                  <Database size={20} className="text-orange-500" />
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">存储设置</h3>
                </div>
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">数据保留天数</label>
                    <input
                      type="number"
                      value={config.storage.maxStorageDays}
                      onChange={(e) => setConfig(prev => ({
                        ...prev,
                        storage: { ...prev.storage, maxStorageDays: parseInt(e.target.value) }
                      }))}
                      className="w-full px-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                    />
                    <p className="text-xs text-[var(--text-muted)] mt-1">超过此天数的检测记录将被自动清理</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">备份间隔（小时）</label>
                    <input
                      type="number"
                      value={config.storage.backupInterval}
                      onChange={(e) => setConfig(prev => ({
                        ...prev,
                        storage: { ...prev.storage, backupInterval: parseInt(e.target.value) }
                      }))}
                      className="w-full px-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                    />
                  </div>
                  <div className="flex items-center justify-between p-4 bg-[var(--bg-tertiary)] rounded-lg">
                    <div>
                      <div className="font-medium text-[var(--text-primary)]">自动清理</div>
                      <div className="text-sm text-[var(--text-muted)]">自动删除过期数据</div>
                    </div>
                    <button
                      onClick={() => setConfig(prev => ({
                        ...prev,
                        storage: { ...prev.storage, autoCleanup: !prev.storage.autoCleanup }
                      }))}
                      className={`relative w-12 h-6 rounded-full transition-colors ${
                        config.storage.autoCleanup ? 'bg-orange-500' : 'bg-gray-300'
                      }`}
                    >
                      <motion.div
                        className="absolute top-1 w-4 h-4 bg-white rounded-full shadow"
                        animate={{ left: config.storage.autoCleanup ? '26px' : '2px' }}
                        transition={{ duration: 0.2 }}
                      />
                    </button>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-[var(--bg-tertiary)] rounded-lg">
                    <div>
                      <div className="font-medium text-[var(--text-primary)]">自动备份</div>
                      <div className="text-sm text-[var(--text-muted)]">定期备份系统数据</div>
                    </div>
                    <button
                      onClick={() => setConfig(prev => ({
                        ...prev,
                        storage: { ...prev.storage, backupEnabled: !prev.storage.backupEnabled }
                      }))}
                      className={`relative w-12 h-6 rounded-full transition-colors ${
                        config.storage.backupEnabled ? 'bg-orange-500' : 'bg-gray-300'
                      }`}
                    >
                      <motion.div
                        className="absolute top-1 w-4 h-4 bg-white rounded-full shadow"
                        animate={{ left: config.storage.backupEnabled ? '26px' : '2px' }}
                        transition={{ duration: 0.2 }}
                      />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Security Settings */}
            {activeTab === 'security' && (
              <div className="space-y-6">
                <div className="flex items-center gap-2 mb-6">
                  <Shield size={20} className="text-orange-500" />
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">安全设置</h3>
                </div>
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">会话超时（分钟）</label>
                    <input
                      type="number"
                      value={config.security.sessionTimeout}
                      onChange={(e) => setConfig(prev => ({
                        ...prev,
                        security: { ...prev.security, sessionTimeout: parseInt(e.target.value) }
                      }))}
                      className="w-full px-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                    />
                    <p className="text-xs text-[var(--text-muted)] mt-1">无操作后自动登出时间</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">最大登录尝试次数</label>
                    <input
                      type="number"
                      value={config.security.maxLoginAttempts}
                      onChange={(e) => setConfig(prev => ({
                        ...prev,
                        security: { ...prev.security, maxLoginAttempts: parseInt(e.target.value) }
                      }))}
                      className="w-full px-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">密码最小长度</label>
                    <input
                      type="number"
                      value={config.security.passwordMinLength}
                      onChange={(e) => setConfig(prev => ({
                        ...prev,
                        security: { ...prev.security, passwordMinLength: parseInt(e.target.value) }
                      }))}
                      className="w-full px-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                    />
                  </div>
                  <div className="flex items-center justify-between p-4 bg-[var(--bg-tertiary)] rounded-lg">
                    <div>
                      <div className="font-medium text-[var(--text-primary)]">要求特殊字符</div>
                      <div className="text-sm text-[var(--text-muted)]">密码必须包含特殊字符</div>
                    </div>
                    <button
                      onClick={() => setConfig(prev => ({
                        ...prev,
                        security: { ...prev.security, requireSpecialChar: !prev.security.requireSpecialChar }
                      }))}
                      className={`relative w-12 h-6 rounded-full transition-colors ${
                        config.security.requireSpecialChar ? 'bg-orange-500' : 'bg-gray-300'
                      }`}
                    >
                      <motion.div
                        className="absolute top-1 w-4 h-4 bg-white rounded-full shadow"
                        animate={{ left: config.security.requireSpecialChar ? '26px' : '2px' }}
                        transition={{ duration: 0.2 }}
                      />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* System Status */}
            {activeTab === 'system' && (
              <div className="space-y-6">
                <div className="flex items-center gap-2 mb-6">
                  <Server size={20} className="text-orange-500" />
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">系统状态</h3>
                  <button
                    onClick={loadSystemStatus}
                    className="ml-auto px-3 py-1 text-sm border border-[var(--border-color)] rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
                  >
                    刷新
                  </button>
                </div>
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="p-4 bg-[var(--bg-tertiary)] rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <Cpu size={18} className="text-[var(--text-muted)]" />
                      <span className="font-medium text-[var(--text-primary)]">CPU 使用率</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 bg-[var(--border-color)] rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-orange-500 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${systemStatus.cpu}%` }}
                          transition={{ duration: 1 }}
                        />
                      </div>
                      <span className="text-sm font-mono text-[var(--text-primary)] w-10">{systemStatus.cpu}%</span>
                    </div>
                  </div>
                  <div className="p-4 bg-[var(--bg-tertiary)] rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <Activity size={18} className="text-[var(--text-muted)]" />
                      <span className="font-medium text-[var(--text-primary)]">内存 使用率</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 bg-[var(--border-color)] rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-blue-500 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${systemStatus.memory}%` }}
                          transition={{ duration: 1 }}
                        />
                      </div>
                      <span className="text-sm font-mono text-[var(--text-primary)] w-10">{systemStatus.memory}%</span>
                    </div>
                  </div>
                  <div className="p-4 bg-[var(--bg-tertiary)] rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <HardDrive size={18} className="text-[var(--text-muted)]" />
                      <span className="font-medium text-[var(--text-primary)]">磁盘 使用率</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 bg-[var(--border-color)] rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-emerald-500 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${systemStatus.disk}%` }}
                          transition={{ duration: 1 }}
                        />
                      </div>
                      <span className="text-sm font-mono text-[var(--text-primary)] w-10">{systemStatus.disk}%</span>
                    </div>
                  </div>
                  <div className="p-4 bg-[var(--bg-tertiary)] rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <Server size={18} className="text-[var(--text-muted)]" />
                      <span className="font-medium text-[var(--text-primary)]">运行时间</span>
                    </div>
                    <div className="text-lg font-mono text-[var(--text-primary)]">{systemStatus.uptime}</div>
                  </div>
                </div>
                <div className={`p-4 rounded-lg ${
                  systemStatus.status === 'normal' ? 'bg-emerald-500/10' : 'bg-amber-500/10'
                }`}>
                  <div className={`flex items-center gap-2 ${
                    systemStatus.status === 'normal' ? 'text-emerald-500' : 'text-amber-500'
                  }`}>
                    {systemStatus.status === 'normal' ? (
                      <CheckCircle size={18} />
                    ) : (
                      <AlertCircle size={18} />
                    )}
                    <span className="font-medium">
                      {systemStatus.status === 'normal' ? '系统运行正常' : '系统状态异常'}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--text-secondary)] mt-1">
                    {systemStatus.status === 'normal' ? '所有服务正常运行中' : '部分服务可能需要关注'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 模型上传弹窗 */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[var(--bg-card)] rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl border border-[var(--border-color)]"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-500/10 rounded-lg">
                  <Upload size={24} className="text-orange-500" />
                </div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">上传YOLO模型</h3>
              </div>
              <button
                onClick={() => setShowUploadModal(false)}
                className="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-muted)]"
              >
                <Trash2 size={18} />
              </button>
            </div>

            {/* 上传要求 */}
            <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <h4 className="font-medium text-amber-500 mb-2">上传要求</h4>
              <ul className="text-sm text-[var(--text-secondary)] space-y-1">
                <li>1. 模型文件必须是 <code className="px-1 py-0.5 bg-[var(--bg-tertiary)] rounded">.pt</code> 格式（YOLO26训练结果）</li>
                <li>2. 类别文件必须是 <code className="px-1 py-0.5 bg-[var(--bg-tertiary)] rounded">.txt</code> 格式，每行一个类别名称</li>
                <li>3. 目前仅支持 YOLO26 训练出来的模型</li>
              </ul>
            </div>

            {/* 模型名称输入 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                模型名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="输入模型名称，如：金属内壁缺陷检测模型"
                className="w-full px-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
              />
            </div>

            {/* 模型文件上传 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                模型文件 <span className="text-red-500">*</span>
              </label>
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
                  modelFile ? 'border-orange-500 bg-orange-500/5' : 'border-[var(--border-color)] hover:border-orange-500/50'
                }`}
                onClick={() => document.getElementById('modelFileInput')?.click()}
              >
                <input
                  id="modelFileInput"
                  type="file"
                  accept=".pt"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setModelFile(file);
                  }}
                />
                {modelFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <Brain size={24} className="text-orange-500" />
                    <div className="text-left">
                      <p className="text-[var(--text-primary)] font-medium">{modelFile.name}</p>
                      <p className="text-sm text-[var(--text-muted)]">
                        {(modelFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <Upload size={32} className="mx-auto text-[var(--text-muted)] mb-2" />
                    <p className="text-[var(--text-secondary)]">点击选择模型文件或拖拽到此处</p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">支持 .pt 格式</p>
                  </>
                )}
              </div>
            </div>

            {/* 类别名称输入 */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                缺陷类别 <span className="text-[var(--text-muted)]">(可选，每行一个类别名称)</span>
              </label>
              {classesFile ? (
                <div className="mb-2 flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                  <FileText size={16} className="text-emerald-500" />
                  <span className="text-sm text-[var(--text-primary)] flex-1">{classesFile.name}</span>
                  <button
                    onClick={() => setClassesFile(null)}
                    className="text-[var(--text-muted)] hover:text-red-500"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <textarea
                    value={classNamesText}
                    onChange={(e) => setClassNamesText(e.target.value)}
                    placeholder={'每行输入一个缺陷类别名称，例如：\n凸起\n焊缝\n裂纹\n腐蚀\n划痕'}
                    rows={5}
                    className="w-full px-4 py-3 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] resize-y font-mono text-sm"
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <p className="text-xs text-[var(--text-muted)]">
                      {classNamesText.trim() ? `已输入 ${classNamesText.trim().split('\n').filter(l => l.trim()).length} 个类别` : '或上传类别文件'}
                    </p>
                    <label className="cursor-pointer text-xs text-orange-500 hover:text-orange-600">
                      <input
                        type="file"
                        accept=".txt"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) setClassesFile(file);
                        }}
                      />
                      上传 .txt 文件
                    </label>
                  </div>
                </>
              )}
            </div>

            {/* 按钮 */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowUploadModal(false)}
                className="flex-1 px-4 py-2 border border-[var(--border-color)] text-[var(--text-secondary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleModelUpload}
                disabled={isUploading || !modelFile || !modelName.trim()}
                className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isUploading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    上传中...
                  </>
                ) : (
                  <>
                    <Upload size={18} />
                    开始上传
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default SystemSettingsPage;
