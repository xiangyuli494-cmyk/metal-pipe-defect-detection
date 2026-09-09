import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import apiService from '../services/ApiService';
import {
  Upload,
  Play,
  Pause,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  X,
  FileImage,
  Trash2,
  Download,
  Clock,
  Package,
  Settings,
  FileText,
  Eye,
  BarChart3,
  PieChart as PieChartIcon,
  Save,
  FileDown,
  ZoomIn,
  ZoomOut,
  Layers,
  Info,
  Calendar,
  Cpu,
  Activity,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  TrendingUp,
  TrendingDown
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts';

interface BatchFile {
  id: string;
  file: File;
  preview: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  defectCount?: number;
  confidence?: number;
  processingTime?: number;
  detectionTime?: string;
  defects?: DefectDetail[];
  error?: string;
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

interface BatchSettings {
  threads: number;
  priority: 'low' | 'normal' | 'high';
  outputFormat: 'image' | 'zip' | 'pdf';
}

// 根据YOLO模型的实际检测类别更新
const DEFECT_TYPES_MAP: Record<string, { label: string; color: string; description: string }> = {
  '凸起': { label: '凸起', color: '#ef4444', description: '金属表面凸起缺陷' },
  '焊缝': { label: '焊缝', color: '#3b82f6', description: '焊缝缺陷' },
  'crack': { label: '裂纹', color: '#f97316', description: '金属表面出现的裂缝' },
  'corrosion': { label: '腐蚀', color: '#f59e0b', description: '化学或电化学腐蚀' },
  'other': { label: '其他', color: '#6b7280', description: '其他类型缺陷' }
};

// 主要显示YOLO模型支持的缺陷类型
const DEFECT_TYPE_LIST = [
  { key: '凸起', label: '凸起', color: '#ef4444' },
  { key: '焊缝', label: '焊缝', color: '#3b82f6' },
  { key: 'crack', label: '裂纹', color: '#f97316' },
  { key: 'corrosion', label: '腐蚀', color: '#f59e0b' },
  { key: 'other', label: '其他', color: '#6b7280' }
];

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6b7280'];

const BatchDetectionPage: React.FC = () => {
  const [files, setFiles] = useState<BatchFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedFile, setSelectedFile] = useState<BatchFile | null>(null);
  const [settings, setSettings] = useState<BatchSettings>({
    threads: 4,
    priority: 'normal',
    outputFormat: 'image'
  });
  const [zoom, setZoom] = useState(1);
  const [activeTab, setActiveTab] = useState<'visual' | 'data'>('visual');
  const [supportedDefectTypes, setSupportedDefectTypes] = useState<Array<{key: string, label: string, color: string}>>([]);
  const [confidenceThreshold, setConfidenceThreshold] = useState(30);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length + droppedFiles.length > 50) {
      alert('最多只能上传50个文件');
      return;
    }
    addFiles(droppedFiles);
  }, [files.length]);

  const addFiles = (newFiles: File[]) => {
    const batchFiles: BatchFile[] = newFiles.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      preview: URL.createObjectURL(file),
      status: 'pending'
    }));
    setFiles(prev => [...prev, ...batchFiles]);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    if (files.length + newFiles.length > 50) {
      alert('最多只能上传50个文件');
      return;
    }
    addFiles(newFiles);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 获取模型支持的缺陷类型
  useEffect(() => {
    const fetchModelInfo = async () => {
      try {
        const status = await apiService.getModelStatus();
        if (status.class_names && status.class_names.length > 0) {
          const defectTypes = status.class_names.map((className: string, index: number) => {
            const colors = ['#ef4444', '#3b82f6', '#f97316', '#f59e0b', '#8b5cf6', '#06b6d4'];
            const color = colors[index % colors.length];
            
            return {
              key: className,
              label: className,
              color: color
            };
          });
          
          setSupportedDefectTypes(defectTypes);
        }
      } catch (error) {
        console.error('获取模型信息失败:', error);
      }
    };
    
    fetchModelInfo();
  }, []);

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const clearAllFiles = () => {
    setFiles([]);
  };

  const simulateBatchDetection = async () => {
    if (files.length === 0 || isProcessing) return;

    setIsProcessing(true);
    setIsPaused(false);

    const pendingFiles = files.filter(f => f.status === 'pending');
    
    for (let i = 0; i < pendingFiles.length; i++) {
      if (isPaused) {
        await new Promise(resolve => {
          const check = () => {
            if (!isPaused) resolve(undefined);
            else setTimeout(check, 100);
          };
          check();
        });
      }

      const file = pendingFiles[i];
      
      setFiles(prev => prev.map(f => 
        f.id === file.id ? { ...f, status: 'processing' } : f
      ));

      try {
        const startTime = Date.now();
        
        // 获取当前用户信息
        const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
        
        // 调用真实YOLO模型API，传递用户信息
        const response = await apiService.predict(file.file, {
          userId: currentUser.id,
          username: currentUser.username,
          confidenceThreshold: confidenceThreshold / 100, // 转换为0-1范围
          iouThreshold: 0.45,
          detectionType: 'batch' // 标记为批量检测
        });
        
        const processingTime = Date.now() - startTime;
        
        if (response.success) {
          const result = response.result || { detections: [], count: 0 };
          
          // 转换结果为前端格式
          const defects: DefectDetail[] = result.detections.map((detection: any, index: number) => {
            const confidence = detection.confidence || 0.5;
            return {
              id: `defect-${index}`,
              type: detection.class || 'other',
              confidence,
              x: detection.bbox?.x || 0,
              y: detection.bbox?.y || 0,
              width: detection.bbox?.width || 0,
              height: detection.bbox?.height || 0,
              severity: confidence > 0.9 ? 'high' : confidence > 0.8 ? 'medium' : 'low'
            };
          });

          // 使用后端返回的标注图片作为预览
          const annotatedPreview = result.annotated_image || file.preview;

          setFiles(prev => prev.map(f => 
            f.id === file.id 
              ? { 
                  ...f, 
                  status: 'completed',
                  defectCount: result.count,
                  confidence: defects.length > 0 ? defects.reduce((acc, d) => acc + d.confidence, 0) / defects.length : 0.95,
                  processingTime,
                  detectionTime: new Date().toISOString(),
                  defects,
                  preview: annotatedPreview // 更新为标注后的图片
                } 
              : f
          ));
        } else {
          throw new Error(response.message || '检测失败');
        }
      } catch (error) {
        console.error(`文件 ${file.file.name} 检测失败:`, error);
        
        setFiles(prev => prev.map(f => 
          f.id === file.id 
            ? { 
                ...f, 
                status: 'failed',
                error: error instanceof Error ? error.message : '未知错误'
              } 
            : f
        ));
      }
    }

    setIsProcessing(false);
  };

  const pauseProcessing = () => setIsPaused(true);
  const resumeProcessing = () => setIsPaused(false);
  const cancelProcessing = () => {
    setIsProcessing(false);
    setIsPaused(false);
    setFiles(prev => prev.map(f => f.status === 'processing' ? { ...f, status: 'pending' } : f));
  };

  const resetBatch = () => {
    setFiles([]);
    setIsProcessing(false);
    setIsPaused(false);
  };

  const getStatusIcon = (status: BatchFile['status']) => {
    switch (status) {
      case 'pending':
        return <Clock size={14} className="text-[var(--text-muted)]" />;
      case 'processing':
        return <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><RefreshCw size={14} className="text-orange-400" /></motion.div>;
      case 'completed':
        return <CheckCircle size={14} className="text-emerald-400" />;
      case 'failed':
        return <AlertCircle size={14} className="text-red-400" />;
    }
  };

  const getStatusText = (status: BatchFile['status']) => {
    switch (status) {
      case 'pending': return '待处理';
      case 'processing': return '处理中';
      case 'completed': return '已完成';
      case 'failed': return '失败';
    }
  };

  const getStatusClass = (status: BatchFile['status']) => {
    switch (status) {
      case 'pending': return 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]';
      case 'processing': return 'bg-orange-500/20 text-orange-400';
      case 'completed': return 'bg-emerald-500/20 text-emerald-400';
      case 'failed': return 'bg-red-500/20 text-red-400';
    }
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

  const getRiskLevel = (defectCount: number, avgConfidence: number) => {
    if (defectCount === 0) return { level: '无风险', color: 'text-emerald-400', suggestion: '产品合格，可正常出厂' };
    if (defectCount >= 5 || avgConfidence > 0.9) return { level: '高风险', color: 'text-red-400', suggestion: '建议立即返工或报废处理' };
    if (defectCount >= 3 || avgConfidence > 0.8) return { level: '中风险', color: 'text-amber-400', suggestion: '建议复检或降级使用' };
    return { level: '低风险', color: 'text-emerald-400', suggestion: '可接受范围内，建议监控' };
  };

  // 批量检测全部导出报告功能
  const exportAllBatchReports = async (type: 'pdf' | 'json' | 'csv') => {
    if (files.length === 0) return;

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
    const filename = `批量检测报告汇总_${timestamp}`;

    if (type === 'json') {
      const report = {
        reportId: `BATCH-${Date.now()}`,
        generateTime: new Date().toISOString(),
        summary: {
          totalFiles: stats.total,
          completedFiles: stats.completed,
          totalDefects: stats.totalDefects,
          successRate: stats.successRate + '%',
          avgDefects: stats.avgDefects,
          totalProcessingTime: formatTime(stats.totalTime),
        },
        files: files.map((f, idx) => {
          const avgConf = f.defects && f.defects.length > 0
            ? f.defects.reduce((acc, d) => acc + d.confidence, 0) / f.defects.length : 0;
          return {
            id: idx + 1,
            fileName: f.file.name,
            fileSize: formatSize(f.file.size),
            status: f.status,
            defectCount: f.defectCount || 0,
            avgConfidence: avgConf,
            processingTime: f.processingTime ? (f.processingTime / 1000).toFixed(3) + 's' : '-',
            detectionTime: f.detectionTime || '-',
            defects: f.defects?.map((d, i) => ({
              id: i + 1,
              type: d.type,
              confidence: d.confidence,
              severity: d.severity,
              position: { x: d.x, y: d.y },
              size: { width: d.width, height: d.height },
            })) || [],
          };
        }),
      };
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${filename}.json`; a.click();
      URL.revokeObjectURL(url);
    } else if (type === 'csv') {
      const header = '序号,文件名,文件大小,状态,缺陷数量,平均置信度,处理时间,检测时间\n';
      const rows = files.map((f, idx) => {
        const avgConf = f.defects && f.defects.length > 0
          ? (f.defects.reduce((acc, d) => acc + d.confidence, 0) / f.defects.length * 100).toFixed(1) + '%'
          : '-';
        return `${idx + 1},${f.file.name},${formatSize(f.file.size)},${f.status},${f.defectCount || 0},${avgConf},${f.processingTime ? (f.processingTime / 1000).toFixed(3) + 's' : '-'},${f.detectionTime || '-'}`;
      }).join('\n');
      const blob = new Blob([`\uFEFF${header}${rows}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${filename}.csv`; a.click();
      URL.revokeObjectURL(url);
    } else if (type === 'pdf') {
      const htmlContent = `
        <div style="width: 794px; padding: 40px; font-family: 'Microsoft YaHei', 'SimHei', 'Arial', sans-serif; background: white; color: #333;">
          <h1 style="text-align: center; font-size: 24px; margin-bottom: 10px; color: #333;">批量检测汇总报告</h1>
          <p style="text-align: center; color: #666; margin-bottom: 30px;">生成时间: ${new Date().toLocaleString('zh-CN')}</p>
          
          <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="font-size: 16px; margin-bottom: 10px;">检测概况</h2>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <p><strong>总文件数:</strong> ${stats.total}</p>
              <p><strong>已完成:</strong> ${stats.completed}</p>
              <p><strong>缺陷总数:</strong> ${stats.totalDefects}</p>
              <p><strong>合格率:</strong> ${stats.successRate}%</p>
              <p><strong>平均缺陷数:</strong> ${stats.avgDefects}</p>
              <p><strong>总处理时间:</strong> ${formatTime(stats.totalTime)}</p>
            </div>
          </div>
          
          <h2 style="font-size: 16px; margin: 20px 0 10px;">文件检测详情</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
            <thead>
              <tr style="background: #f5f5f5;">
                <th style="border: 1px solid #ddd; padding: 6px;">序号</th>
                <th style="border: 1px solid #ddd; padding: 6px;">文件名</th>
                <th style="border: 1px solid #ddd; padding: 6px;">状态</th>
                <th style="border: 1px solid #ddd; padding: 6px;">缺陷数</th>
                <th style="border: 1px solid #ddd; padding: 6px;">置信度</th>
                <th style="border: 1px solid #ddd; padding: 6px;">处理时间</th>
              </tr>
            </thead>
            <tbody>
              ${files.map((f, i) => {
                const avgConf = f.defects && f.defects.length > 0
                  ? (f.defects.reduce((acc, d) => acc + d.confidence, 0) / f.defects.length * 100).toFixed(1) + '%'
                  : '-';
                return `
                  <tr style="background: ${i % 2 === 0 ? '#fff' : '#fafafa'};">
                    <td style="border: 1px solid #ddd; padding: 6px; text-align: center;">${i + 1}</td>
                    <td style="border: 1px solid #ddd; padding: 6px;">${f.file.name}</td>
                    <td style="border: 1px solid #ddd; padding: 6px; text-align: center;">${f.status}</td>
                    <td style="border: 1px solid #ddd; padding: 6px; text-align: center;">${f.defectCount || 0}</td>
                    <td style="border: 1px solid #ddd; padding: 6px; text-align: center;">${avgConf}</td>
                    <td style="border: 1px solid #ddd; padding: 6px; text-align: center;">${f.processingTime ? (f.processingTime / 1000).toFixed(3) + 's' : '-'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
          
          ${files.some(f => f.defects && f.defects.length > 0) ? `
            <h2 style="font-size: 16px; margin: 20px 0 10px;">所有缺陷详情</h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 10px;">
              <thead>
                <tr style="background: #f5f5f5;">
                  <th style="border: 1px solid #ddd; padding: 5px;">文件</th>
                  <th style="border: 1px solid #ddd; padding: 5px;">类型</th>
                  <th style="border: 1px solid #ddd; padding: 5px;">置信度</th>
                  <th style="border: 1px solid #ddd; padding: 5px;">严重程度</th>
                  <th style="border: 1px solid #ddd; padding: 5px;">位置</th>
                  <th style="border: 1px solid #ddd; padding: 5px;">尺寸</th>
                </tr>
              </thead>
              <tbody>
                ${files.flatMap((f, fi) => 
                  (f.defects || []).map((d, di) => `
                    <tr>
                      <td style="border: 1px solid #ddd; padding: 5px;">${f.file.name}</td>
                      <td style="border: 1px solid #ddd; padding: 5px;">${d.type}</td>
                      <td style="border: 1px solid #ddd; padding: 5px;">${(d.confidence * 100).toFixed(1)}%</td>
                      <td style="border: 1px solid #ddd; padding: 5px;">${getSeverityLabel(d.severity)}</td>
                      <td style="border: 1px solid #ddd; padding: 5px;">(${d.x}, ${d.y})</td>
                      <td style="border: 1px solid #ddd; padding: 5px;">${d.width}×${d.height}</td>
                    </tr>
                  `)
                ).join('')}
              </tbody>
            </table>
          ` : ''}
          
          ${files.filter(f => f.status === 'completed').length > 0 ? `
            <h2 style="font-size: 16px; margin: 20px 0 10px;">检测图片展示</h2>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">
              ${files.filter(f => f.status === 'completed').map((f, idx) => `
                <div style="border: 1px solid #ddd; border-radius: 8px; padding: 10px; background: #fafafa;">
                  <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: bold; text-align: center;">${idx + 1}. ${f.file.name}</p>
                  <p style="margin: 0 0 8px 0; font-size: 10px; color: #666;">缺陷数: ${f.defectCount || 0} | ${f.processingTime ? (f.processingTime / 1000).toFixed(3) + 's' : '-'}</p>
                  <div style="text-align: center;">
                    <img src="${f.preview}" style="max-width: 100%; max-height: 200px; object-fit: contain; border: 1px solid #eee;" />
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;

      const container = document.createElement('div');
      container.innerHTML = htmlContent;
      container.style.cssText = 'position: fixed; left: -9999px; top: 0; background: white;';
      document.body.appendChild(container);

      await new Promise(resolve => setTimeout(resolve, 500));

      try {
        const { default: html2canvas } = await import('html2canvas');
        const { default: jsPDF } = await import('jspdf');

        const canvas = await html2canvas(container.firstElementChild as HTMLElement, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false
        });

        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = pageWidth;
        const imgHeight = (canvas.height * pageWidth) / canvas.width;

        if (imgHeight > pageHeight) {
          let position = 0;
          while (position < imgHeight) {
            pdf.addImage(imgData, 'PNG', 0, -position, imgWidth, imgHeight);
            position += pageHeight;
            if (position < imgHeight) pdf.addPage();
          }
        } else {
          pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
        }

        pdf.save(`${filename}.pdf`);
      } finally {
        document.body.removeChild(container);
      }
    }
  };

  // 批量检测导出报告功能
  const exportBatchReport = async (type: 'pdf' | 'json' | 'csv', file: BatchFile) => {
    if (!file) return;

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
    const filename = `批量检测_${file.file.name}_${timestamp}`;
    const avgConfidence = file.defects && file.defects.length > 0
      ? file.defects.reduce((acc, d) => acc + d.confidence, 0) / file.defects.length
      : 0;
    const riskInfo = getRiskLevel(file.defectCount || 0, avgConfidence);

    if (type === 'json') {
      const report = {
        reportId: `RPT-${Date.now()}`,
        generateTime: new Date().toISOString(),
        fileName: file.file.name,
        fileSize: formatSize(file.file.size),
        processingTime: file.processingTime ? (file.processingTime / 1000).toFixed(3) + 's' : '-',
        detectionSummary: {
          totalDefects: file.defectCount || 0,
          avgConfidence: avgConfidence,
          riskLevel: riskInfo.level,
          suggestion: riskInfo.suggestion,
        },
        defects: file.defects?.map((d, i) => ({
          id: i + 1,
          type: d.type,
          confidence: d.confidence,
          severity: d.severity,
          position: { x: d.x, y: d.y },
          size: { width: d.width, height: d.height },
        })) || [],
      };
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${filename}.json`; a.click();
      URL.revokeObjectURL(url);
    } else if (type === 'csv') {
      const header = 'ID,缺陷类型,置信度,严重程度,X坐标,Y坐标,宽度,高度\n';
      const rows = (file.defects || []).map((d, i) => 
        `${i + 1},${d.type},${(d.confidence * 100).toFixed(1)}%,${getSeverityLabel(d.severity)},${d.x},${d.y},${d.width},${d.height}`
      ).join('\n');
      const blob = new Blob([`\uFEFF${header}${rows}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${filename}.csv`; a.click();
      URL.revokeObjectURL(url);
    } else if (type === 'pdf') {
      const htmlContent = `
        <div style="width: 794px; padding: 40px; font-family: 'Microsoft YaHei', 'SimHei', 'Arial', sans-serif; background: white; color: #333;">
          <h1 style="text-align: center; font-size: 24px; margin-bottom: 30px; color: #333;">批量检测单图分析报告</h1>
          
          <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
            <p style="margin: 5px 0;"><strong>报告编号:</strong> RPT-${Date.now()}</p>
            <p style="margin: 5px 0;"><strong>生成时间:</strong> ${new Date().toLocaleString('zh-CN')}</p>
            <p style="margin: 5px 0;"><strong>文件名:</strong> ${file.file.name}</p>
            <p style="margin: 5px 0;"><strong>文件大小:</strong> ${formatSize(file.file.size)}</p>
            <p style="margin: 5px 0;"><strong>处理时间:</strong> ${file.processingTime ? (file.processingTime / 1000).toFixed(3) + 's' : '-'}</p>
          </div>
          
          <h2 style="font-size: 18px; margin: 20px 0 10px; color: #333;">检测图片</h2>
          <div style="text-align: center; margin-bottom: 20px;">
            <img src="${file.preview}" style="max-width: 100%; max-height: 300px; object-fit: contain; border: 1px solid #ddd;" />
          </div>
          
          <h2 style="font-size: 18px; margin: 20px 0 10px; color: #333;">检测摘要</h2>
          <div style="display: flex; gap: 15px; margin-bottom: 20px;">
            <div style="flex: 1; background: #fff3e0; padding: 15px; border-radius: 8px; border-left: 4px solid #ff9800;">
              <p style="margin: 5px 0;"><strong>缺陷总数:</strong> ${file.defectCount || 0}</p>
              <p style="margin: 5px 0;"><strong>平均置信度:</strong> ${(avgConfidence * 100).toFixed(1)}%</p>
            </div>
            <div style="flex: 1; background: ${(file.defectCount || 0) > 0 ? '#ffebee' : '#e8f5e9'}; padding: 15px; border-radius: 8px; border-left: 4px solid ${(file.defectCount || 0) > 0 ? '#f44336' : '#4caf50'};">
              <p style="margin: 5px 0;"><strong>风险等级:</strong> ${riskInfo.level}</p>
              <p style="margin: 5px 0;"><strong>处理建议:</strong> ${riskInfo.suggestion}</p>
            </div>
          </div>
          
          <h2 style="font-size: 18px; margin: 20px 0 10px; color: #333;">缺陷详情</h2>
          ${!file.defects || file.defects.length === 0 ? `
            <p style="padding: 20px; text-align: center; color: #666;">未检测到缺陷</p>
          ` : `
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
              <thead>
                <tr style="background: #f5f5f5;">
                  <th style="border: 1px solid #ddd; padding: 8px;">ID</th>
                  <th style="border: 1px solid #ddd; padding: 8px;">缺陷类型</th>
                  <th style="border: 1px solid #ddd; padding: 8px;">置信度</th>
                  <th style="border: 1px solid #ddd; padding: 8px;">严重程度</th>
                  <th style="border: 1px solid #ddd; padding: 8px;">位置</th>
                  <th style="border: 1px solid #ddd; padding: 8px;">尺寸</th>
                </tr>
              </thead>
              <tbody>
                ${file.defects.map((d, i) => `
                  <tr style="background: ${i % 2 === 0 ? '#fff' : '#fafafa'};">
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${i + 1}</td>
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${d.type}</td>
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${(d.confidence * 100).toFixed(1)}%</td>
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${getSeverityLabel(d.severity)}</td>
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">(${d.x}, ${d.y})</td>
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${d.width}×${d.height}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>
      `;

      const container = document.createElement('div');
      container.innerHTML = htmlContent;
      container.style.cssText = 'position: fixed; left: -9999px; top: 0; background: white;';
      document.body.appendChild(container);

      await new Promise(resolve => setTimeout(resolve, 500));

      try {
        const { default: html2canvas } = await import('html2canvas');
        const { default: jsPDF } = await import('jspdf');

        const canvas = await html2canvas(container.firstElementChild as HTMLElement, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false
        });

        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = pageWidth;
        const imgHeight = (canvas.height * pageWidth) / canvas.width;

        if (imgHeight > pageHeight) {
          let position = 0;
          while (position < imgHeight) {
            pdf.addImage(imgData, 'PNG', 0, -position, imgWidth, imgHeight);
            position += pageHeight;
            if (position < imgHeight) {
              pdf.addPage();
            }
          }
        } else {
          pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
        }

        pdf.save(`${filename}.pdf`);
      } finally {
        document.body.removeChild(container);
      }
    }
  };

  const stats = useMemo(() => {
    const total = files.length;
    const completed = files.filter(f => f.status === 'completed').length;
    const defectFiles = files.filter(f => f.defectCount && f.defectCount > 0).length;
    const totalDefects = files.reduce((sum, f) => sum + (f.defectCount || 0), 0);
    const successRate = total > 0 ? ((total - defectFiles) / total * 100).toFixed(1) : '0';
    const avgDefects = completed > 0 ? (totalDefects / completed).toFixed(2) : '0';
    const totalTime = files.reduce((sum, f) => sum + (f.processingTime || 0), 0);
    const totalSize = files.reduce((sum, f) => sum + f.file.size, 0);
    
    return { total, completed, defectFiles, totalDefects, successRate, avgDefects, totalTime, totalSize };
  }, [files]);

  const defectTypeData = useMemo(() => {
    const counts: Record<string, number> = {};
    files.forEach(f => {
      f.defects?.forEach(d => {
        const label = DEFECT_TYPES_MAP[d.type]?.label || d.type;
        counts[label] = (counts[label] || 0) + 1;
      });
    });
    
    // 使用实际检测到的缺陷类型，如果没有则使用支持的缺陷类型
    const defectTypes = Object.keys(counts).length > 0 
      ? Object.entries(counts) 
      : supportedDefectTypes.map(type => [type.label, 0]);
    
    return defectTypes.map(([name, value], idx) => ({
      name,
      value: value as number,
      color: COLORS[idx % COLORS.length]
    }));
  }, [files, supportedDefectTypes]);

  const successRateData = [
    { name: '合格', value: stats.total - stats.defectFiles, color: '#10b981' },
    { name: '缺陷', value: stats.defectFiles, color: '#ef4444' }
  ];

  const progress = stats.total > 0 ? (stats.completed / stats.total * 100) : 0;

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    return minutes > 0 ? `${minutes}分${seconds % 60}秒` : `${seconds}秒`;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
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

  const selectedFileDefectDistribution = useMemo(() => {
    if (!selectedFile || !selectedFile.defects) return [];
    const distribution: Record<string, number> = {};
    selectedFile.defects.forEach(d => {
      const label = DEFECT_TYPES_MAP[d.type]?.label || d.type;
      distribution[label] = (distribution[label] || 0) + 1;
    });
    return Object.entries(distribution).map(([name, count]) => ({
      name,
      value: count,
      color: DEFECT_TYPES_MAP[Object.keys(DEFECT_TYPES_MAP).find(k => DEFECT_TYPES_MAP[k].label === name) || 'other']?.color || '#6b7280'
    }));
  }, [selectedFile]);

  const selectedFileAvgConfidence = selectedFile && selectedFile.defects && selectedFile.defects.length > 0
    ? selectedFile.defects.reduce((acc, d) => acc + d.confidence, 0) / selectedFile.defects.length
    : 0;

  const selectedFileRiskInfo = selectedFile 
    ? getRiskLevel(selectedFile.defectCount || 0, selectedFileAvgConfidence)
    : { level: '-', color: 'text-[var(--text-muted)]', suggestion: '-' };

  return (
    <div className="space-y-4 p-4 overflow-y-auto" style={{ height: 'calc(100vh - 56px)' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">批量检测</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">同时处理多张图像，提高检测效率</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-card)] rounded-lg border border-[var(--border-color)]">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-[var(--text-secondary)]">系统运行正常</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Left Panel - File Management */}
        <div className="col-span-3 space-y-3">
          {/* File Upload */}
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4">
            <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <Upload size={16} className="text-orange-500" />
              文件上传
            </h3>
            <div
              className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                isDragging ? 'border-orange-500 bg-orange-500/5' : 'border-[var(--border-color)] hover:border-[var(--border-color)]/80'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileInput}
                className="hidden"
              />
              <Package size={28} className="mx-auto text-[var(--text-muted)] mb-2" />
              <p className="text-xs text-[var(--text-secondary)]">拖拽或点击上传</p>
              <p className="text-xs text-[var(--text-muted)]/70 mt-1">最多50个文件</p>
            </div>

            {files.length > 0 && (
              <div className="mt-3 pt-3 border-t border-[var(--border-color)]">
                <div className="flex justify-between text-xs text-[var(--text-muted)]">
                  <span>文件: <b className="text-[var(--text-primary)]">{files.length}</b></span>
                  <span>大小: <b className="text-[var(--text-primary)]">{formatSize(stats.totalSize)}</b></span>
                </div>
              </div>
            )}

            {files.length > 0 && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={simulateBatchDetection}
                  disabled={isProcessing || files.every(f => f.status === 'completed')}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-orange-500 text-white text-xs rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Play size={14} />
                  开始检测
                </button>
                <button
                  onClick={clearAllFiles}
                  disabled={isProcessing}
                  className="flex items-center justify-center gap-1 px-3 py-2 border border-[var(--border-color)] text-[var(--text-secondary)] text-xs rounded-lg hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  清空
                </button>
              </div>
            )}
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4 max-h-56 overflow-y-auto">
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
                <FileImage size={16} className="text-[var(--text-muted)]" />
                文件列表 ({files.length})
              </h3>
              <div className="space-y-2">
                {files.map(file => (
                  <div key={file.id} className="flex items-center gap-2 p-2 bg-[var(--bg-tertiary)]/50 rounded-lg">
                    <img src={file.preview} alt="" className="w-8 h-8 rounded object-cover" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[var(--text-primary)] truncate">{file.file.name}</p>
                      <p className="text-xs text-[var(--text-muted)]">{formatSize(file.file.size)}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {getStatusIcon(file.status)}
                      {!isProcessing && (
                        <button
                          onClick={() => removeFile(file.id)}
                          className="p-1 hover:bg-red-500/20 rounded text-[var(--text-muted)] hover:text-red-400"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Batch Settings */}
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4">
            <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <Settings size={16} className="text-[var(--text-muted)]" />
              批量设置
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--text-muted)] block mb-1">并行线程数</label>
                <div className="flex gap-1">
                  {[1, 2, 4, 8].map(n => (
                    <button
                      key={n}
                      onClick={() => setSettings(s => ({ ...s, threads: n }))}
                      className={`flex-1 py-1 text-xs rounded ${
                        settings.threads === n
                          ? 'bg-orange-500 text-white'
                          : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/80'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)] block mb-1">处理优先级</label>
                <select
                  value={settings.priority}
                  onChange={e => setSettings(s => ({ ...s, priority: e.target.value as any }))}
                  className="w-full px-2 py-1.5 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 text-[var(--text-primary)]"
                >
                  <option value="low">低</option>
                  <option value="normal">正常</option>
                  <option value="high">高</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)] block mb-1">输出格式</label>
                <select
                  value={settings.outputFormat}
                  onChange={e => setSettings(s => ({ ...s, outputFormat: e.target.value as any }))}
                  className="w-full px-2 py-1.5 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 text-[var(--text-primary)]"
                >
                  <option value="image">图像文件</option>
                  <option value="zip">ZIP压缩包</option>
                  <option value="pdf">PDF报告</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Center Panel - Progress */}
        <div className="col-span-5 space-y-3">
          {files.length > 0 && (
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-3">
                <p className="text-xs text-[var(--text-muted)]">总文件数</p>
                <p className="text-xl font-bold text-[var(--text-primary)]">{stats.total}</p>
              </div>
              <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-3">
                <p className="text-xs text-[var(--text-muted)]">已处理</p>
                <p className="text-xl font-bold text-orange-400">{stats.completed}</p>
              </div>
              <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-3">
                <p className="text-xs text-[var(--text-muted)]">缺陷文件</p>
                <p className="text-xl font-bold text-red-400">{stats.defectFiles}</p>
              </div>
              <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-3">
                <p className="text-xs text-[var(--text-muted)]">预计剩余</p>
                <p className="text-xl font-bold text-[var(--text-primary)]">
                  {isProcessing ? formatTime((stats.total - stats.completed) * 1500) : '-'}
                </p>
              </div>
            </div>
          )}

          {files.length > 0 && (
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-[var(--text-primary)]">处理进度</span>
                <span className="text-sm text-[var(--text-secondary)]">{progress.toFixed(0)}%</span>
              </div>
              <div className="h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-orange-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>

              {isProcessing && (
                <div className="flex gap-2 mt-3">
                  {isPaused ? (
                    <button
                      onClick={resumeProcessing}
                      className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 text-white text-xs rounded-lg hover:bg-emerald-600"
                    >
                      <Play size={14} />
                      继续
                    </button>
                  ) : (
                    <button
                      onClick={pauseProcessing}
                      className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white text-xs rounded-lg hover:bg-amber-600"
                    >
                      <Pause size={14} />
                      暂停
                    </button>
                  )}
                  <button
                    onClick={cancelProcessing}
                    className="flex items-center gap-1 px-3 py-1.5 bg-red-500 text-white text-xs rounded-lg hover:bg-red-600"
                  >
                    <X size={14} />
                    取消
                  </button>
                </div>
              )}

              {stats.completed === stats.total && stats.total > 0 && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => exportAllBatchReports('pdf')}
                    className="flex items-center gap-1 px-3 py-1.5 bg-orange-500 text-white text-xs rounded-lg hover:bg-orange-600"
                  >
                    <Download size={14} />
                    导出结果
                  </button>
                  <button
                    onClick={() => exportAllBatchReports('csv')}
                    className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 text-white text-xs rounded-lg hover:bg-emerald-600"
                  >
                    <FileText size={14} />
                    导出CSV
                  </button>
                </div>
              )}
            </div>
          )}

          {files.length > 0 && (
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border-color)]">
                <h3 className="text-sm font-medium text-[var(--text-primary)]">处理详情</h3>
              </div>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[var(--bg-tertiary)]/50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-[var(--text-muted)] font-medium">文件名</th>
                      <th className="px-3 py-2 text-left text-[var(--text-muted)] font-medium">状态</th>
                      <th className="px-3 py-2 text-left text-[var(--text-muted)] font-medium">缺陷数</th>
                      <th className="px-3 py-2 text-left text-[var(--text-muted)] font-medium">处理时间</th>
                      <th className="px-3 py-2 text-left text-[var(--text-muted)] font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-color)]">
                    {files.map(file => (
                      <tr key={file.id} className="hover:bg-[var(--bg-tertiary)]/30">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <img src={file.preview} alt="" className="w-6 h-6 rounded object-cover" />
                            <span className="truncate max-w-24 text-[var(--text-primary)]" title={file.file.name}>{file.file.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${getStatusClass(file.status)}`}>
                            {getStatusIcon(file.status)}
                            {getStatusText(file.status)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {file.defectCount !== undefined ? (
                            <span className={file.defectCount > 0 ? 'text-red-400 font-medium' : 'text-emerald-400'}>
                              {file.defectCount}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="px-3 py-2 text-[var(--text-muted)]">
                          {file.processingTime ? formatTime(file.processingTime) : '-'}
                        </td>
                        <td className="px-3 py-2">
                          {file.status === 'completed' && (
                            <button
                              onClick={() => {
                                setSelectedFile(file);
                                setZoom(1);
                                setActiveTab('visual');
                              }}
                              className="flex items-center gap-1 text-orange-400 hover:text-orange-300"
                            >
                              <Eye size={12} />
                              查看
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Statistics */}
        <div className="col-span-4 space-y-3">
          {stats.completed > 0 && (
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4">
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
                <PieChartIcon size={16} className="text-orange-500" />
                检测成功率
              </h3>
              <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={successRateData}
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={55}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {successRateData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="text-center p-2 bg-[var(--bg-tertiary)]/50 rounded-lg">
                  <p className="text-lg font-bold text-emerald-400">{stats.successRate}%</p>
                  <p className="text-xs text-[var(--text-muted)]">合格率</p>
                </div>
                <div className="text-center p-2 bg-[var(--bg-tertiary)]/50 rounded-lg">
                  <p className="text-lg font-bold text-orange-400">{stats.avgDefects}</p>
                  <p className="text-xs text-[var(--text-muted)]">平均缺陷数</p>
                </div>
              </div>
            </div>
          )}

          {defectTypeData.length > 0 && (
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4">
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
                <BarChart3 size={16} className="text-orange-500" />
                缺陷类型分布
              </h3>
              <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={defectTypeData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border-color)" />
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" width={50} tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} axisLine={false} />
                    <RechartsTooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)' }} />
                    <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {stats.completed > 0 && (
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4">
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">统计信息</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--text-muted)]">总处理时间</span>
                  <span className="font-medium text-[var(--text-primary)]">{formatTime(stats.totalTime)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--text-muted)]">平均处理时间</span>
                  <span className="font-medium text-[var(--text-primary)]">
                    {stats.completed > 0 ? formatTime(stats.totalTime / stats.completed) : '-'}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--text-muted)]">总文件大小</span>
                  <span className="font-medium text-[var(--text-primary)]">{formatSize(stats.totalSize)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--text-muted)]">缺陷总数</span>
                  <span className="font-medium text-red-400">{stats.totalDefects}</span>
                </div>
              </div>
            </div>
          )}

          {stats.completed === stats.total && stats.total > 0 && (
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4">
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
                <FileText size={16} className="text-orange-500" />
                批量检测报告
              </h3>
              <div className="space-y-3">
                <div className="p-3 bg-[var(--bg-tertiary)]/50 rounded-lg">
                  <p className="text-xs font-medium text-[var(--text-primary)] mb-1">检测概况</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    本次共检测 {stats.total} 个文件，发现 {stats.defectFiles} 个文件存在缺陷，
                    合格率为 {stats.successRate}%。
                  </p>
                </div>
                <div className="p-3 bg-[var(--bg-tertiary)]/50 rounded-lg">
                  <p className="text-xs font-medium text-[var(--text-primary)] mb-1">质量评估</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {parseFloat(stats.successRate) >= 90
                      ? '整体质量良好，缺陷检出率较低。'
                      : parseFloat(stats.successRate) >= 70
                        ? '整体质量一般，建议关注缺陷分布情况。'
                        : '整体质量较差，建议加强质量控制。'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => exportAllBatchReports('csv')} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 border border-[var(--border-color)] text-[var(--text-secondary)] text-xs rounded-lg hover:bg-[var(--bg-tertiary)]">
                    <FileDown size={14} />
                    导出CSV
                  </button>
                  <button onClick={() => exportAllBatchReports('json')} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 border border-[var(--border-color)] text-[var(--text-secondary)] text-xs rounded-lg hover:bg-[var(--bg-tertiary)]">
                    <Save size={14} />
                    导出JSON
                  </button>
                  <button onClick={() => exportAllBatchReports('pdf')} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-orange-500 text-white text-xs rounded-lg hover:bg-orange-600">
                    <FileDown size={14} />
                    生成PDF
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedFile && (
          <motion.div
            key="batch-detail-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
            onClick={() => setSelectedFile(null)}
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
                  <h3 className="text-base font-medium text-[var(--text-primary)]">{selectedFile.file.name}</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    检测时间: {formatDateTime(selectedFile.detectionTime)}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedFile(null)}
                  className="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-secondary)]"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Content */}
              <div className="p-4 overflow-y-auto max-h-[calc(90vh-80px)]">
                <div className="grid grid-cols-12 gap-4">
                  {/* Left Panel */}
                  <div className="col-span-3 space-y-3">
                    <div className="bg-[var(--bg-tertiary)]/50 rounded-xl p-4">
                      <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
                        <Settings size={16} />
                        检测信息
                      </h4>
                      <div className="space-y-3">
                        <div>
                          <div className="text-xs text-[var(--text-muted)] mb-1">文件大小</div>
                          <div className="text-sm font-mono text-[var(--text-primary)]">{formatSize(selectedFile.file.size)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-[var(--text-muted)] mb-1">处理时间</div>
                          <div className="text-sm font-mono text-[var(--text-primary)]">
                            {selectedFile.processingTime ? formatTime(selectedFile.processingTime) : '-'}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-[var(--text-muted)] mb-1">缺陷数量</div>
                          <div className="text-sm font-mono text-[var(--text-primary)]">{selectedFile.defectCount || 0}</div>
                        </div>
                        <div>
                          <div className="text-xs text-[var(--text-muted)] mb-1">平均置信度</div>
                          <div className="text-sm font-mono text-[var(--text-primary)]">
                            {(selectedFileAvgConfidence * 100).toFixed(1)}%
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-[var(--text-muted)] mb-1">风险等级</div>
                          <div className={`text-sm font-medium ${selectedFileRiskInfo.color}`}>
                            {selectedFileRiskInfo.level}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Original Image */}
                    <div className="bg-[var(--bg-tertiary)]/50 rounded-xl p-4">
                      <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
                        <FileImage size={16} />
                        原始图像
                      </h4>
                      <img
                        src={selectedFile.preview}
                        alt="原始"
                        className="w-full h-28 object-contain bg-[var(--bg-card)] rounded-lg"
                      />
                    </div>

                    {/* Zoom Control */}
                    <div className="bg-[var(--bg-tertiary)]/50 rounded-xl p-4">
                      <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">图像缩放</h4>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
                          className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-secondary)]"
                        >
                          <ZoomOut size={16} />
                        </button>
                        <span className="text-sm text-[var(--text-secondary)] flex-1 text-center">{Math.round(zoom * 100)}%</span>
                        <button
                          onClick={() => setZoom(z => Math.min(2, z + 0.25))}
                          className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-secondary)]"
                        >
                          <ZoomIn size={16} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Center Panel */}
                  <div className="col-span-6">
                    {/* Tab Switch */}
                    <div className="bg-[var(--bg-tertiary)]/50 rounded-xl p-1 mb-4">
                      <div className="flex gap-1">
                        {[
                          { key: 'visual', label: '可视化结果', icon: Eye },
                          { key: 'data', label: '详细数据与报告', icon: FileText }
                        ].map((tab) => (
                          <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key as typeof activeTab)}
                            className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                              activeTab === tab.key ? 'bg-orange-500 text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                            }`}
                          >
                            <tab.icon size={14} />
                            {tab.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Tab Content */}
                    <div className="bg-[var(--bg-tertiary)]/30 rounded-xl border border-[var(--border-color)] overflow-hidden min-h-[360px]">
                      {activeTab === 'visual' && (
                        <div className="p-4">
                          <div className="flex items-center justify-between mb-4">
                            <span className="text-sm font-medium text-[var(--text-primary)]">检测结果图像</span>
                            <div className="flex items-center gap-2">
                              <button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-secondary)]"><ZoomOut size={16} /></button>
                              <span className="text-xs text-[var(--text-muted)] w-12 text-center">{Math.round(zoom * 100)}%</span>
                              <button onClick={() => setZoom(z => Math.min(2, z + 0.25))} className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-secondary)]"><ZoomIn size={16} /></button>
                            </div>
                          </div>
                          <div className="relative bg-[var(--bg-tertiary)]/50 rounded-lg overflow-hidden flex items-center justify-center min-h-[280px]">
                            <img
                              src={selectedFile.preview}
                              alt="Result"
                              className="w-full h-full object-contain"
                              style={{ transform: `scale(${zoom})` }}
                            />
                          </div>
                        </div>
                      )}

                      {activeTab === 'data' && (
                        <div className="p-4 space-y-3">
                          {/* 导出按钮 */}
                          <div className="flex items-center justify-end gap-2 mb-2">
                            <button onClick={() => exportBatchReport('csv', selectedFile)} className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded-lg hover:bg-[var(--bg-tertiary)]/80 text-xs">
                              <FileText size={14} />导出CSV
                            </button>
                            <button onClick={() => exportBatchReport('json', selectedFile)} className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded-lg hover:bg-[var(--bg-tertiary)]/80 text-xs">
                              <FileText size={14} />导出JSON
                            </button>
                            <button onClick={() => exportBatchReport('pdf', selectedFile)} className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/20 text-orange-500 rounded-lg hover:bg-orange-500/30 text-xs">
                              <FileText size={14} />导出PDF
                            </button>
                          </div>

                          {/* Report Cards */}
                          <div className="grid grid-cols-4 gap-3">
                            <div className="bg-[var(--bg-tertiary)]/50 rounded-lg p-3">
                              <div className="text-xs text-[var(--text-muted)] mb-1">缺陷数量</div>
                              <div className="text-xl font-bold text-[var(--text-primary)]">{selectedFile.defectCount || 0}</div>
                            </div>
                            <div className="bg-[var(--bg-tertiary)]/50 rounded-lg p-3">
                              <div className="text-xs text-[var(--text-muted)] mb-1">平均置信度</div>
                              <div className="text-xl font-bold text-orange-400">{(selectedFileAvgConfidence * 100).toFixed(1)}%</div>
                            </div>
                            <div className="bg-[var(--bg-tertiary)]/50 rounded-lg p-3">
                              <div className="text-xs text-[var(--text-muted)] mb-1">风险等级</div>
                              <div className={`text-xl font-bold ${selectedFileRiskInfo.color}`}>{selectedFileRiskInfo.level}</div>
                            </div>
                            <div className="bg-[var(--bg-tertiary)]/50 rounded-lg p-3">
                              <div className="text-xs text-[var(--text-muted)] mb-1">处理时间</div>
                              <div className="text-xl font-bold text-[var(--text-primary)]">
                                {selectedFile.processingTime ? (selectedFile.processingTime / 1000).toFixed(3) : '-'}s
                              </div>
                            </div>
                          </div>

                          <div className="bg-[var(--bg-tertiary)]/50 rounded-lg p-3">
                            <div className="text-xs text-[var(--text-muted)] mb-2">处理建议</div>
                            <div className="text-sm text-[var(--text-primary)]">{selectedFileRiskInfo.suggestion}</div>
                          </div>

                          {/* Detail Table */}
                          {!selectedFile.defects || selectedFile.defects.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-8">
                              <CheckCircle size={40} className="text-emerald-500 mb-3" />
                              <p className="text-[var(--text-muted)] text-sm">未检测到缺陷</p>
                            </div>
                          ) : (
                            <div className="bg-[var(--bg-tertiary)]/30 rounded-lg border border-[var(--border-color)] overflow-hidden">
                              <table className="w-full">
                                <thead className="bg-[var(--bg-tertiary)]/50">
                                  <tr>
                                    <th className="text-left py-2 px-3 text-xs font-medium text-[var(--text-muted)]">ID</th>
                                    <th className="text-left py-2 px-3 text-xs font-medium text-[var(--text-muted)]">缺陷类型</th>
                                    <th className="text-left py-2 px-3 text-xs font-medium text-[var(--text-muted)]">置信度</th>
                                    <th className="text-left py-2 px-3 text-xs font-medium text-[var(--text-muted)]">严重程度</th>
                                    <th className="text-left py-2 px-3 text-xs font-medium text-[var(--text-muted)]">位置</th>
                                    <th className="text-left py-2 px-3 text-xs font-medium text-[var(--text-muted)]">尺寸</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {selectedFile.defects.map((defect, index) => (
                                    <tr key={defect.id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-tertiary)]/30 last:border-0">
                                      <td className="py-2 px-3 text-sm text-[var(--text-primary)]">{index + 1}</td>
                                      <td className="py-2 px-3">
                                        <span className="flex items-center gap-2">
                                          <span
                                            className="w-2 h-2 rounded-full"
                                            style={{ backgroundColor: DEFECT_TYPES_MAP[defect.type]?.color }}
                                          />
                                          <span className="text-sm text-[var(--text-primary)]">{DEFECT_TYPES_MAP[defect.type]?.label}</span>
                                        </span>
                                      </td>
                                      <td className="py-2 px-3 text-sm font-mono text-[var(--text-primary)]">{(defect.confidence * 100).toFixed(1)}%</td>
                                      <td className="py-2 px-3">
                                        <span className={`inline-block px-2 py-0.5 rounded text-xs border ${getSeverityColor(defect.severity)}`}>
                                          {getSeverityLabel(defect.severity)}
                                        </span>
                                      </td>
                                      <td className="py-2 px-3 text-sm font-mono text-[var(--text-muted)]">{defect.x}, {defect.y}</td>
                                      <td className="py-2 px-3 text-sm font-mono text-[var(--text-muted)]">{defect.width}×{defect.height}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Panel */}
                  <div className="col-span-3 space-y-3">
                    <div className="bg-[var(--bg-tertiary)]/50 rounded-xl p-4">
                      <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
                        <Activity size={16} />
                        检测状态
                      </h4>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between py-2 border-b border-[var(--border-color)]">
                          <div className="flex items-center gap-2">
                            <Cpu size={16} className="text-[var(--text-muted)]" />
                            <span className="text-sm text-[var(--text-secondary)]">检测模型</span>
                          </div>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">已加载</span>
                        </div>
                        <div className="flex items-center justify-between py-2 border-b border-[var(--border-color)]">
                          <div className="flex items-center gap-2">
                            <Clock size={16} className="text-[var(--text-muted)]" />
                            <span className="text-sm text-[var(--text-secondary)]">检测时间</span>
                          </div>
                          <span className="text-xs text-[var(--text-primary)]">{formatDateTime(selectedFile.detectionTime).split(' ')[1] || '-'}</span>
                        </div>
                        <div className="flex items-center justify-between py-2">
                          <div className="flex items-center gap-2">
                            <Calendar size={16} className="text-[var(--text-muted)]" />
                            <span className="text-sm text-[var(--text-secondary)]">检测日期</span>
                          </div>
                          <span className="text-xs text-[var(--text-primary)]">{formatDateTime(selectedFile.detectionTime).split(' ')[0] || '-'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Defect Distribution */}
                    {selectedFileDefectDistribution.length > 0 && (
                      <div className="bg-[var(--bg-tertiary)]/50 rounded-xl p-4">
                        <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
                          <PieChartIcon size={16} />
                          缺陷分布
                        </h4>
                        <div className="h-32">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={selectedFileDefectDistribution}
                                cx="50%"
                                cy="50%"
                                innerRadius={25}
                                outerRadius={45}
                                paddingAngle={2}
                                dataKey="value"
                              >
                                {selectedFileDefectDistribution.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                              </Pie>
                              <RechartsTooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)' }} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="mt-2 space-y-1">
                          {selectedFileDefectDistribution.map((item) => (
                            <div key={item.name} className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                                <span className="text-[var(--text-secondary)]">{item.name}</span>
                              </div>
                              <span className="text-[var(--text-primary)] font-mono">{item.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Supported Types */}
                    <div className="bg-[var(--bg-tertiary)]/50 rounded-xl p-4">
                      <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">
                        支持的缺陷类型
                        <span className="ml-2 text-xs text-[var(--text-muted)]">
                          ({supportedDefectTypes.length > 0 ? supportedDefectTypes.length : DEFECT_TYPE_LIST.length}种)
                        </span>
                      </h4>
                      <div className="space-y-1.5">
                        {(supportedDefectTypes.length > 0 ? supportedDefectTypes : DEFECT_TYPE_LIST).map((type) => (
                          <div key={type.key} className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: type.color }} />
                            <span className="text-xs text-[var(--text-muted)]">{type.label}</span>
                          </div>
                        ))}
                      </div>
                      {supportedDefectTypes.length === 0 && (
                        <div className="mt-2 text-xs text-[var(--text-muted)] italic">
                          正在加载模型信息...
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default BatchDetectionPage;
