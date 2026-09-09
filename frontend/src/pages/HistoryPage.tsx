import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Filter,
  Calendar,
  Trash2,
  Eye,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  X,
  Image as ImageIcon,
  Clock,
  CheckCircle,
  AlertCircle,
  FileText,
  Loader2,
  Grid3X3,
  LayoutGrid,
  ZoomIn,
  ZoomOut,
  BarChart3,
  Activity,
  Download,
  FolderOpen,
  Folder,
  Camera,
  FileVideo,
  Maximize
} from 'lucide-react';
import { apiService } from '../services/ApiService';
import { useAuth } from '../contexts/AuthContext';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';

// 后端API基础URL（使用相对路径，依赖webpack代理）
const API_BASE_URL = '';

// 获取完整图片URL
const getImageUrl = (path?: string) => {
  if (!path) return '';
  if (path.startsWith('data:') || path.startsWith('http')) return path;
  // 兼容旧的 /api/uploads/ 路径和新的 /uploads/ 路径
  const normalizedPath = path.replace('/api/uploads/', '/uploads/');
  return `${API_BASE_URL}${normalizedPath}`;
};

interface DetectionRecord {
  id: string;
  detectionId: string;
  username: string;
  originalFilename: string;
  defectCount: number;
  confidence: number;
  processingTime: number;
  createdAt: string;
  status: 'completed' | 'failed';
  imageUrl?: string;
  resultImageUrl?: string;
  defects?: DefectDetail[];
}

interface DefectDetail {
  id: string;
  type: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  severity: 'low' | 'medium' | 'high';
}

interface CameraLog {
  id: string;
  source_type: 'camera' | 'video';
  source_name: string;
  defect_type: string;
  confidence: number;
  severity: 'info' | 'warning' | 'error';
  message: string;
  bbox?: { x: number; y: number; width: number; height: number };
  image_url?: string;
  saved: boolean;
  created_at: string;
  // 额外的详细信息
  result_image_url?: string;
  original_image_url?: string;
  defect_count?: number;
  processing_time?: number;
  username?: string;
  defects?: any[];
}

const DEFECT_TYPES_MAP: Record<string, { label: string; color: string }> = {
  '凸起': { label: '凸起', color: '#ef4444' },
  '焊缝': { label: '焊缝', color: '#3b82f6' },
  crack: { label: '裂纹', color: '#f97316' },
  corrosion: { label: '腐蚀', color: '#f59e0b' },
  pitting: { label: '点蚀', color: '#8b5cf6' },
  scratch: { label: '划痕', color: '#06b6d4' },
  dent: { label: '凹痕', color: '#3b82f6' },
  wear: { label: '磨损', color: '#06b6d4' },
  rust: { label: '锈蚀', color: '#eab308' },
  hole: { label: '孔洞', color: '#ec4899' },
  deformation: { label: '变形', color: '#7c2d12' },
  other: { label: '其他', color: '#6b7280' }
};

const getSeverityColor = (severity: string) => {
  switch (severity) {
    case 'high': return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'medium': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    case 'low': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    default: return 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]';
  }
};

const getSeverityLabel = (severity: string) => {
  switch (severity) {
    case 'high': return '严重';
    case 'medium': return '中等';
    case 'low': return '轻微';
    default: return '未知';
  }
};

// 批次分组记录类型
interface BatchGroup {
  batch_id: number;
  created_at: string;
  username: string;
  total_files: number;
  processed_files: number;
  total_defects: number;
  status: string;
  records: any[];
}

const HistoryPage: React.FC = () => {
  const { user } = useAuth();
  const [records, setRecords] = useState<DetectionRecord[]>([]);
  const [cameraLogs, setCameraLogs] = useState<CameraLog[]>([]);
  const [batchGroups, setBatchGroups] = useState<BatchGroup[]>([]);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<DetectionRecord | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(12);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'single' | 'batch'>('single');
  const [zoom, setZoom] = useState(1);
  const [activeTab, setActiveTab] = useState<'visual' | 'data'>('visual');
  const [detectionType, setDetectionType] = useState<'single' | 'batch' | 'camera' | 'video'>('single');
  const [showFilters, setShowFilters] = useState(true);
  const [severityFilters, setSeverityFilters] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [exportLoading, setExportLoading] = useState(false);
  const [selectedCameraLog, setSelectedCameraLog] = useState<CameraLog | null>(null);
  const [cameraLogImageZoom, setCameraLogImageZoom] = useState(1);
  const [cameraLogFullscreen, setCameraLogFullscreen] = useState(false);
  // 摄像头/视频检测批次分组
  const [cameraBatchGroups, setCameraBatchGroups] = useState<any[]>([]);
  const [expandedCameraBatches, setExpandedCameraBatches] = useState<Set<string>>(new Set());
  const [cameraViewMode, setCameraViewMode] = useState<'batch' | 'single'>('batch');

  useEffect(() => {
    fetchRecords();
  }, [detectionType]);

  // 按批次分组摄像头检测记录
  const groupCameraLogsByBatch = (logs: CameraLog[]) => {
    const groups: Record<string, CameraLog[]> = {};
    logs.forEach(log => {
      // 按日期 + 来源类型分组，使用 | 分隔符避免日期中的 / 干扰
      // 使用 YYYY-MM-DD 格式确保一致性
      const d = new Date(log.created_at);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const key = `${date}|${log.source_type}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(log);
    });
    
    return Object.entries(groups).map(([key, records]) => {
      const [date, sourceType] = key.split('|');
      const firstRecord = records[0];
      return {
        batch_id: key,
        batch_name: `${date} ${sourceType === 'camera' ? '摄像头' : '视频'}检测`,
        created_at: firstRecord.created_at,
        username: firstRecord.source_name || '未知',
        source_type: sourceType,
        total_files: records.length,
        records: records
      };
    }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  };

  const fetchRecords = async () => {
    console.log('🔍 fetchRecords 被调用, detectionType:', detectionType);
    setIsLoading(true);
    try {
      if (detectionType === 'camera' || detectionType === 'video') {
        // 从 camera_detections 表获取摄像头或视频检测日志
        // 根据 detectionType 筛选 source_type
        const sourceType = detectionType === 'camera' ? 'camera' : 'video';
        console.log('📡 开始调用 apiService.getCameraLogs...', sourceType);
        const logs = await apiService.getCameraLogs(undefined, sourceType, false, 100, 0);
        console.log('✅ getCameraLogs 返回数据:', logs);
        console.log('📊 日志数量:', logs?.length);
        
        // 转换为 CameraLog 格式（如果后端返回的格式不一致，进行映射）
        const formattedLogs: CameraLog[] = (logs || []).map((log: any) => {
          return {
            id: String(log.id),
            source_type: (log.source_type || 'camera') as 'camera' | 'video',
            source_name: log.source_name || log.session_id || '摄像头',
            defect_type: log.defect_type || 'defect',
            confidence: log.confidence || 0,
            severity: log.severity || ((log.confidence || 0) > 0.8 ? 'error' : (log.confidence || 0) > 0.5 ? 'warning' : 'info'),
            message: log.message || `检测到缺陷 (置信度: ${(log.confidence * 100).toFixed(1)}%)`,
            bbox: log.bbox,
            image_url: log.image_url || log.frame_path,
            saved: log.saved || log.defect_detected || false,
            created_at: log.created_at || log.timestamp,
            // 保存额外的详细信息用于详情查看
            result_image_url: log.result_image_url || log.image_url,
            original_image_url: log.original_image_url || log.image_url,
            defect_count: log.defect_count || (log.defect_detected ? 1 : 0),
            processing_time: log.processing_time,
            username: log.username,
            defects: log.defects
          };
        });
        
        console.log('格式化后的摄像头日志:', formattedLogs.length);
        setCameraLogs(formattedLogs);
        // 按批次分组
        const groups = groupCameraLogsByBatch(formattedLogs);
        setCameraBatchGroups(groups);
        // 默认展开第一个批次
        if (groups.length > 0) {
          setExpandedCameraBatches(new Set([groups[0].batch_id]));
        }
      } else if (detectionType === 'batch') {
        // 获取按批次分组的批量检测记录
        const batches = await apiService.getGroupedBatchRecords(undefined, 50);
        setBatchGroups(batches || []);
      } else {
        // 从后端API获取单张检测记录
        const records = await apiService.getDetectionRecords(
          undefined,
          detectionType,
          100
        );

        const formattedRecords: DetectionRecord[] = (records || []).map((record: any) => {
          // 解析缺陷详情（可能是字符串或数组）
          let defects = [];
          if (record.defect_details) {
            if (typeof record.defect_details === 'string') {
              try {
                defects = JSON.parse(record.defect_details);
              } catch (e) {
                defects = [];
              }
            } else if (Array.isArray(record.defect_details)) {
              defects = record.defect_details;
            }
          }

          // 格式化缺陷数据以匹配前端格式
          const formattedDefects = defects.map((d: any, idx: number) => ({
            id: `defect-${idx}`,
            type: d.class || d.type || 'unknown',
            confidence: d.confidence || d.confidence || 0,
            x: d.bbox?.x || d.x || 0,
            y: d.bbox?.y || d.y || 0,
            width: d.bbox?.width || d.width || 0,
            height: d.bbox?.height || d.height || 0,
            severity: (d.confidence || 0) > 0.9 ? 'high' : (d.confidence || 0) > 0.7 ? 'medium' : 'low'
          }));

          return {
            id: record.id,
            detectionId: record.detection_id || record.id,
            username: record.username || record.user_id || '未知用户',
            originalFilename: record.original_filename || record.filename || '未知文件',
            defectCount: record.defect_count || formattedDefects.length || 0,
            confidence: formattedDefects[0]?.confidence || record.confidence || 0,
            processingTime: record.processing_time || 0,
            createdAt: record.created_at || record.detection_time,
            status: record.status || 'completed',
            // 修复：imageUrl 应该是原图，resultImageUrl 是标注图
            imageUrl: record.original_image_url || record.image_url || '',  // 原图
            resultImageUrl: record.result_image_url || '',            // 标注图
            defects: formattedDefects
          };
        });

        setRecords(formattedRecords);
      }
    } catch (error) {
      console.error('Error fetching records:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // 切换批次展开/折叠
  const toggleBatchExpand = (batchId: number) => {
    setExpandedBatches(prev => {
      const next = new Set(prev);
      if (next.has(batchId)) {
        next.delete(batchId);
      } else {
        next.add(batchId);
      }
      return next;
    });
  };

  // 点击批次中的单张图片查看详情
  const handleRecordClick = (record: any) => {
    const defects = [];
    if (record.defect_details) {
      if (typeof record.defect_details === 'string') {
        try {
          defects.push(...JSON.parse(record.defect_details));
        } catch (e) {}
      } else if (Array.isArray(record.defect_details)) {
        defects.push(...record.defect_details);
      }
    }

    const formattedDefects = defects.map((d: any, idx: number) => ({
      id: `defect-${idx}`,
      type: d.class || d.type || 'unknown',
      confidence: d.confidence || 0,
      x: d.bbox?.x || d.x || 0,
      y: d.bbox?.y || d.y || 0,
      width: d.bbox?.width || d.width || 0,
      height: d.bbox?.height || d.height || 0,
      severity: (d.confidence || 0) > 0.9 ? 'high' : (d.confidence || 0) > 0.7 ? 'medium' : 'low'
    }));

    setSelectedRecord({
      id: record.id,
      detectionId: record.detection_id || record.id,
      username: record.username || record.user_id || '未知用户',
      originalFilename: record.original_filename || record.filename || '未知文件',
      defectCount: record.defect_count || formattedDefects.length || 0,
      confidence: formattedDefects[0]?.confidence || record.confidence || 0,
      processingTime: record.processing_time || 0,
      createdAt: record.created_at || record.detection_time,
      status: record.status || 'completed',
      // 修复：imageUrl 应该是原图，resultImageUrl 是标注图
      imageUrl: record.original_image_url || record.image_url || '',   // 原图
      resultImageUrl: record.result_image_url || '',                // 标注图
      defects: formattedDefects
    });
    setZoom(1);
    setActiveTab('visual');
  };

  // 格式化日期
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleDelete = async (id: string) => {
    console.log('🗑️ 删除记录:', id, '类型:', typeof id);
    try {
      if (detectionType === 'camera' || detectionType === 'video') {
        // 摄像头/视频检测记录保存在 detection_records 表中
        await apiService.deleteDetectionRecord(id);
        setCameraLogs(prev => prev.filter(r => r.id !== id));
        // 关闭详情模态框
        setSelectedCameraLog(null);
      } else if (detectionType === 'batch') {
        // 批量检测：更新 batchGroups
        await apiService.deleteDetectionRecord(id);
        setBatchGroups(prev => {
          return prev.map(batch => ({
            ...batch,
            records: batch.records.filter((r: any) => String(r.id) !== String(id)),
            total_files: batch.records.filter((r: any) => String(r.id) !== String(id)).length
          })).filter(batch => batch.records.length > 0); // 移除空批次
        });
        setSelectedItems(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } else {
        // 单张检测：更新 records
        await apiService.deleteDetectionRecord(id);
        setRecords(prev => prev.filter(r => String(r.id) !== String(id)));
        setSelectedItems(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
      // 如果删除的是当前选中的记录，关闭详情弹窗并刷新
      if (selectedRecord && String(selectedRecord.id) === String(id)) {
        setSelectedRecord(null);
        // 重新获取数据确保数据一致性
        fetchRecords();
      }
    } catch (error) {
      console.error('Error deleting record:', error);
      alert('删除失败，请重试');
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedItems.size === 0) return;
    
    try {
      const ids = Array.from(selectedItems);
      console.log('🗑️ 批量删除记录:', ids);
      if (detectionType === 'camera' || detectionType === 'video') {
        // 摄像头/视频检测记录保存在 detection_records 表中
        for (const id of ids) {
          await apiService.deleteDetectionRecord(id);
        }
        setCameraLogs(prev => prev.filter(r => !selectedItems.has(r.id)));
        // 关闭详情模态框
        setSelectedCameraLog(null);
      } else if (detectionType === 'batch') {
        // 批量检测：更新 batchGroups
        for (const id of ids) {
          await apiService.deleteDetectionRecord(id);
        }
        setBatchGroups(prev => {
          return prev.map(batch => ({
            ...batch,
            records: batch.records.filter((r: any) => !selectedItems.has(String(r.id))),
            total_files: batch.records.filter((r: any) => !selectedItems.has(String(r.id))).length
          })).filter(batch => batch.records.length > 0); // 移除空批次
        });
      } else {
        // 单张检测：更新 records
        for (const id of ids) {
          await apiService.deleteDetectionRecord(id);
        }
        setRecords(prev => prev.filter(r => !selectedItems.has(String(r.id))));
      }
      setSelectedItems(new Set());
      // 关闭详情弹窗（如果打开）
      if (selectedRecord && ids.some(id => String(selectedRecord.id) === String(id))) {
        setSelectedRecord(null);
      }
      // 重新获取数据确保数据一致性
      fetchRecords();
    } catch (error) {
      console.error('Error deleting records:', error);
      alert('删除失败，请重试');
    }
  };

  const toggleSeverityFilter = (severity: string) => {
    setSeverityFilters(prev =>
      prev.includes(severity)
        ? prev.filter(s => s !== severity)
        : [...prev, severity]
    );
  };

  const filteredRecords = useMemo(() => {
    let result = records.filter(record => {
      const matchesSearch =
        record.detectionId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.originalFilename.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.username.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesDate = (!dateRange.start || new Date(record.createdAt) >= new Date(dateRange.start)) &&
        (!dateRange.end || new Date(record.createdAt) <= new Date(dateRange.end + 'T23:59:59'));

      let matchesSeverity = true;
      if (severityFilters.length > 0) {
        matchesSeverity = severityFilters.some(filter => {
          switch (filter) {
            case 'none': return record.defectCount === 0;
            case 'minor': return record.defectCount >= 1 && record.defectCount <= 2;
            case 'medium': return record.defectCount >= 3 && record.defectCount <= 5;
            case 'severe': return record.defectCount > 5;
            default: return true;
          }
        });
      }

      return matchesSearch && matchesDate && matchesSeverity;
    });

    return result;
  }, [searchQuery, dateRange, severityFilters, records]);

  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredRecords.slice(start, start + itemsPerPage);
  }, [filteredRecords, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredRecords.length / itemsPerPage);

  const stats = useMemo(() => {
    let total = 0;
    let defectRecords = 0;
    let avgTime = '0';
    
    if (detectionType === 'single' || detectionType === 'batch') {
      // 单张/批量检测使用 filteredRecords
      total = filteredRecords.length;
      defectRecords = filteredRecords.filter(r => r.defectCount > 0).length;
      avgTime = total > 0
        ? (filteredRecords.reduce((sum, r) => sum + r.processingTime, 0) / total).toFixed(2)
        : '0';
    } else if (detectionType === 'camera' || detectionType === 'video') {
      // 摄像头/视频检测使用 cameraLogs
      total = cameraLogs.length;
      defectRecords = cameraLogs.filter(log => log.severity === 'error' || log.severity === 'warning').length;
      avgTime = '-';  // 视频/摄像头检测没有处理时间字段
    }
    
    const defectRate = total > 0 ? ((defectRecords / total) * 100).toFixed(1) : '0';
    return { total, defectRecords, defectRate, avgTime };
  }, [filteredRecords, cameraLogs, detectionType]);

  const toggleSelection = (id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 筛选批量检测记录（应用与 filteredRecords 相同的筛选逻辑）
  const getFilteredBatchRecords = useMemo(() => {
    if (detectionType !== 'batch') return [];
    const allBatchRecords = batchGroups.flatMap(b => b.records);
    
    return allBatchRecords.filter((record: any) => {
      const matchesSearch =
        (record.id || '').toString().toLowerCase().includes(searchQuery.toLowerCase()) ||
        (record.original_filename || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (record.filename || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (record.username || '').toLowerCase().includes(searchQuery.toLowerCase());
      
      const createdAt = record.created_at || record.detection_time || '';
      const matchesDate = (!dateRange.start || new Date(createdAt) >= new Date(dateRange.start)) &&
        (!dateRange.end || new Date(createdAt) <= new Date(dateRange.end + 'T23:59:59'));
      
      let matchesSeverity = true;
      const defectCount = record.defect_count || 0;
      if (severityFilters.length > 0) {
        matchesSeverity = severityFilters.some(filter => {
          switch (filter) {
            case 'none': return defectCount === 0;
            case 'minor': return defectCount >= 1 && defectCount <= 2;
            case 'medium': return defectCount >= 3 && defectCount <= 5;
            case 'severe': return defectCount > 5;
            default: return true;
          }
        });
      }
      
      return matchesSearch && matchesDate && matchesSeverity;
    });
  }, [detectionType, batchGroups, searchQuery, dateRange, severityFilters]);

  // 获取当前视图下所有可选的记录（用于全选）
  const getSelectableRecords = useMemo(() => {
    if (detectionType === 'batch') {
      // 批量检测视图：使用筛选后的记录
      return getFilteredBatchRecords.map((r: any) => r.id);
    } else if (detectionType === 'camera' || detectionType === 'video') {
      // 摄像头/视频检测视图：从 cameraLogs 中提取所有记录
      return cameraLogs.map(log => log.id);
    }
    // 单张检测：使用分页后的记录
    return paginatedRecords.map(r => r.id);
  }, [detectionType, getFilteredBatchRecords, paginatedRecords, cameraLogs]);

  const selectAll = () => {
    if (selectedItems.size === getSelectableRecords.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(getSelectableRecords));
    }
  };

  const formatDateTime = (isoString?: string) => {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // 处理导出
  const handleExport = async () => {
    setExportLoading(true);
    try {
      let recordsToExport: any[] = [];
      
      // 如果有选中的记录，导出选中的；否则导出所有
      if (selectedItems.size > 0) {
        // 导出选中的记录
        if (detectionType === 'batch') {
          // 批量检测：从筛选后的记录中提取选中的记录
          recordsToExport = getFilteredBatchRecords.filter((r: any) => selectedItems.has(r.id));
        } else {
          // 单张检测：从 filteredRecords 中提取选中的记录
          recordsToExport = filteredRecords.filter(r => selectedItems.has(r.id));
        }
      } else {
        // 导出所有符合筛选条件的记录
        if (detectionType === 'batch') {
          // 批量检测：使用筛选后的记录
          recordsToExport = getFilteredBatchRecords;
        } else {
          // 单张检测：使用 filteredRecords
          recordsToExport = filteredRecords;
        }
      }

      if (recordsToExport.length === 0) {
        alert('没有可导出的记录');
        setExportLoading(false);
        return;
      }

      // 生成CSV
      const headers = ['ID', '检测ID', '用户名', '原始文件名', '检测类型', '缺陷数量', '置信度', '处理时间', '状态', '创建时间', '原图URL', '结果图URL'];
      const csvRows = [headers.join(',')];
      
      for (const record of recordsToExport) {
        const row = [
          record.id || '',
          record.detectionId || record.detection_id || '',
          record.username || '',
          record.originalFilename || record.original_filename || '',
          record.detectionType || record.detection_type || detectionType,
          record.defectCount || record.defect_count || 0,
          record.confidence || 0,
          record.processingTime || record.processing_time || 0,
          record.status || 'completed',
          record.createdAt || record.created_at || '',
          record.imageUrl || record.image_url || '',
          record.resultImageUrl || record.result_image_url || ''
        ];
        // CSV转义：处理包含逗号或引号的值
        const escaped = row.map(val => {
          const str = String(val);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        });
        csvRows.push(escaped.join(','));
      }

      const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const prefix = selectedItems.size > 0 ? `selected_${selectedItems.size}` : 'all';
      a.download = `detection_records_${detectionType}_${prefix}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('导出失败:', error);
      alert('导出失败，请重试');
    } finally {
      setExportLoading(false);
    }
  };

  // 处理单条记录导出
  const handleExportDetail = async () => {
    if (!selectedRecord) return;
    setExportLoading(true);
    try {
      const blob = await apiService.exportDetectionDetail(selectedRecord.id, 'csv');
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `detection_detail_${selectedRecord.id}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('导出失败:', error);
      alert('导出失败，请重试');
    } finally {
      setExportLoading(false);
    }
  };

  const selectedRecordDefectDistribution = useMemo(() => {
    if (!selectedRecord || !selectedRecord.defects) return [];
    const distribution: Record<string, number> = {};
    selectedRecord.defects.forEach(d => {
      const label = DEFECT_TYPES_MAP[d.type]?.label || d.type;
      distribution[label] = (distribution[label] || 0) + 1;
    });
    return Object.entries(distribution).map(([name, count]) => ({
      name,
      value: count,
      color: DEFECT_TYPES_MAP[Object.keys(DEFECT_TYPES_MAP).find(k => DEFECT_TYPES_MAP[k].label === name) || 'other']?.color || '#6b7280'
    }));
  }, [selectedRecord]);

  const selectedRecordAvgConfidence = selectedRecord && selectedRecord.defects && selectedRecord.defects.length > 0
    ? selectedRecord.defects.reduce((acc, d) => acc + d.confidence, 0) / selectedRecord.defects.length
    : 0;

  const getCardClasses = (recordId: string) => {
    const base = 'bg-[var(--bg-tertiary)]/30 rounded-xl border border-[var(--border-color)] overflow-hidden hover:border-[var(--border-color)]/80 transition-all cursor-pointer group';
    const selected = 'border-orange-500 ring-2 ring-orange-500/20';
    return selectedItems.has(recordId) ? `${base} ${selected}` : base;
  };

  const getSelectionBtnClasses = (isSelected: boolean) => {
    const base = 'absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors z-10';
    if (isSelected) {
      return `${base} bg-orange-500 border-orange-500`;
    }
    return `${base} bg-[var(--bg-card)]/80 border-[var(--border-color)] hover:border-orange-500`;
  };

  return (
    <div className="flex gap-4 h-full">
      {/* Left Filter Panel */}
      <div className={showFilters ? 'w-72 flex-shrink-0' : 'w-0 flex-shrink-0 transition-all duration-300 overflow-hidden'}>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4 h-full overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2">
              <Filter size={16} className="text-[var(--text-muted)]" />
              筛选条件
            </h3>
            <button
              onClick={() => setShowFilters(false)}
              className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)]"
            >
              <ChevronLeft size={16} />
            </button>
          </div>

          {/* Date Range */}
          <div className="mb-6">
            <h4 className="text-xs font-medium text-[var(--text-muted)] mb-2 flex items-center gap-1">
              <Calendar size={14} />
              时间范围
            </h4>
            <div className="space-y-2">
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                className="w-full px-2 py-1.5 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 text-[var(--text-primary)]"
              />
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                className="w-full px-2 py-1.5 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 text-[var(--text-primary)]"
              />
            </div>
          </div>

          {/* Severity Filter */}
          <div className="mb-6">
            <h4 className="text-xs font-medium text-[var(--text-muted)] mb-2 flex items-center gap-1">
              <AlertCircle size={14} />
              缺陷严重度
            </h4>
            <div className="space-y-1">
              {[
                { key: 'none', label: '无缺陷记录', color: 'bg-emerald-500/20 text-emerald-400' },
                { key: 'minor', label: '轻微（1-2个）', color: 'bg-blue-500/20 text-blue-400' },
                { key: 'medium', label: '中等（3-5个）', color: 'bg-amber-500/20 text-amber-400' },
                { key: 'severe', label: '严重（>5个）', color: 'bg-red-500/20 text-red-400' }
              ].map(severity => (
                <button
                  key={severity.key}
                  onClick={() => toggleSeverityFilter(severity.key)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors hover:bg-[var(--bg-tertiary)]/50"
                >
                  <div className={'w-4 h-4 rounded flex items-center justify-center ' + severity.color}>
                    {severityFilters.includes(severity.key) && <CheckCircle size={10} />}
                  </div>
                  <span className="text-[var(--text-secondary)]">{severity.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="mt-6 pt-4 border-t border-[var(--border-color)]">
            <h4 className="text-xs font-medium text-[var(--text-muted)] mb-3">快速统计</h4>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-[var(--bg-tertiary)]/50 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-[var(--text-primary)]">{stats.total}</div>
                <div className="text-xs text-[var(--text-muted)]">总记录数</div>
              </div>
              <div className="bg-[var(--bg-tertiary)]/50 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-red-400">{stats.defectRecords}</div>
                <div className="text-xs text-[var(--text-muted)]">缺陷记录</div>
              </div>
              <div className="bg-[var(--bg-tertiary)]/50 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-orange-400">{stats.defectRate}%</div>
                <div className="text-xs text-[var(--text-muted)]">缺陷率</div>
              </div>
              <div className="bg-[var(--bg-tertiary)]/50 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-[var(--text-primary)]">{stats.avgTime}s</div>
                <div className="text-xs text-[var(--text-muted)]">平均处理时间</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Main Area */}
      <div className="flex-1 min-w-0">
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] h-full overflow-hidden">
          {/* Toolbar */}
          <div className="p-4 border-b border-[var(--border-color)] flex items-center gap-4">
            {!showFilters && (
              <button
                onClick={() => setShowFilters(true)}
                className="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-secondary)]"
              >
                <ChevronRight size={20} />
              </button>
            )}

            {/* Detection Type Tabs */}
            <div className="flex items-center gap-1 border border-[var(--border-color)] rounded-lg p-1">
              <button
                onClick={() => { setDetectionType('single'); setViewMode('single'); setSelectedItems(new Set()); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors"
                style={{ backgroundColor: detectionType === 'single' ? '#f97316' : 'transparent', color: detectionType === 'single' ? 'white' : 'var(--text-secondary)' }}
              >
                <ImageIcon size={14} />
                单张检测
              </button>
              <button
                onClick={() => { setDetectionType('batch'); setViewMode('batch'); setSelectedItems(new Set()); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors"
                style={{ backgroundColor: detectionType === 'batch' ? '#f97316' : 'transparent', color: detectionType === 'batch' ? 'white' : 'var(--text-secondary)' }}
              >
                <Grid3X3 size={14} />
                批量检测
              </button>
              <button
                onClick={() => { setDetectionType('video'); setViewMode('batch'); setSelectedItems(new Set()); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors"
                style={{ backgroundColor: detectionType === 'video' ? '#3b82f6' : 'transparent', color: detectionType === 'video' ? 'white' : 'var(--text-secondary)' }}
              >
                <FileVideo size={14} />
                视频检测
              </button>
              <button
                onClick={() => { setDetectionType('camera'); setViewMode('batch'); setSelectedItems(new Set()); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors"
                style={{ backgroundColor: detectionType === 'camera' ? '#10b981' : 'transparent', color: detectionType === 'camera' ? 'white' : 'var(--text-secondary)' }}
              >
                <Camera size={14} />
                摄像头检测
              </button>
            </div>

            {/* Search */}
            <div className="flex-1 max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
                <input
                  type="text"
                  placeholder={detectionType === 'camera' ? '按摄像头名称搜索...' : detectionType === 'video' ? '按视频名称搜索...' : '按文件名搜索...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 text-[var(--text-primary)] placeholder-[var(--text-muted)]"
                />
              </div>
            </div>

            {/* Select All & Batch Delete */}
            <div className="flex items-center gap-2">
              <button
                onClick={selectAll}
                className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
              >
                <div className="w-4 h-4 rounded border-2 flex items-center justify-center" style={{ borderColor: selectedItems.size === getSelectableRecords.length && getSelectableRecords.length > 0 ? '#f97316' : 'var(--border-color)', backgroundColor: selectedItems.size === getSelectableRecords.length && getSelectableRecords.length > 0 ? '#f97316' : 'transparent' }}>
                  {selectedItems.size === getSelectableRecords.length && getSelectableRecords.length > 0 && (
                    <CheckCircle size={12} className="text-white" />
                  )}
                </div>
                全选
              </button>
              {selectedItems.size > 0 && (
                <button
                  onClick={handleDeleteSelected}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                >
                  <Trash2 size={16} />
                  删除 ({selectedItems.size})
                </button>
              )}
            </div>

            {/* View Toggle */}
            {detectionType === 'batch' && (
              <div className="flex items-center gap-1 border border-[var(--border-color)] rounded-lg p-1">
                <button
                  onClick={() => setViewMode('single')}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm rounded transition-colors"
                  style={{ backgroundColor: viewMode === 'single' ? '#f97316' : 'transparent', color: viewMode === 'single' ? 'white' : 'var(--text-secondary)' }}
                >
                  <Grid3X3 size={14} />
                  单图视图
                </button>
                <button
                  onClick={() => setViewMode('batch')}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm rounded transition-colors"
                  style={{ backgroundColor: viewMode === 'batch' ? '#f97316' : 'transparent', color: viewMode === 'batch' ? 'white' : 'var(--text-secondary)' }}
                >
                  <LayoutGrid size={14} />
                  批次视图
                </button>
              </div>
            )}

            {/* Camera/Video View Toggle */}
            {(detectionType === 'camera' || detectionType === 'video') && (
              <div className="flex items-center gap-1 border border-[var(--border-color)] rounded-lg p-1">
                <button
                  onClick={() => setCameraViewMode('single')}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm rounded transition-colors"
                  style={{ backgroundColor: cameraViewMode === 'single' ? '#f97316' : 'transparent', color: cameraViewMode === 'single' ? 'white' : 'var(--text-secondary)' }}
                >
                  <Grid3X3 size={14} />
                  单图
                </button>
                <button
                  onClick={() => setCameraViewMode('batch')}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm rounded transition-colors"
                  style={{ backgroundColor: cameraViewMode === 'batch' ? '#f97316' : 'transparent', color: cameraViewMode === 'batch' ? 'white' : 'var(--text-secondary)' }}
                >
                  <Folder size={14} />
                  批次
                </button>
              </div>
            )}

            {/* Export Button */}
            {detectionType !== 'camera' && detectionType !== 'video' && (
              <button
                onClick={handleExport}
                disabled={exportLoading || (detectionType === 'batch' ? getFilteredBatchRecords.length === 0 : filteredRecords.length === 0)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors disabled:opacity-50"
                title={`导出${selectedItems.size > 0 ? selectedItems.size : (detectionType === 'batch' ? getFilteredBatchRecords.length : filteredRecords.length)}条记录`}
              >
                {exportLoading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                导出CSV {selectedItems.size > 0 ? `(${selectedItems.size})` : `(${detectionType === 'batch' ? getFilteredBatchRecords.length : filteredRecords.length})`}
              </button>
            )}
          </div>

          {/* Card Grid */}
          <div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(100% - 140px)' }}>
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 size={32} className="text-orange-500 animate-spin" />
                <span className="ml-3 text-[var(--text-muted)]">加载中...</span>
              </div>
            ) : detectionType === 'camera' || detectionType === 'video' ? (
              // 摄像头/视频检测视图
              cameraViewMode === 'batch' ? (
                // 批次视图
                cameraBatchGroups.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)]">
                    <Camera size={48} className="mb-4" />
                    <p>暂无{detectionType === 'video' ? '视频检测' : '摄像头检测'}记录</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {cameraBatchGroups.map((batch) => (
                      <motion.div
                        key={batch.batch_id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-[var(--bg-tertiary)]/30 rounded-xl border border-[var(--border-color)] overflow-hidden"
                      >
                        {/* 批次文件夹头部 */}
                        <div
                          className="flex items-center justify-between p-4 cursor-pointer hover:bg-[var(--bg-tertiary)]/50 transition-colors"
                          onClick={() => {
                            const newSet = new Set(expandedCameraBatches);
                            if (newSet.has(batch.batch_id)) {
                              newSet.delete(batch.batch_id);
                            } else {
                              newSet.add(batch.batch_id);
                            }
                            setExpandedCameraBatches(newSet);
                          }}
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{
                              backgroundColor: detectionType === 'video' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)'
                            }}>
                              {expandedCameraBatches.has(batch.batch_id) ? (
                                <FolderOpen size={24} className={detectionType === 'video' ? 'text-blue-500' : 'text-emerald-500'} />
                              ) : (
                                <Folder size={24} className={detectionType === 'video' ? 'text-blue-500' : 'text-emerald-500'} />
                              )}
                            </div>
                            <div>
                              <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                                {batch.batch_name}
                                <span className={`px-2 py-0.5 rounded text-xs ${
                                  detectionType === 'video' 
                                    ? 'bg-blue-500/20 text-blue-400' 
                                    : 'bg-emerald-500/20 text-emerald-400'
                                }`}>
                                  {batch.total_files} 张
                                </span>
                              </h3>
                              <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                                <span className="flex items-center gap-1">
                                  <Clock size={12} />
                                  {new Date(batch.created_at).toLocaleTimeString('zh-CN')}
                                </span>
                                <span>操作人: {batch.username}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <ChevronRight size={20} className={`text-[var(--text-muted)] transition-transform ${expandedCameraBatches.has(batch.batch_id) ? 'rotate-90' : ''}`} />
                          </div>
                        </div>

                        {/* 展开的记录列表 */}
                        {expandedCameraBatches.has(batch.batch_id) && (
                          <div className="p-4 pt-0 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                            {batch.records.map((log: CameraLog) => (
                              <div
                                key={log.id}
                                className={`bg-[var(--bg-card)] rounded-lg border overflow-hidden transition-all cursor-pointer group ${
                                  selectedItems.has(log.id)
                                    ? 'border-orange-500'
                                    : 'border-[var(--border-color)] hover:border-orange-500/50'
                                }`}
                                onClick={() => setSelectedCameraLog(log)}
                              >
                                {/* 复选框 */}
                                <div 
                                  className="absolute top-2 left-2 z-10 w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer transition-colors"
                                  style={{ 
                                    borderColor: selectedItems.has(log.id) ? '#f97316' : 'var(--border-color)',
                                    backgroundColor: selectedItems.has(log.id) ? '#f97316' : 'rgba(0,0,0,0.5)'
                                  }}
                                  onClick={(e) => { e.stopPropagation(); toggleSelection(log.id); }}
                                >
                                  {selectedItems.has(log.id) && <CheckCircle size={14} className="text-white" />}
                                </div>
                                {/* 缩略图 */}
                                <div className="aspect-square bg-[var(--bg-tertiary)] flex items-center justify-center overflow-hidden relative">
                                  {log.image_url ? (
                                    <img 
                                      src={getImageUrl(log.image_url)} 
                                      alt="" 
                                      className="w-full h-full object-cover group-hover:scale-105 transition-transform" 
                                    />
                                  ) : (
                                    <Activity size={32} className="text-[var(--text-muted)] opacity-50" />
                                  )}
                                </div>
                                {/* 信息 */}
                                <div className="p-2">
                                  <p className="text-xs text-[var(--text-primary)] truncate">{log.source_name}</p>
                                  <div className="flex items-center justify-between mt-1">
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                      log.severity === 'error' ? 'bg-red-500/20 text-red-400' :
                                      log.severity === 'warning' ? 'bg-amber-500/20 text-amber-400' :
                                      'bg-blue-500/20 text-blue-400'
                                    }`}>
                                      {(log.confidence * 100).toFixed(0)}%
                                    </span>
                                    <span className="text-[10px] text-[var(--text-muted)]">
                                      {new Date(log.created_at).toLocaleTimeString('zh-CN')}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </div>
                )
              ) : (
                // 单图视图
                cameraLogs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)]">
                    <Camera size={48} className="mb-4" />
                    <p>暂无{detectionType === 'video' ? '视频检测' : '摄像头检测'}记录</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {cameraLogs.map((log) => (
                        <div
                          key={log.id}
                          className={`bg-[var(--bg-tertiary)]/30 rounded-xl border p-4 transition-all cursor-pointer ${
                            selectedItems.has(log.id) 
                              ? 'border-orange-500 bg-orange-500/5' 
                              : 'border-[var(--border-color)] hover:border-[var(--border-color)]/80'
                          }`}
                          onClick={() => setSelectedCameraLog(log)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {/* 复选框 */}
                              <div 
                                className="w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer flex-shrink-0 transition-colors"
                                style={{ 
                                  borderColor: selectedItems.has(log.id) ? '#f97316' : 'var(--border-color)',
                                  backgroundColor: selectedItems.has(log.id) ? '#f97316' : 'transparent'
                                }}
                                onClick={(e) => { e.stopPropagation(); toggleSelection(log.id); }}
                              >
                                {selectedItems.has(log.id) && <CheckCircle size={14} className="text-white" />}
                              </div>
                              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{
                                backgroundColor: log.severity === 'error' ? 'rgba(239,68,68,0.2)' : log.severity === 'warning' ? 'rgba(245,158,11,0.2)' : 'rgba(59,130,246,0.2)'
                              }}>
                                {log.source_type === 'video' ? (
                                  <FileVideo size={20} className="text-blue-500" />
                                ) : (
                                  <Camera size={20} className="text-emerald-500" />
                                )}
                              </div>
                              <div>
                                <p className="text-sm font-medium text-[var(--text-primary)]">{log.source_name}</p>
                                <p className="text-xs text-[var(--text-muted)]">
                                  {log.source_type === 'camera' ? '摄像头' : '视频'} | {log.defect_type} | {(log.confidence * 100).toFixed(1)}%
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-[var(--text-muted)]">{new Date(log.created_at).toLocaleString('zh-CN')}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(log.id); }}
                                className="p-1.5 hover:bg-red-500/20 rounded-lg text-[var(--text-muted)] hover:text-red-400"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                          <p className="mt-2 text-xs text-[var(--text-secondary)]">{log.message}</p>
                          {log.image_url && (
                            <div className="mt-2 text-xs text-emerald-500 flex items-center gap-1">
                              <ImageIcon size={12} />
                              <span>已保存图片</span>
                            </div>
                          )}
                        </div>
                      ))
                    }
                  </div>
                )
              )
            ) : detectionType === 'batch' ? (
              // 批量检测视图
              viewMode === 'batch' ? (
                // 批次文件夹视图
                batchGroups.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)]">
                    <Folder size={48} className="mb-4" />
                    <p>暂无批量检测记录</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {batchGroups.map((batch) => (
                      <motion.div
                        key={batch.batch_id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-[var(--bg-tertiary)]/30 rounded-xl border border-[var(--border-color)] overflow-hidden"
                      >
                        {/* 批次文件夹头部 */}
                        <div
                          className="flex items-center justify-between p-4 cursor-pointer hover:bg-[var(--bg-tertiary)]/50 transition-colors"
                          onClick={() => toggleBatchExpand(batch.batch_id)}
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(249, 115, 22, 0.15)' }}>
                              {expandedBatches.has(batch.batch_id) ? (
                                <FolderOpen size={24} className="text-orange-500" />
                              ) : (
                                <Folder size={24} className="text-orange-500" />
                              )}
                            </div>
                            <div>
                              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                                {typeof batch.batch_id === 'number' ? `批次 #${batch.batch_id}` : batch.batch_name || formatDate(batch.created_at)}
                              </h3>
                              <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                                <span className="flex items-center gap-1">
                                  <Clock size={12} />
                                  {formatDate(batch.created_at)}
                                </span>
                                <span>操作人: {batch.username || '未知'}</span>
                              </div>
                              {/* 缩略图预览条（折叠时显示前4张） */}
                              {!expandedBatches.has(batch.batch_id) && batch.records.length > 0 && (
                                <div className="flex items-center gap-1 mt-2">
                                  {batch.records.slice(0, 4).map((r: any, idx: number) => (
                                    <div key={r.id || idx} className="w-8 h-8 rounded overflow-hidden border border-[var(--border-color)] bg-[var(--bg-tertiary)]">
                                      {(r.image_url || r.original_image_url) ? (
                                        <img src={getImageUrl(r.image_url || r.original_image_url)} alt="" className="w-full h-full object-cover" />
                                      ) : (
                                        <div className="w-full h-full flex items-center justify-center">
                                          <ImageIcon size={12} className="text-[var(--text-muted)]" />
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                  {batch.records.length > 4 && (
                                    <span className="text-xs text-[var(--text-muted)] ml-1">+{batch.records.length - 4}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-6">
                            <div className="flex items-center gap-6 text-sm">
                              <div className="text-center min-w-[50px]">
                                <div className="text-lg font-bold text-[var(--text-primary)]">{batch.total_files}</div>
                                <div className="text-xs text-[var(--text-muted)]">张照片</div>
                              </div>
                              <div className="text-center min-w-[50px]">
                                <div className="text-lg font-bold text-red-400">{batch.total_defects}</div>
                                <div className="text-xs text-[var(--text-muted)]">缺陷数</div>
                              </div>
                              <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                                batch.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                              }`}>
                                {batch.status === 'completed' ? '已完成' : '处理中'}
                              </div>
                            </div>
                            <div className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors">
                              {expandedBatches.has(batch.batch_id) ? (
                                <ChevronUp size={20} className="text-[var(--text-muted)]" />
                              ) : (
                                <ChevronDown size={20} className="text-[var(--text-muted)]" />
                              )}
                            </div>
                          </div>
                        </div>

                        {/* 批次图片列表（展开时显示） */}
                        <AnimatePresence>
                          {expandedBatches.has(batch.batch_id) && (
                            <motion.div
                              key={`batch-${batch.batch_id}`}
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.3 }}
                              className="border-t border-[var(--border-color)]"
                            >
                              <div className="p-4">
                                {/* 批次信息头部 */}
                                <div className="flex items-center justify-between mb-3">
                                  <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
                                    <span>检测时间: {formatDate(batch.created_at)}</span>
                                    <span>共 {batch.total_files} 张图片</span>
                                    <span>发现缺陷 {batch.total_defects} 处</span>
                                  </div>
                                </div>
                                {/* 图片网格 */}
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                                  {batch.records.map((record: any) => (
                                    <motion.div
                                      key={record.id}
                                      initial={{ opacity: 0, scale: 0.9 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      className={`bg-[var(--bg-tertiary)]/50 rounded-lg border overflow-hidden cursor-pointer hover:border-orange-500/50 hover:shadow-lg transition-all group ${
                                        selectedItems.has(record.id) ? 'border-orange-500 ring-2 ring-orange-500/20' : 'border-[var(--border-color)]'
                                      }`}
                                      onClick={() => handleRecordClick(record)}
                                    >
                                      {/* Selection Checkbox */}
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleSelection(record.id);
                                        }}
                                        className={`absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center z-10 transition-colors ${
                                          selectedItems.has(record.id) ? 'bg-orange-500 border-orange-500' : 'bg-black/30 border-white/50 hover:border-white'
                                        }`}
                                      >
                                        {selectedItems.has(record.id) && <CheckCircle size={12} className="text-white" />}
                                      </button>
                                      {/* 缩略图 */}
                                      <div className="relative aspect-square bg-[var(--bg-tertiary)]">
                                        {(record.image_url || record.original_image_url) ? (
                                          <img
                                            src={getImageUrl(record.image_url || record.original_image_url)}
                                            alt={record.original_filename || record.filename || '图片'}
                                            className="w-full h-full object-cover"
                                          />
                                        ) : (
                                          <div className="w-full h-full flex items-center justify-center">
                                            <ImageIcon size={24} className="text-[var(--text-muted)]" />
                                          </div>
                                        )}
                                        {/* 缺陷数量标签 */}
                                        {(record.defect_count || 0) > 0 ? (
                                          <div className="absolute top-2 right-1 px-1.5 py-0.5 bg-red-500 text-white text-xs rounded-full font-medium flex items-center gap-0.5">
                                            <AlertCircle size={10} />
                                            {record.defect_count}
                                          </div>
                                        ) : (
                                          <div className="absolute top-2 right-1 px-1.5 py-0.5 bg-emerald-500 text-white text-xs rounded-full font-medium">
                                            正常
                                          </div>
                                        )}
                                      </div>
                                      {/* 文件信息 */}
                                      <div className="p-2">
                                        <p className="text-xs text-[var(--text-primary)] truncate" title={record.original_filename || record.filename || '未知文件'}>
                                          {record.original_filename || record.filename || '未知文件'}
                                        </p>
                                        <p className="text-xs text-[var(--text-muted)]">
                                          {(record.confidence || 0) > 0 ? `${(record.confidence * 100).toFixed(0)}%` : '-'}
                                        </p>
                                      </div>
                                    </motion.div>
                                  ))}
                                </div>
                                {/* 底部提示 */}
                                <div className="mt-3 flex items-center justify-center gap-4 text-xs text-[var(--text-muted)]">
                                  <span className="flex items-center gap-1">
                                    <AlertCircle size={12} className="text-red-400" /> 有缺陷
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <CheckCircle size={12} className="text-emerald-400" /> 正常
                                  </span>
                                  <span>点击图片查看详细检测结果</span>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    ))}
                  </div>
                )
              ) : (
                // 批量检测单图视图 - 使用统一的筛选函数
                (() => {
                  if (getFilteredBatchRecords.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)]">
                        <FileText size={48} className="mb-4" />
                        <p>暂无批量检测记录</p>
                      </div>
                    );
                  }
                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                      {getFilteredBatchRecords.map((record: any) => (
                        <motion.div
                          key={record.id}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className={`relative bg-[var(--bg-tertiary)]/30 rounded-xl border overflow-hidden cursor-pointer hover:border-orange-500/50 transition-all ${
                            selectedItems.has(record.id) ? 'border-orange-500 ring-2 ring-orange-500/20' : 'border-[var(--border-color)]'
                          }`}
                          onClick={() => handleRecordClick(record)}
                        >
                          {/* Selection Checkbox */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelection(record.id);
                            }}
                            className={`absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center z-10 transition-colors ${
                              selectedItems.has(record.id) ? 'bg-orange-500 border-orange-500' : 'bg-black/30 border-white/50 hover:border-white'
                            }`}
                          >
                            {selectedItems.has(record.id) && <CheckCircle size={12} className="text-white" />}
                          </button>
                          <div className="relative aspect-square bg-[var(--bg-tertiary)]">
                            {(record.image_url || record.original_image_url) ? (
                              <img src={getImageUrl(record.image_url || record.original_image_url)} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <ImageIcon size={24} className="text-[var(--text-muted)]" />
                              </div>
                            )}
                            {(record.defect_count || 0) > 0 ? (
                              <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-red-500 text-white text-xs rounded-full">{record.defect_count}</div>
                            ) : (
                              <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-emerald-500 text-white text-xs rounded-full">正常</div>
                            )}
                          </div>
                          <div className="p-2">
                            <p className="text-xs text-[var(--text-primary)] truncate">{record.original_filename || record.filename || '未知文件'}</p>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  );
                })()
              )
            ) : paginatedRecords.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)]">
                <FileText size={48} className="mb-4" />
                <p>暂无检测记录</p>
              </div>
            ) : (
              <div className="grid gap-4" style={{
                gridTemplateColumns: viewMode === 'single' ? 'repeat(auto-fill, minmax(180px, 1fr))' : '1fr'
              }}>
                {paginatedRecords.map((record) => (
                  <motion.div
                    key={record.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={getCardClasses(record.id)}
                    onClick={() => {
                      setSelectedRecord(record);
                      setZoom(1);
                      setActiveTab('visual');
                    }}
                  >
                    {/* Thumbnail */}
                    <div className="relative bg-[var(--bg-tertiary)]/50" style={{ aspectRatio: viewMode === 'batch' ? '16/9' : '1/1', width: viewMode === 'batch' ? '192px' : '100%' }}>
                      {record.imageUrl ? (
                        <img
                          src={getImageUrl(record.imageUrl)}
                          alt={record.originalFilename}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon size={32} className="text-[var(--text-muted)]" />
                        </div>
                      )}
                      {/* Selection */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelection(record.id);
                        }}
                        className={getSelectionBtnClasses(selectedItems.has(record.id))}
                      >
                        {selectedItems.has(record.id) && <CheckCircle size={12} className="text-white" />}
                      </button>
                      {/* Defect Count */}
                      {record.defectCount > 0 && (
                        <div className="absolute top-2 right-2 px-2 py-1 bg-red-500 text-white text-xs rounded-full font-medium">
                          {record.defectCount} 个缺陷
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="p-3 flex-1">
                      <h4 className="text-sm font-medium text-[var(--text-primary)] truncate mb-1" title={record.originalFilename}>
                        {record.originalFilename}
                      </h4>
                      <div className="space-y-1 text-xs text-[var(--text-muted)]">
                        <div className="flex items-center gap-1">
                          <Clock size={12} />
                          <span>{formatDate(record.createdAt)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>缺陷: {record.defectCount}</span>
                          <span className="font-mono text-[var(--text-secondary)]">{(record.confidence * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {!isLoading && paginatedRecords.length > 0 && (
            <div className="p-4 border-t border-[var(--border-color)] flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className="text-sm text-[var(--text-muted)]">
                  第 {currentPage} / {totalPages} 页，共 {filteredRecords.length} 条
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[var(--text-muted)]">每页</span>
                  {[12, 24, 48].map(size => (
                    <button
                      key={size}
                      onClick={() => {
                        setItemsPerPage(size);
                        setCurrentPage(1);
                      }}
                      className="px-2 py-1 text-xs rounded transition-colors"
                      style={{
                        backgroundColor: itemsPerPage === size ? '#f97316' : 'var(--bg-tertiary)',
                        color: itemsPerPage === size ? 'white' : 'var(--text-secondary)'
                      }}
                    >
                      {size}
                    </button>
                  ))}
                  <span className="text-sm text-[var(--text-muted)]">条</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="flex items-center gap-1 px-3 py-2 text-sm border border-[var(--border-color)] rounded-lg hover:bg-[var(--bg-tertiary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-[var(--text-secondary)]"
                >
                  <ChevronLeft size={16} />
                  上一页
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="flex items-center gap-1 px-3 py-2 text-sm border border-[var(--border-color)] rounded-lg hover:bg-[var(--bg-tertiary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-[var(--text-secondary)]"
                >
                  下一页
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedRecord && (
          <motion.div
            key="history-detail-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
            onClick={() => setSelectedRecord(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[var(--bg-card)] rounded-xl max-w-5xl w-full max-h-[90vh] overflow-hidden border border-[var(--border-color)]"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
                <div>
                  <h3 className="text-base font-medium text-[var(--text-primary)]">{selectedRecord.originalFilename}</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    检测时间: {formatDateTime(selectedRecord.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleExportDetail}
                    disabled={exportLoading}
                    className="flex items-center gap-1 px-3 py-2 text-sm text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                  >
                    {exportLoading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                    导出
                  </button>
                  <button
                    onClick={() => handleDelete(selectedRecord.id)}
                    className="flex items-center gap-1 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                    删除
                  </button>
                  <button
                    onClick={() => setSelectedRecord(null)}
                    className="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-secondary)]"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Tab Switch */}
              <div className="px-4 pt-4">
                <div className="flex gap-1 bg-[var(--bg-tertiary)]/50 rounded-lg p-1">
                  <button
                    onClick={() => setActiveTab('visual')}
                    className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors"
                    style={{
                      backgroundColor: activeTab === 'visual' ? '#f97316' : 'transparent',
                      color: activeTab === 'visual' ? 'white' : 'var(--text-secondary)'
                    }}
                  >
                    <Eye size={16} />
                    可视化结果
                  </button>
                  <button
                    onClick={() => setActiveTab('data')}
                    className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors"
                    style={{
                      backgroundColor: activeTab === 'data' ? '#f97316' : 'transparent',
                      color: activeTab === 'data' ? 'white' : 'var(--text-secondary)'
                    }}
                  >
                    <FileText size={16} />
                    详细数据
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 160px)' }}>
                {activeTab === 'visual' && (
                  <div className="space-y-4">
                    {/* Image Comparison */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-[var(--text-primary)]">原始图像</span>
                        </div>
                        <div className="bg-[var(--bg-tertiary)]/50 rounded-lg overflow-hidden flex items-center justify-center" style={{ height: '280px' }}>
                          {selectedRecord.imageUrl ? (
                            <img
                              src={getImageUrl(selectedRecord.imageUrl)}
                              alt="原始"
                              className="max-w-full max-h-full object-contain"
                              style={{ transform: 'scale(' + zoom + ')' }}
                            />
                          ) : (
                            <ImageIcon size={48} className="text-[var(--text-muted)]" />
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-[var(--text-primary)]">标注图像</span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
                              className="p-1 hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-secondary)]"
                            >
                              <ZoomOut size={16} />
                            </button>
                            <span className="text-xs text-[var(--text-muted)] w-12 text-center">{Math.round(zoom * 100)}%</span>
                            <button
                              onClick={() => setZoom(z => Math.min(2, z + 0.25))}
                              className="p-1 hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-secondary)]"
                            >
                              <ZoomIn size={16} />
                            </button>
                          </div>
                        </div>
                        <div className="bg-[var(--bg-tertiary)]/50 rounded-lg overflow-hidden flex items-center justify-center" style={{ height: '280px' }}>
                          {selectedRecord.resultImageUrl ? (
                            <img
                              src={getImageUrl(selectedRecord.resultImageUrl)}
                              alt="标注"
                              className="max-w-full max-h-full object-contain"
                              style={{ transform: 'scale(' + zoom + ')' }}
                            />
                          ) : (
                            /* 如果没有标注图，显示提示 */
                            <div className="text-center text-[var(--text-muted)]">
                              <ImageIcon size={48} className="mx-auto mb-2" />
                              <p className="text-sm">暂无标注图像</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-4 gap-4">
                      <div className="bg-[var(--bg-tertiary)]/50 rounded-lg p-4 text-center">
                        <div className="text-2xl font-bold text-[var(--text-primary)]">{selectedRecord.defectCount}</div>
                        <div className="text-xs text-[var(--text-muted)]">缺陷数量</div>
                      </div>
                      <div className="bg-[var(--bg-tertiary)]/50 rounded-lg p-4 text-center">
                        <div className="text-2xl font-bold text-orange-400">{(selectedRecordAvgConfidence * 100).toFixed(1)}%</div>
                        <div className="text-xs text-[var(--text-muted)]">平均置信度</div>
                      </div>
                      <div className="bg-[var(--bg-tertiary)]/50 rounded-lg p-4 text-center">
                        <div className="text-2xl font-bold text-[var(--text-primary)]">{selectedRecord.processingTime}s</div>
                        <div className="text-xs text-[var(--text-muted)]">处理时间</div>
                      </div>
                      <div className="bg-[var(--bg-tertiary)]/50 rounded-lg p-4 text-center">
                        <div className="text-2xl font-bold text-[var(--text-primary)]">{selectedRecord.username}</div>
                        <div className="text-xs text-[var(--text-muted)]">检测用户</div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'data' && (
                  <div className="space-y-4">
                    {/* Defect Detail Table */}
                    {!selectedRecord.defects || selectedRecord.defects.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-[var(--text-muted)]">
                        <CheckCircle size={48} className="mb-4 text-emerald-500" />
                        <p>未检测到缺陷</p>
                      </div>
                    ) : (
                      <div className="bg-[var(--bg-tertiary)]/30 rounded-lg border border-[var(--border-color)] overflow-hidden">
                        <table className="w-full">
                          <thead className="bg-[var(--bg-tertiary)]/50">
                            <tr>
                              <th className="text-left py-3 px-4 text-sm font-medium text-[var(--text-muted)]">序号</th>
                              <th className="text-left py-3 px-4 text-sm font-medium text-[var(--text-muted)]">缺陷类型</th>
                              <th className="text-left py-3 px-4 text-sm font-medium text-[var(--text-muted)]">置信度</th>
                              <th className="text-left py-3 px-4 text-sm font-medium text-[var(--text-muted)]">严重程度</th>
                              <th className="text-left py-3 px-4 text-sm font-medium text-[var(--text-muted)]">位置坐标</th>
                              <th className="text-left py-3 px-4 text-sm font-medium text-[var(--text-muted)]">边界框</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--border-color)]">
                            {selectedRecord.defects.map((defect, index) => (
                              <tr key={defect.id} className="hover:bg-[var(--bg-tertiary)]/30">
                                <td className="py-3 px-4 text-sm text-[var(--text-primary)]">{index + 1}</td>
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-2">
                                    <span
                                      className="w-3 h-3 rounded-full"
                                      style={{ backgroundColor: DEFECT_TYPES_MAP[defect.type]?.color || '#6b7280' }}
                                    />
                                    <span className="text-sm text-[var(--text-primary)]">
                                      {DEFECT_TYPES_MAP[defect.type]?.label || defect.type}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-sm font-mono text-[var(--text-primary)]">
                                  {(defect.confidence * 100).toFixed(1)}%
                                </td>
                                <td className="py-3 px-4">
                                  <span className={'inline-block px-2 py-1 rounded-full text-xs border ' + getSeverityColor(defect.severity)}>
                                    {getSeverityLabel(defect.severity)}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-sm font-mono text-[var(--text-muted)]">
                                  ({defect.x}, {defect.y})
                                </td>
                                <td className="py-3 px-4 text-sm font-mono text-[var(--text-muted)]">
                                  {defect.width}×{defect.height}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Camera Log Detail Modal */}
      <AnimatePresence>
        {selectedCameraLog && (
          <motion.div
            key="camera-log-detail-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
            onClick={() => setSelectedCameraLog(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[var(--bg-card)] rounded-xl max-w-5xl w-full max-h-[90vh] overflow-hidden border border-[var(--border-color)]"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    selectedCameraLog.source_type === 'video' 
                      ? 'bg-blue-500/20' 
                      : 'bg-emerald-500/20'
                  }`}>
                    {selectedCameraLog.source_type === 'video' ? (
                      <FileVideo size={20} className="text-blue-500" />
                    ) : (
                      <Camera size={20} className="text-emerald-500" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-base font-medium text-[var(--text-primary)]">
                      {selectedCameraLog.source_name}
                      <span className={`ml-2 inline-block px-2 py-0.5 rounded text-xs ${
                        selectedCameraLog.source_type === 'video' 
                          ? 'bg-blue-500/20 text-blue-400' 
                          : 'bg-emerald-500/20 text-emerald-400'
                      }`}>
                        {selectedCameraLog.source_type === 'video' ? '视频检测' : '摄像头检测'}
                      </span>
                    </h3>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      检测时间: {new Date(selectedCameraLog.created_at).toLocaleString('zh-CN')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selectedCameraLog.image_url && (
                    <>
                      <button
                        onClick={() => setCameraLogFullscreen(true)}
                        className="flex items-center gap-1 px-3 py-2 text-sm text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                      >
                        <Maximize size={16} />
                        全屏
                      </button>
                      <button
                        onClick={() => {
                          const a = document.createElement('a');
                          a.href = getImageUrl(selectedCameraLog.image_url);
                          a.download = `检测截图_${selectedCameraLog.id}.png`;
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
                    onClick={() => handleDelete(selectedCameraLog.id)}
                    className="flex items-center gap-1 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                    删除
                  </button>
                  <button
                    onClick={() => {
                      setSelectedCameraLog(null);
                      setCameraLogImageZoom(1);
                    }}
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
                        {selectedCameraLog.image_url && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setCameraLogImageZoom(z => Math.max(0.5, z - 0.25))}
                              className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)]"
                            >
                              <ZoomOut size={14} />
                            </button>
                            <span className="text-xs text-[var(--text-muted)] w-12 text-center">
                              {Math.round(cameraLogImageZoom * 100)}%
                            </span>
                            <button
                              onClick={() => setCameraLogImageZoom(z => Math.min(3, z + 0.25))}
                              className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)]"
                            >
                              <ZoomIn size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="bg-[var(--bg-tertiary)]/50 rounded-lg overflow-hidden flex items-center justify-center cursor-pointer" 
                           style={{ height: '320px' }}
                           onClick={() => (selectedCameraLog.result_image_url || selectedCameraLog.image_url) && setCameraLogFullscreen(true)}>
                        {/* 优先显示标注图片，其次显示原图 */}
                        {(selectedCameraLog.result_image_url || selectedCameraLog.image_url) ? (
                          <img
                            src={getImageUrl(selectedCameraLog.result_image_url || selectedCameraLog.image_url)}
                            alt="检测图片"
                            className="max-w-full max-h-full object-contain transition-transform"
                            style={{ transform: `scale(${cameraLogImageZoom})` }}
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-[var(--text-muted)]">
                            <ImageIcon size={48} className="mb-2 opacity-50" />
                            <p className="text-sm">未保存截图</p>
                            <p className="text-xs mt-1">点击保存按钮保存此检测</p>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-2 text-center">
                        {(selectedCameraLog.result_image_url || selectedCameraLog.image_url) 
                          ? '点击图片可全屏查看' 
                          : '此检测未保存截图'}
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
                          <div className="text-xs text-[var(--text-muted)] mb-1">缺陷类型</div>
                          <div className="flex items-center gap-2">
                            <span 
                              className="w-3 h-3 rounded-full" 
                              style={{ backgroundColor: DEFECT_TYPES_MAP[selectedCameraLog.defect_type]?.color || '#6b7280' }}
                            />
                            <span className="text-sm font-medium text-[var(--text-primary)]">
                              {DEFECT_TYPES_MAP[selectedCameraLog.defect_type]?.label || selectedCameraLog.defect_type || '无'}
                            </span>
                          </div>
                        </div>
                        <div className="bg-[var(--bg-card)]/50 rounded-lg p-3">
                          <div className="text-xs text-[var(--text-muted)] mb-1">置信度</div>
                          <div className="text-xl font-bold text-orange-500">
                            {(selectedCameraLog.confidence * 100).toFixed(1)}%
                          </div>
                        </div>
                        <div className="bg-[var(--bg-card)]/50 rounded-lg p-3">
                          <div className="text-xs text-[var(--text-muted)] mb-1">严重程度</div>
                          <span className={`inline-block px-2 py-1 rounded text-sm font-medium ${
                            selectedCameraLog.severity === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                            selectedCameraLog.severity === 'warning' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                            'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          }`}>
                            {selectedCameraLog.severity === 'error' ? '⚠️ 危险' :
                             selectedCameraLog.severity === 'warning' ? '⚡ 警告' : '✓ 正常'}
                          </span>
                        </div>
                        <div className="bg-[var(--bg-card)]/50 rounded-lg p-3">
                          <div className="text-xs text-[var(--text-muted)] mb-1">保存状态</div>
                          {selectedCameraLog.saved ? (
                            <span className="inline-flex items-center gap-1 text-sm text-emerald-400">
                              <CheckCircle size={14} /> 已保存
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-sm text-amber-400">
                              <AlertCircle size={14} /> 未保存
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 详细信息 */}
                    <div className="bg-[var(--bg-tertiary)]/30 rounded-xl border border-[var(--border-color)] p-4">
                      <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">详细信息</h4>
                      <div className="space-y-3">
                        <div className="flex items-start justify-between">
                          <span className="text-xs text-[var(--text-muted)]">来源</span>
                          <span className="text-sm text-[var(--text-primary)] text-right">
                            {selectedCameraLog.source_type === 'video' ? '视频文件检测' : '实时摄像头检测'}
                          </span>
                        </div>
                        <div className="flex items-start justify-between">
                          <span className="text-xs text-[var(--text-muted)]">设备/文件</span>
                          <span className="text-sm text-[var(--text-primary)] text-right">{selectedCameraLog.source_name}</span>
                        </div>
                        <div className="flex items-start justify-between">
                          <span className="text-xs text-[var(--text-muted)]">检测时间</span>
                          <span className="text-sm text-[var(--text-primary)] text-right">
                            {new Date(selectedCameraLog.created_at).toLocaleString('zh-CN')}
                          </span>
                        </div>
                        {selectedCameraLog.bbox && (
                          <div className="flex items-start justify-between">
                            <span className="text-xs text-[var(--text-muted)]">检测区域</span>
                            <span className="text-sm font-mono text-[var(--text-secondary)] text-right">
                              X: {selectedCameraLog.bbox.x}, Y: {selectedCameraLog.bbox.y}
                              <br />
                              {selectedCameraLog.bbox.width} × {selectedCameraLog.bbox.height} px
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 检测消息 */}
                    <div className="bg-[var(--bg-tertiary)]/30 rounded-xl border border-[var(--border-color)] p-4">
                      <h4 className="text-sm font-medium text-[var(--text-primary)] mb-2">检测描述</h4>
                      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                        {selectedCameraLog.message || '无描述'}
                      </p>
                    </div>

                    {/* 图片路径 */}
                    {selectedCameraLog.image_url && (
                      <div className="bg-[var(--bg-tertiary)]/30 rounded-xl border border-[var(--border-color)] p-4">
                        <h4 className="text-sm font-medium text-[var(--text-primary)] mb-2">存储路径</h4>
                        <p className="text-xs text-[var(--text-muted)] font-mono break-all">
                          {selectedCameraLog.image_url}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fullscreen Image Viewer */}
      <AnimatePresence>
        {cameraLogFullscreen && selectedCameraLog?.image_url && (
          <motion.div
            key="fullscreen-viewer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/95 flex items-center justify-center z-[100]"
            onClick={() => setCameraLogFullscreen(false)}
          >
            <button
              className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-lg text-white/70 hover:text-white transition-colors"
              onClick={() => setCameraLogFullscreen(false)}
            >
              <X size={24} />
            </button>
            <button
              className="absolute top-4 left-4 p-2 hover:bg-white/10 rounded-lg text-white/70 hover:text-white transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                const a = document.createElement('a');
                a.href = getImageUrl(selectedCameraLog.image_url);
                a.download = `检测截图_${selectedCameraLog.id}.png`;
                a.click();
              }}
            >
              <Download size={24} />
            </button>
            <motion.img
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              src={getImageUrl(selectedCameraLog.image_url)}
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

export default HistoryPage;
