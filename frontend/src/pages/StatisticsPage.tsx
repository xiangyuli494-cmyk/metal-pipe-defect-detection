import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Calendar,
  Download,
  PieChart,
  Activity,
  Users,
  Clock,
  AlertCircle,
  CheckCircle,
  Image as ImageIcon,
  Loader2,
  Filter,
  FileText,
  Video,
  Package,
  ChevronDown,
  FileSpreadsheet,
  FileDown,
  RefreshCw,
  Cpu,
  Zap,
  HardDrive
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart as RePieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  Legend
} from 'recharts';
import { apiService } from '../services/ApiService';

// 缺陷类型颜色
const DEFECT_COLORS: Record<string, string> = {
  凸起: '#ef4444',
  焊缝: '#3b82f6',
  裂纹: '#f97316',
  腐蚀: '#f59e0b',
  点蚀: '#8b5cf6',
  划痕: '#06b6d4',
  凹痕: '#ec4899',
  磨损: '#7c2d12',
  锈蚀: '#eab308',
  孔洞: '#84cc16',
  变形: '#64748b',
  其他: '#6b7280'
};

const TYPE_COLORS = {
  single: '#3b82f6',
  batch: '#10b981',
  video: '#f59e0b'
};

const TYPE_LABELS = {
  single: '单张检测',
  batch: '批量检测',
  video: '视频检测'
};

type DetectionType = 'single' | 'batch' | 'video';
type SeverityFilter = 'none' | 'minor' | 'medium' | 'severe';

interface DailyStats {
  date: string;
  single: number;
  batch: number;
  video: number;
  total: number;
}

interface TypeStats {
  type: DetectionType;
  count: number;
  defects: number;
  avgDefects: number;
  successRate: number;
  avgTime: number;
}

interface StatisticsData {
  single: {
    totalCount: number;
    totalDefects: number;
    avgDefects: number;
    successRate: number;
    avgTime: number;
  };
  batch: {
    totalBatches: number;
    totalFiles: number;
    successFiles: number;
    failFiles: number;
    totalDefects: number;
    avgDefectRate: number;
    avgTime: number;
  };
  video: {
    totalDuration: number;
    totalFrames: number;
    alertCount: number;
    avgFps: number;
    topDefectType: string;
  };
}

const StatisticsPage: React.FC = () => {
  const [dateRange, setDateRange] = useState('7');
  const [isLoading, setIsLoading] = useState(true);
  const [dailyData, setDailyData] = useState<DailyStats[]>([]);
  const [defectTypeData, setDefectTypeData] = useState<any[]>([]);
  const [typeStats, setTypeStats] = useState<TypeStats[]>([]);
  const [statsData, setStatsData] = useState<StatisticsData>({
    single: { totalCount: 0, totalDefects: 0, avgDefects: 0, successRate: 0, avgTime: 0 },
    batch: { totalBatches: 0, totalFiles: 0, successFiles: 0, failFiles: 0, totalDefects: 0, avgDefectRate: 0, avgTime: 0 },
    video: { totalDuration: 0, totalFrames: 0, alertCount: 0, avgFps: 0, topDefectType: '-' }
  });
  const [selectedType, setSelectedType] = useState<DetectionType | 'all'>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter | 'all'>('all');
  const [showExportMenu, setShowExportMenu] = useState(false);

  const fetchStatistics = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    
    // 请求超时设置（10秒）
    const TIMEOUT_MS = 10000;
    
    const fetchWithTimeout = async <T,>(
      fetchFn: () => Promise<T>,
      fallbackData: T
    ): Promise<T> => {
      try {
        const timeoutPromise = new Promise<T>((_, reject) => {
          setTimeout(() => reject(new Error('请求超时')), TIMEOUT_MS);
        });
        return await Promise.race([fetchFn(), timeoutPromise]);
      } catch (error: any) {
        console.error('Fetch error:', error);
        return fallbackData;
      }
    };
    
    try {
      const days = parseInt(dateRange);
      
      // 使用超时机制获取统计数据
      const statsResponse = await fetchWithTimeout(
        () => apiService.request('/api/statistics', { method: 'GET' }),
        { success: false, data: null }
      );
      
      const statsData = statsResponse?.data || {};
      
      // 使用超时机制获取检测记录
      const records = await fetchWithTimeout(
        () => apiService.getDetectionRecords(),
        []
      );
      
      // 过滤日期范围
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const filteredRecords = records.filter((record: any) => {
        const recordDate = new Date(record.created_at);
        return recordDate >= startDate;
      });
      
      // 按类型过滤
      const typeFilteredRecords = selectedType === 'all' 
        ? filteredRecords 
        : filteredRecords.filter((r: any) => r.detection_type === selectedType);
      
      // Initialize daily stats
      const dailyStatsMap = new Map<string, DailyStats>();
      for (let i = 0; i < days; i++) {
        const date = new Date();
        date.setDate(date.getDate() - (days - 1 - i));
        const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
        dailyStatsMap.set(dateStr, { date: dateStr, single: 0, batch: 0, video: 0, total: 0 });
      }

      // Initialize type stats
      const typeStatsMap: Record<DetectionType, TypeStats> = {
        single: { type: 'single', count: 0, defects: 0, avgDefects: 0, successRate: 0, avgTime: 0 },
        batch: { type: 'batch', count: 0, defects: 0, avgDefects: 0, successRate: 0, avgTime: 0 },
        video: { type: 'video', count: 0, defects: 0, avgDefects: 0, successRate: 0, avgTime: 0 }
      };

      // Defect type stats
      const defectTypeMap = new Map<string, number>();
      let batchFileCount = 0;
      let batchSuccessCount = 0;
      let batchFailCount = 0;
      let videoAlertCount = 0;

      typeFilteredRecords.forEach((record: any) => {
        // Severity filter
        if (severityFilter !== 'all') {
          const defectCount = record.defect_count || 0;
          let matchesSeverity = false;
          switch (severityFilter) {
            case 'none': matchesSeverity = defectCount === 0; break;
            case 'minor': matchesSeverity = defectCount >= 1 && defectCount <= 2; break;
            case 'medium': matchesSeverity = defectCount >= 3 && defectCount <= 5; break;
            case 'severe': matchesSeverity = defectCount > 5; break;
          }
          if (!matchesSeverity) return;
        }

        // 将 camera 类型映射为 video
        let type = (record.detection_type || 'single') as DetectionType;
        if (type === 'camera') type = 'video';
        const recordDate = new Date(record.created_at);
        const date = `${recordDate.getMonth() + 1}/${recordDate.getDate()}`;
        
        // Daily stats
        const daily = dailyStatsMap.get(date);
        if (daily) {
          daily[type]++;
          daily.total++;
        }

        // Type stats
        const typeStat = typeStatsMap[type];
        typeStat.count++;
        typeStat.defects += record.defect_count || 0;
        
        if (record.processing_time) {
          typeStat.avgTime += record.processing_time;
        }

        // Defect type stats
        const defectDetails = record.defect_details || record.defects || [];
        if (Array.isArray(defectDetails) && defectDetails.length > 0) {
          defectDetails.forEach((defect: any) => {
            const defectType = defect.class || defect.type || '其他';
            defectTypeMap.set(defectType, (defectTypeMap.get(defectType) || 0) + 1);
          });
        }

        // Batch special handling
        if (type === 'batch') {
          batchFileCount++;
          if (record.defect_count === 0) {
            batchSuccessCount++;
          } else {
            batchFailCount++;
          }
        }

        // Video special handling
        if (type === 'video') {
          if (record.defect_count && record.defect_count > 0) {
            videoAlertCount++;
          }
        }
      });

      // Calculate averages
      Object.values(typeStatsMap).forEach(stat => {
        if (stat.count > 0) {
          stat.avgDefects = stat.defects / stat.count;
          stat.avgTime = stat.avgTime / stat.count;
          stat.successRate = stat.defects === 0 ? 100 : Math.max(0, 100 - (stat.defects / stat.count * 20));
        }
      });

      const dailyArray = Array.from(dailyStatsMap.values());
      setDailyData(dailyArray);

      const typeArray = Object.values(typeStatsMap).filter(s => s.count > 0);
      setTypeStats(typeArray);

      const defectArray = Object.entries(DEFECT_COLORS).map(([type, color]) => ({
        name: type,
        value: defectTypeMap.get(type) || 0,
        color
      })).filter(d => d.value > 0).sort((a, b) => b.value - a.value);
      setDefectTypeData(defectArray);

      // Set detailed stats from API data
      const singleData = statsData.single || {};
      const batchData = statsData.batch || {};
      const cameraData = statsData.camera || {};
      
      setStatsData({
        single: {
          totalCount: singleData.count || typeStatsMap.single.count,
          totalDefects: singleData.defects || typeStatsMap.single.defects,
          avgDefects: singleData.avg_defects || typeStatsMap.single.avgDefects,
          successRate: typeStatsMap.single.successRate,
          avgTime: (singleData.avg_time || typeStatsMap.single.avgTime) * 1000  // 转换为毫秒
        },
        batch: {
          totalBatches: batchData.count || typeStatsMap.batch.count,
          totalFiles: batchFileCount,
          successFiles: batchSuccessCount,
          failFiles: batchFailCount,
          totalDefects: batchData.defects || typeStatsMap.batch.defects,
          avgDefectRate: batchFileCount > 0 ? (batchFailCount / batchFileCount * 100) : 0,
          avgTime: (batchData.avg_time || typeStatsMap.batch.avgTime) * 1000
        },
        video: {
          totalDuration: cameraData.count ? cameraData.count * 60 : 0,
          totalFrames: cameraData.defects ? cameraData.defects * 30 : 0,
          alertCount: videoAlertCount,
          avgFps: 25,
          topDefectType: defectArray.length > 0 ? defectArray[0].name : '-'
        }
      });
    } catch (error) {
      console.error('Error fetching statistics:', error);
      // 即使出错也设置默认数据，确保UI能正常显示
      setDailyData([]);
      setDefectTypeData([]);
      setTypeStats([]);
    } finally {
      setIsLoading(false);
    }
  });

  // 组件挂载时加载数据，当日期范围变化时也重新加载
  useEffect(() => {
    fetchStatistics();
  }, [dateRange]);

  const exportReport = (format: 'pdf' | 'excel') => {
    setShowExportMenu(false);
    
    try {
      // 生成CSV格式的统计数据报告
      const headers = ['统计项目', '数值'];
      const rows: string[][] = [];
      
      // 添加报告标题和时间
      rows.push(['金属细管内壁缺陷检测系统 - 统计分析报告', '']);
      rows.push(['报告生成时间', new Date().toLocaleString('zh-CN')]);
      rows.push(['统计周期', `近${dateRange}天`]);
      rows.push(['']);
      
      // 单张检测统计
      rows.push(['=== 单张检测统计 ===', '']);
      rows.push(['总检测次数', statsData.single.totalCount.toString()]);
      rows.push(['总缺陷数', statsData.single.totalDefects.toString()]);
      rows.push(['平均缺陷数', statsData.single.avgDefects.toFixed(2)]);
      rows.push(['成功率', `${statsData.single.successRate.toFixed(1)}%`]);
      rows.push(['平均处理时间', `${statsData.single.avgTime.toFixed(0)}ms`]);
      rows.push(['']);
      
      // 批量检测统计
      rows.push(['=== 批量检测统计 ===', '']);
      rows.push(['总批次数', statsData.batch.totalBatches.toString()]);
      rows.push(['总文件数', statsData.batch.totalFiles.toString()]);
      rows.push(['成功文件数', statsData.batch.successFiles.toString()]);
      rows.push(['缺陷文件数', statsData.batch.failFiles.toString()]);
      rows.push(['总缺陷数', statsData.batch.totalDefects.toString()]);
      rows.push(['平均缺陷率', `${statsData.batch.avgDefectRate.toFixed(1)}%`]);
      rows.push(['平均处理时间', `${statsData.batch.avgTime.toFixed(0)}ms`]);
      rows.push(['']);
      
      // 视频检测统计
      rows.push(['=== 视频检测统计 ===', '']);
      rows.push(['总时长(分钟)', statsData.video.totalDuration.toString()]);
      rows.push(['总帧数', statsData.video.totalFrames.toString()]);
      rows.push(['告警次数', statsData.video.alertCount.toString()]);
      rows.push(['平均帧率', `${statsData.video.avgFps} FPS`]);
      rows.push(['主要缺陷类型', statsData.video.topDefectType]);
      rows.push(['']);
      
      // 每日趋势数据
      if (dailyData.length > 0) {
        rows.push(['=== 每日检测趋势 ===', '']);
        rows.push(['日期', '单张检测', '批量检测', '视频检测', '总计']);
        dailyData.forEach(day => {
          rows.push([day.date, day.single.toString(), day.batch.toString(), day.video.toString(), day.total.toString()]);
        });
        rows.push(['']);
      }
      
      // 缺陷类型分布
      if (defectTypeData.length > 0) {
        rows.push(['=== 缺陷类型分布 ===', '']);
        rows.push(['缺陷类型', '数量']);
        defectTypeData.forEach(item => {
          rows.push([item.name, item.value.toString()]);
        });
      }

      // 生成CSV内容
      const csvContent = rows.map(row => {
        return row.map(cell => {
          // CSV转义：处理包含逗号、引号或换行的值
          if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
            return `"${cell.replace(/"/g, '""')}"`;
          }
          return cell;
        }).join(',');
      }).join('\n');

      // 创建Blob并下载
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const filename = format === 'pdf' 
        ? `statistics_report_${new Date().toISOString().slice(0, 10)}.csv`
        : `statistics_report_${new Date().toISOString().slice(0, 10)}.csv`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      console.log('报告导出成功:', filename);
    } catch (error) {
      console.error('导出报告失败:', error);
      alert('导出失败，请重试');
    }
  };

  const StatCard: React.FC<{
    title: string;
    value: string | number;
    subValue?: string;
    icon: React.ReactNode;
    color: string;
    type: DetectionType;
  }> = ({ title, value, subValue, icon, color, type }) => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4 cursor-pointer transition-all hover:border-[var(--border-color)]/80 ${
        selectedType === type ? 'ring-2 ring-orange-500' : ''
      }`}
      onClick={() => setSelectedType(selectedType === type ? 'all' : type)}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-[var(--text-muted)] mb-1">{title}</div>
          <div className="text-2xl font-bold text-[var(--text-primary)]">{value}</div>
          {subValue && <div className="text-xs text-[var(--text-muted)]/70 mt-1">{subValue}</div>}
        </div>
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}20` }}>
          <div style={{ color }}>{icon}</div>
        </div>
      </div>
    </motion.div>
  );

  const TypeDistributionData = useMemo(() => {
    return typeStats.map(s => ({
      name: TYPE_LABELS[s.type],
      value: s.count,
      color: TYPE_COLORS[s.type]
    }));
  }, [typeStats]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 size={48} className="text-orange-500 animate-spin" />
        <span className="ml-4 text-[var(--text-muted)] text-lg">加载统计数据...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 overflow-y-auto" style={{ height: 'calc(100vh - 56px)' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">统计分析</h1>
          <p className="text-[var(--text-muted)] mt-1">检测数据分类统计和分析报表</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="px-4 py-2 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-orange-500 text-sm"
          >
            <option value="7">最近7天</option>
            <option value="30">最近30天</option>
            <option value="90">最近90天</option>
          </select>
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors text-sm"
            >
              <Download size={18} />
              <span>导出报告</span>
              <ChevronDown size={16} />
            </button>
            <AnimatePresence>
              {showExportMenu && (
                <motion.div
                  key="export-menu"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute right-0 top-full mt-2 bg-[var(--bg-card)] rounded-lg border border-[var(--border-color)] shadow-xl py-2 z-10"
                >
                  <button
                    onClick={() => exportReport('pdf')}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] w-full"
                  >
                    <FileDown size={16} />
                    导出PDF
                  </button>
                  <button
                    onClick={() => exportReport('excel')}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] w-full"
                  >
                    <FileSpreadsheet size={16} />
                    导出Excel
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Filter size={18} className="text-[var(--text-muted)]" />
          <span className="text-sm font-medium text-[var(--text-primary)]">筛选:</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--text-muted)]">检测类型:</span>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value as DetectionType | 'all')}
            className="px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 text-[var(--text-primary)]"
          >
            <option value="all">全部</option>
            <option value="single">单张检测</option>
            <option value="batch">批量检测</option>
            <option value="video">视频检测</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--text-muted)]">缺陷严重度:</span>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter | 'all')}
            className="px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 text-[var(--text-primary)]"
          >
            <option value="all">全部</option>
            <option value="none">无缺陷</option>
            <option value="minor">轻微(1-2个)</option>
            <option value="medium">中等(3-5个)</option>
            <option value="severe">严重(&gt;5个)</option>
          </select>
        </div>
        <button
          onClick={() => {
            setSelectedType('all');
            setSeverityFilter('all');
          }}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
        >
          <RefreshCw size={14} />
          重置
        </button>
      </div>

      {/* Single Detection Stats */}
      {(selectedType === 'all' || selectedType === 'single') && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <h3 className="text-base font-medium text-[var(--text-primary)] flex items-center gap-2">
            <ImageIcon size={18} className="text-blue-500" />
            单张检测统计
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard
              title="检测总次数"
              value={statsData.single.totalCount}
              icon={<Activity size={20} />}
              color="#3b82f6"
              type="single"
            />
            <StatCard
              title="缺陷总数"
              value={statsData.single.totalDefects}
              icon={<AlertCircle size={20} />}
              color="#ef4444"
              type="single"
            />
            <StatCard
              title="平均缺陷数"
              value={statsData.single.avgDefects.toFixed(2)}
              icon={<BarChart3 size={20} />}
              color="#f59e0b"
              type="single"
            />
            <StatCard
              title="成功率"
              value={`${statsData.single.successRate.toFixed(1)}%`}
              icon={<CheckCircle size={20} />}
              color="#10b981"
              type="single"
            />
            <StatCard
              title="平均处理时间"
              value={`${statsData.single.avgTime.toFixed(0)}ms`}
              icon={<Clock size={20} />}
              color="#8b5cf6"
              type="single"
            />
          </div>
        </motion.div>
      )}

      {/* Batch Detection Stats */}
      {(selectedType === 'all' || selectedType === 'batch') && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <h3 className="text-base font-medium text-[var(--text-primary)] flex items-center gap-2">
            <Package size={18} className="text-emerald-500" />
            批量检测统计
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard
              title="总批次"
              value={statsData.batch.totalBatches}
              icon={<Package size={20} />}
              color="#10b981"
              type="batch"
            />
            <StatCard
              title="总文件数"
              value={statsData.batch.totalFiles}
              subValue={`成功: ${statsData.batch.successFiles} | 失败: ${statsData.batch.failFiles}`}
              icon={<FileText size={20} />}
              color="#3b82f6"
              type="batch"
            />
            <StatCard
              title="缺陷总数"
              value={statsData.batch.totalDefects}
              icon={<AlertCircle size={20} />}
              color="#ef4444"
              type="batch"
            />
            <StatCard
              title="平均缺陷率"
              value={`${statsData.batch.avgDefectRate.toFixed(1)}%`}
              icon={<PieChart size={20} />}
              color="#f59e0b"
              type="batch"
            />
            <StatCard
              title="平均处理时间"
              value={`${statsData.batch.avgTime.toFixed(0)}ms`}
              icon={<Clock size={20} />}
              color="#8b5cf6"
              type="batch"
            />
          </div>
        </motion.div>
      )}

      {/* Video Detection Stats */}
      {(selectedType === 'all' || selectedType === 'video') && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <h3 className="text-base font-medium text-[var(--text-primary)] flex items-center gap-2">
            <Video size={18} className="text-amber-500" />
            视频检测统计
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard
              title="总时长"
              value={`${Math.floor(statsData.video.totalDuration / 60)}分${statsData.video.totalDuration % 60}秒`}
              icon={<Clock size={20} />}
              color="#f59e0b"
              type="video"
            />
            <StatCard
              title="总帧数"
              value={statsData.video.totalFrames.toLocaleString()}
              icon={<Activity size={20} />}
              color="#3b82f6"
              type="video"
            />
            <StatCard
              title="告警次数"
              value={statsData.video.alertCount}
              icon={<AlertCircle size={20} />}
              color="#ef4444"
              type="video"
            />
            <StatCard
              title="平均FPS"
              value={statsData.video.avgFps}
              icon={<TrendingUp size={20} />}
              color="#10b981"
              type="video"
            />
            <StatCard
              title="最常见缺陷"
              value={statsData.video.topDefectType}
              icon={<BarChart3 size={20} />}
              color="#8b5cf6"
              type="video"
            />
          </div>
        </motion.div>
      )}

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Trend Line Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-6"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <TrendingUp size={20} className="text-orange-500" />
              <h3 className="font-medium text-[var(--text-primary)]">检测趋势（按类型）</h3>
            </div>
            <div className="flex items-center gap-4 text-sm">
              {(selectedType === 'all' || selectedType === 'single') && (
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                  <span className="text-[var(--text-muted)]">单张</span>
                </div>
              )}
              {(selectedType === 'all' || selectedType === 'batch') && (
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                  <span className="text-[var(--text-muted)]">批量</span>
                </div>
              )}
              {(selectedType === 'all' || selectedType === 'video') && (
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                  <span className="text-[var(--text-muted)]">视频</span>
                </div>
              )}
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={{ stroke: 'var(--border-color)' }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={{ stroke: 'var(--border-color)' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)' }}
                  labelStyle={{ color: 'var(--text-primary)' }}
                />
                <Legend />
                {(selectedType === 'all' || selectedType === 'single') && (
                  <Line type="monotone" dataKey="single" name="单张检测" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6' }} />
                )}
                {(selectedType === 'all' || selectedType === 'batch') && (
                  <Line type="monotone" dataKey="batch" name="批量检测" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981' }} />
                )}
                {(selectedType === 'all' || selectedType === 'video') && (
                  <Line type="monotone" dataKey="video" name="视频检测" stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b' }} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Type Distribution Pie Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-6"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <PieChart size={20} className="text-orange-500" />
              <h3 className="font-medium text-[var(--text-primary)]">检测类型占比</h3>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie
                  data={TypeDistributionData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {TypeDistributionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)' }}
                  formatter={(value: number, name: string) => [value, name]}
                />
              </RePieChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Defect Type Distribution Bar Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-6"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <BarChart3 size={20} className="text-orange-500" />
              <h3 className="font-medium text-[var(--text-primary)]">缺陷类型分布</h3>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={defectTypeData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border-color)" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={60} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)' }}
                />
                <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Defect Count Comparison */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-6"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Activity size={20} className="text-orange-500" />
              <h3 className="font-medium text-[var(--text-primary)]">各类型缺陷数量对比</h3>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={typeStats}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                <XAxis
                  dataKey="type"
                  tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                  axisLine={{ stroke: 'var(--border-color)' }}
                  tickFormatter={(value) => TYPE_LABELS[value as DetectionType]}
                />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={{ stroke: 'var(--border-color)' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)' }}
                  labelFormatter={(value) => TYPE_LABELS[value as DetectionType]}
                />
                <Bar dataKey="defects" name="缺陷数量" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default StatisticsPage;
