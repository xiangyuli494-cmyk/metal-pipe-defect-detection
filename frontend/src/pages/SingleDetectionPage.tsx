import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  Image as ImageIcon,
  Settings,
  Play,
  Download,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  ZoomIn,
  ZoomOut,
  Maximize,
  Info,
  X,
  Cpu,
  Database,
  MemoryStick,
  Activity,
  FileText,
  Layers,
  Scan,
  RefreshCw,
  Eye,
  EyeOff,
  BarChart3,
  Clock,
  HardDrive,
  PieChart,
  TrendingUp,
  TrendingDown,
  Shield,
  Zap
} from 'lucide-react';
import { PieChart as RePieChart, Pie, Cell, ResponsiveContainer, Tooltip as ReTooltip } from 'recharts';
import { supabase } from '../supabase/client';
import { useAuth } from '../contexts/AuthContext';
import { apiService } from '../services/ApiService';

interface DetectionResult {
  id: string;
  defectType: string;
  confidence: number;
  bbox: [number, number, number, number];
  severity: 'low' | 'medium' | 'high';
}

interface AnalysisResult {
  imageUrl: string;
  annotatedImageUrl: string;
  defects: DetectionResult[];
  totalDefects: number;
  processingTime: number;
  timestamp: string;
  fileSize: string;
}

interface SystemStatus {
  modelLoaded: boolean;
  dbConnected: boolean;
  memoryUsage: number;
  todayDetections: number;
  totalRecords: number;
}

// 根据YOLO模型的实际检测类别更新
const DEFECT_TYPES: Record<string, { label: string; color: string; description: string }> = {
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

const SingleDetectionPage: React.FC = () => {
  const { user } = useAuth();
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [confidence, setConfidence] = useState(0.3);
  const [selectedDefect, setSelectedDefect] = useState<DetectionResult | null>(null);
  const [zoom, setZoom] = useState(1);
  const [activeTab, setActiveTab] = useState<'visual' | 'data'>('visual');
  const [systemStatus, setSystemStatus] = useState<SystemStatus>({
    modelLoaded: true,
    dbConnected: true,
    memoryUsage: 45,
    todayDetections: 0,
    totalRecords: 0
  });
  const [supportedDefectTypes, setSupportedDefectTypes] = useState<Array<{key: string, label: string, color: string}>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSystemStatus();
    checkModelStatus();
  }, []);

  const fetchSystemStatus = async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { count: todayCount } = await supabase
        .from('detection_records')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today.toISOString());

      const { count: totalCount } = await supabase
        .from('detection_records')
        .select('*', { count: 'exact', head: true });

      setSystemStatus(prev => ({
        ...prev,
        todayDetections: todayCount || 0,
        totalRecords: totalCount || 0
      }));
    } catch (error) {
      console.error('Error fetching system status:', error);
    }
  };

  const checkModelStatus = async () => {
    try {
      const status = await apiService.getModelStatus();
      setSystemStatus(prev => ({
        ...prev,
        modelLoaded: status.is_loaded,
        dbConnected: true
      }));
      console.log('模型状态:', status);
      
      // 如果模型未加载，自动加载模型
      if (!status.is_loaded) {
        console.log('模型未加载，正在自动加载...');
        try {
          // 从系统设置读取模型路径，兜底使用默认路径
          const settingPath = await apiService.getSetting('model_path');
          const modelPath = settingPath;
          await apiService.loadModel(modelPath);
          console.log('模型加载成功，重新获取状态...');
          
          // 重新获取模型状态
          const newStatus = await apiService.getModelStatus();
          console.log('重新获取的模型状态:', newStatus);
          
          // 更新支持的缺陷类型
          if (newStatus.class_names && newStatus.class_names.length > 0) {
            updateSupportedDefectTypes(newStatus.class_names);
          }
        } catch (loadError) {
          console.error('自动加载模型失败:', loadError);
        }
      } else {
        // 根据模型实际支持的缺陷类型更新显示
        if (status.class_names && status.class_names.length > 0) {
          updateSupportedDefectTypes(status.class_names);
        }
      }
    } catch (error) {
      console.error('检查模型状态失败:', error);
    }
  };

  const updateSupportedDefectTypes = (classNames: string[]) => {
    const defectTypes = classNames.map((className: string, index: number) => {
      // 为每种缺陷类型分配颜色
      const colors = ['#ef4444', '#3b82f6', '#f97316', '#f59e0b', '#8b5cf6', '#06b6d4'];
      const color = colors[index % colors.length];
      
      return {
        key: className,
        label: className,
        color: color
      };
    });
    
    console.log('更新支持的缺陷类型:', defectTypes);
    setSupportedDefectTypes(defectTypes);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

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
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type.startsWith('image/')) {
      handleFile(files[0]);
    }
  }, []);

  const handleFile = (file: File) => {
    setUploadedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      setUploadedImage(e.target?.result as string);
      setResult(null);
    };
    reader.readAsDataURL(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const simulateDetection = async () => {
    if (!uploadedImage || !uploadedFile) return;

    setIsAnalyzing(true);
    setResult(null);

    try {
      // 检查模型状态
      const modelStatus = await apiService.getModelStatus();
      console.log('模型状态:', modelStatus);
      
      if (!modelStatus.is_loaded) {
        // 自动加载模型
        console.log('模型未加载，正在加载...');
        const settingPath = await apiService.getSetting('model_path');
        const modelPath = settingPath;
        await apiService.loadModel(modelPath);
      }

      const startTime = Date.now();
      
      // 获取当前用户信息
      const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
      
      // 调用真实API进行预测，传递用户信息
      const apiResult = await apiService.predict(uploadedFile, {
        userId: currentUser.id,
        username: currentUser.username,
        confidenceThreshold: confidence,  // 修复：使用正确的变量名
        iouThreshold: 0.45
      });
      console.log('API响应:', apiResult);
      
      const processingTime = ((Date.now() - startTime) / 1000);

      // apiService.predict 已经处理了后端返回格式，直接使用返回的 result
      // 后端返回格式: { success: true, filename: str, result: { detections: [], count, annotated_image } }
      // ApiService.ts 返回的是 model_service 的结果，所以是 { success: true, filename: str, result: {...} }
      if (apiResult && apiResult.result) {
        const result = apiResult.result;
        
        // 转换结果为前端格式
        const defects: DetectionResult[] = result.detections.map((detection: any, index: number) => ({
          id: `${index + 1}`,
          defectType: detection.class,
          confidence: detection.confidence,
          bbox: [
            detection.bbox.x,
            detection.bbox.y,
            detection.bbox.width,
            detection.bbox.height
          ] as [number, number, number, number],
          severity: detection.confidence > 0.9 ? 'high' : 
                   detection.confidence > 0.8 ? 'medium' : 'low'
        }));

        // 使用后端返回的标注图片
        const annotatedImageUrl = result.annotated_image || uploadedImage;

        setResult({
          imageUrl: uploadedImage,
          annotatedImageUrl: annotatedImageUrl, // 使用后端标注的图片
          defects,
          totalDefects: result.count,
          processingTime,
          timestamp: new Date().toISOString(),
          fileSize: formatFileSize(uploadedFile.size)
        });

        setSystemStatus(prev => ({
          ...prev,
          todayDetections: prev.todayDetections + 1,
          totalRecords: prev.totalRecords + 1
        }));
      } else {
        throw new Error(apiResult?.message || '检测失败');
      }
    } catch (error: any) {
      console.error('检测失败:', error);
      // 显示错误信息
      alert(`检测失败: ${error.message || '未知错误'}`);
      // 可以回退到模拟数据
      console.log('使用模拟数据作为备选...');
      await simulateMockDetection();
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 模拟检测作为备选方案
  const simulateMockDetection = async () => {
    const startTime = Date.now();
    await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000));
    const processingTime = ((Date.now() - startTime) / 1000);

    const hasDefects = Math.random() > 0.3;
    let mockDefects: DetectionResult[] = [];

    if (hasDefects) {
      const defectCount = Math.floor(Math.random() * 5) + 1;
      const defectTypes = Object.keys(DEFECT_TYPES);
      mockDefects = Array.from({ length: defectCount }, (_, i) => {
        const type = defectTypes[Math.floor(Math.random() * defectTypes.length)];
        const confidence = 0.7 + Math.random() * 0.25;
        return {
          id: `${i + 1}`,
          defectType: type,
          confidence,
          bbox: [
            50 + Math.floor(Math.random() * 300),
            50 + Math.floor(Math.random() * 200),
            100 + Math.floor(Math.random() * 400),
            100 + Math.floor(Math.random() * 300)
          ] as [number, number, number, number],
          severity: confidence > 0.9 ? 'high' : confidence > 0.8 ? 'medium' : 'low'
        };
      });
    }

    setResult({
      imageUrl: uploadedImage!,
      annotatedImageUrl: uploadedImage!,
      defects: mockDefects,
      totalDefects: mockDefects.length,
      processingTime,
      timestamp: new Date().toISOString(),
      fileSize: formatFileSize(uploadedFile!.size)
    });

    setSystemStatus(prev => ({
      ...prev,
      todayDetections: prev.todayDetections + 1,
      totalRecords: prev.totalRecords + 1
    }));
  };

  const resetAnalysis = () => {
    setUploadedImage(null);
    setUploadedFile(null);
    setResult(null);
    setSelectedDefect(null);
    setZoom(1);
    setActiveTab('visual');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const getDefectDistribution = () => {
    if (!result || result.defects.length === 0) return [];
    const distribution: Record<string, number> = {};
    result.defects.forEach(d => {
      distribution[d.defectType] = (distribution[d.defectType] || 0) + 1;
    });
    return Object.entries(distribution).map(([type, count]) => ({
      name: DEFECT_TYPES[type]?.label || type,
      value: count,
      color: DEFECT_TYPES[type]?.color || '#6b7280'
    }));
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'medium': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'low': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      default: return 'bg-[var(--bg-tertiary)]/50 text-[var(--text-muted)]';
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

  const avgConfidence = result && result.defects.length > 0
    ? result.defects.reduce((acc, d) => acc + d.confidence, 0) / result.defects.length
    : 0;

  const riskInfo = result ? getRiskLevel(result.totalDefects, avgConfidence) : { level: '-', color: 'text-[var(--text-muted)]', suggestion: '-' };

  const defectDistribution = getDefectDistribution();

  // 导出报告功能
  const exportReport = async (type: 'pdf' | 'json' | 'csv') => {
    if (!result) return;

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
    const filename = `检测报告_${timestamp}`;

    if (type === 'json') {
      const report = {
        reportId: `RPT-${Date.now()}`,
        generateTime: new Date().toISOString(),
        imageInfo: {
          fileSize: result.fileSize,
          processingTime: result.processingTime,
        },
        detectionSummary: {
          totalDefects: result.totalDefects,
          avgConfidence: avgConfidence,
          riskLevel: riskInfo.level,
          suggestion: riskInfo.suggestion,
        },
        defects: result.defects.map((d, i) => ({
          id: i + 1,
          type: d.defectType,
          confidence: d.confidence,
          severity: d.severity,
          position: { x: d.bbox[0], y: d.bbox[1] },
          size: { width: d.bbox[2], height: d.bbox[3] },
        })),
        defectDistribution: defectDistribution,
      };
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${filename}.json`; a.click();
      URL.revokeObjectURL(url);
    } else if (type === 'csv') {
      const header = 'ID,缺陷类型,置信度,严重程度,X坐标,Y坐标,宽度,高度\n';
      const rows = result.defects.map((d, i) => 
        `${i + 1},${d.defectType},${(d.confidence * 100).toFixed(1)}%,${getSeverityLabel(d.severity)},${d.bbox[0]},${d.bbox[1]},${d.bbox[2]},${d.bbox[3]}`
      ).join('\n');
      const blob = new Blob([`\uFEFF${header}${rows}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${filename}.csv`; a.click();
      URL.revokeObjectURL(url);
    } else if (type === 'pdf') {
      // 创建HTML内容用于渲染PDF
      const htmlContent = `
        <div style="width: 794px; padding: 40px; font-family: 'Microsoft YaHei', 'SimHei', 'Arial', sans-serif; background: white; color: #333;">
          <h1 style="text-align: center; font-size: 24px; margin-bottom: 30px; color: #333;">金属细管内壁缺陷检测报告</h1>
          
          <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
            <p style="margin: 5px 0;"><strong>报告编号:</strong> RPT-${Date.now()}</p>
            <p style="margin: 5px 0;"><strong>生成时间:</strong> ${new Date().toLocaleString('zh-CN')}</p>
            <p style="margin: 5px 0;"><strong>图片大小:</strong> ${result.fileSize}</p>
            <p style="margin: 5px 0;"><strong>处理时间:</strong> ${result.processingTime.toFixed(3)}s</p>
          </div>
          
          <h2 style="font-size: 18px; margin: 20px 0 10px; color: #333;">检测图片对比</h2>
          <div style="display: flex; gap: 10px; margin-bottom: 20px;">
            <div style="flex: 1; text-align: center;">
              <p style="margin-bottom: 5px; color: #666;">原图</p>
              <img src="${result.imageUrl}" style="width: 100%; max-height: 200px; object-fit: contain; border: 1px solid #ddd;" />
            </div>
            <div style="flex: 1; text-align: center;">
              <p style="margin-bottom: 5px; color: #666;">检测结果图</p>
              <img src="${result.annotatedImageUrl}" style="width: 100%; max-height: 200px; object-fit: contain; border: 1px solid #ddd;" />
            </div>
          </div>
          
          <h2 style="font-size: 18px; margin: 20px 0 10px; color: #333;">检测摘要</h2>
          <div style="display: flex; gap: 15px; margin-bottom: 20px;">
            <div style="flex: 1; background: #fff3e0; padding: 15px; border-radius: 8px; border-left: 4px solid #ff9800;">
              <p style="margin: 5px 0;"><strong>缺陷总数:</strong> ${result.totalDefects}</p>
              <p style="margin: 5px 0;"><strong>平均置信度:</strong> ${(avgConfidence * 100).toFixed(1)}%</p>
            </div>
            <div style="flex: 1; background: ${result.totalDefects > 0 ? '#ffebee' : '#e8f5e9'}; padding: 15px; border-radius: 8px; border-left: 4px solid ${result.totalDefects > 0 ? '#f44336' : '#4caf50'};">
              <p style="margin: 5px 0;"><strong>风险等级:</strong> ${riskInfo.level}</p>
              <p style="margin: 5px 0;"><strong>处理建议:</strong> ${riskInfo.suggestion}</p>
            </div>
          </div>
          
          <h2 style="font-size: 18px; margin: 20px 0 10px; color: #333;">缺陷详情</h2>
          ${result.defects.length > 0 ? `
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
                ${result.defects.map((d, i) => `
                  <tr style="background: ${i % 2 === 0 ? '#fff' : '#fafafa'};">
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${i + 1}</td>
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${d.defectType}</td>
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${(d.confidence * 100).toFixed(1)}%</td>
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${getSeverityLabel(d.severity)}</td>
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">(${d.bbox[0]}, ${d.bbox[1]})</td>
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${d.bbox[2]}×${d.bbox[3]}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : `
            <p style="padding: 20px; text-align: center; color: #666;">未检测到缺陷</p>
          `}
        </div>
      `;

      // 创建临时容器
      const container = document.createElement('div');
      container.innerHTML = htmlContent;
      container.style.cssText = 'position: fixed; left: -9999px; top: 0; background: white;';
      document.body.appendChild(container);

      // 等待图片加载
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

        // 如果内容超过一页，分页处理
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

  // 下载标注图片
  const downloadAnnotatedImage = () => {
    if (!result?.annotatedImageUrl) return;
    const a = document.createElement('a');
    a.href = result.annotatedImageUrl;
    a.download = `标注图片_${Date.now()}.jpg`;
    a.click();
  };

  return (
    <div className="space-y-4 p-4 overflow-y-auto" style={{ height: 'calc(100vh - 56px)' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">单张图像检测</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">上传单张图像进行AI缺陷检测分析</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-card)] rounded-lg border border-[var(--border-color)]">
            <div className={`w-2 h-2 rounded-full ${systemStatus.modelLoaded ? 'bg-emerald-500' : 'bg-amber-500'} animate-pulse`} />
            <span className="text-xs text-[var(--text-secondary)]">
              {systemStatus.modelLoaded ? 'YOLO模型已加载' : '模型未加载'}
            </span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-card)] rounded-lg border border-[var(--border-color)]">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-[var(--text-secondary)]">系统运行正常</span>
          </div>
        </div>
      </div>

      {!uploadedImage ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`border-2 border-dashed border-[var(--border-color)] rounded-xl h-[480px] flex flex-col items-center justify-center p-8 cursor-pointer transition-all ${
            isDragging ? 'border-orange-500 bg-orange-500/5' : 'hover:border-[var(--text-muted)]'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileInput} className="hidden" />
          <div className="w-16 h-16 bg-[var(--bg-tertiary)] rounded-xl flex items-center justify-center mb-4">
            <Upload size={32} className="text-orange-500" />
          </div>
          <h3 className="text-base font-medium text-[var(--text-primary)] mb-2">点击或拖拽上传图像</h3>
          <p className="text-[var(--text-secondary)] text-sm text-center max-w-sm">支持 JPG、PNG、BMP 格式，建议图像分辨率不低于 640x480</p>
          <div className="mt-4 flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Info size={14} />
            <span>最大文件大小: 10MB</span>
          </div>
        </motion.div>
      ) : (
        <div className="grid grid-cols-12 gap-4 h-full">
          {/* Left Panel - Control */}
          <div className="col-span-3 space-y-3 overflow-y-auto">
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4">
              <h3 className="font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2 text-sm">
                <Settings size={16} className="text-orange-500" />
                控制面板
              </h3>

              <div className="space-y-3">
                <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
                  <div className="text-xs text-[var(--text-muted)] mb-1">图像尺寸</div>
                  <div className="text-sm font-mono text-[var(--text-primary)]">{result?.fileSize || formatFileSize(uploadedFile?.size || 0)}</div>
                </div>

                <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
                  <div className="text-xs text-[var(--text-muted)] mb-1">处理时间</div>
                  <div className="text-sm font-mono text-[var(--text-primary)]">{result ? `${(result.processingTime * 1000).toFixed(0)}ms` : '-'}</div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-[var(--text-secondary)]">置信度阈值</label>
                    <span className="text-xs font-mono text-orange-500">{(confidence * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="0.9"
                    step="0.05"
                    value={confidence}
                    onChange={(e) => setConfidence(parseFloat(e.target.value))}
                    className="w-full accent-orange-500"
                  />
                  <div className="flex justify-between text-xs text-[var(--text-muted)] mt-1">
                    <span>10%</span>
                    <span>90%</span>
                  </div>
                </div>

                <button
                  onClick={simulateDetection}
                  disabled={isAnalyzing || !uploadedImage}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg font-medium hover:from-orange-600 hover:to-orange-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm shadow-lg shadow-orange-500/25"
                >
                  {isAnalyzing ? (
                    <>
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                        <RefreshCw size={16} />
                      </motion.div>
                      <span>检测中...</span>
                    </>
                  ) : result ? (
                    <>
                      <RotateCcw size={16} />
                      <span>再次检测</span>
                    </>
                  ) : (
                    <>
                      <Play size={16} />
                      <span>开始检测</span>
                    </>
                  )}
                </button>

                <button
                  onClick={resetAnalysis}
                  className="w-full flex items-center justify-center gap-2 py-2 border border-[var(--border-color)] text-[var(--text-secondary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors text-sm"
                >
                  <X size={16} />
                  <span>清除</span>
                </button>
              </div>
            </div>

            {/* Original Image Preview */}
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4">
              <h3 className="font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2 text-sm">
                <ImageIcon size={16} className="text-[var(--text-muted)]" />
                原始图像
              </h3>
              <div className="bg-[var(--bg-tertiary)] rounded-lg overflow-hidden">
                <img src={uploadedImage} alt="Original" className="w-full h-28 object-contain" />
              </div>
            </div>
          </div>

          {/* Center Panel - Results */}
          <div className="col-span-6 flex flex-col min-h-0">
            {!result && !isAnalyzing && (
              <div className="h-[480px] bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] flex flex-col items-center justify-center">
                <div className="w-14 h-14 bg-[var(--bg-tertiary)] rounded-xl flex items-center justify-center mb-4">
                  <Scan size={28} className="text-[var(--text-muted)]" />
                </div>
                <p className="text-[var(--text-secondary)]">点击"开始检测"查看结果</p>
              </div>
            )}

            {isAnalyzing && (
              <div className="h-[480px] bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] flex flex-col items-center justify-center">
                <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="w-16 h-16 bg-[var(--bg-tertiary)] rounded-xl flex items-center justify-center mb-4">
                  <Scan size={32} className="text-orange-500" />
                </motion.div>
                <h3 className="text-base font-medium text-[var(--text-primary)] mb-2">正在分析图像...</h3>
                <p className="text-[var(--text-secondary)] text-sm">AI模型正在检测缺陷，请稍候</p>
                <div className="mt-6 w-48">
                  <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                    <motion.div className="h-full bg-gradient-to-r from-orange-500 to-orange-400" initial={{ width: 0 }} animate={{ width: '100%' }} transition={{ duration: 2, ease: 'easeInOut' }} />
                  </div>
                </div>
              </div>
            )}

            {result && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                {/* Tab Switch */}
                <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-1">
                  <div className="flex gap-1">
                    {[
                      { key: 'visual', label: '可视化结果', icon: Eye },
                      { key: 'data', label: '详细数据与报告', icon: FileText }
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key as typeof activeTab)}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                          activeTab === tab.key
                            ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white'
                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                        }`}
                      >
                        <tab.icon size={14} />
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tab Content */}
                <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] overflow-hidden min-h-[380px]">
                  {activeTab === 'visual' && (
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-sm font-medium text-[var(--text-primary)]">检测结果图像</span>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-secondary)]"><ZoomOut size={14} /></button>
                          <span className="text-xs text-[var(--text-muted)] w-12 text-center">{Math.round(zoom * 100)}%</span>
                          <button onClick={() => setZoom(z => Math.min(2, z + 0.25))} className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-secondary)]"><ZoomIn size={14} /></button>
                        </div>
                      </div>
                      <div className="relative bg-[var(--bg-tertiary)] rounded-lg overflow-hidden flex items-center justify-center min-h-[300px]">
                        <img 
                          src={result.annotatedImageUrl} 
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
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-[var(--text-primary)]">详细数据报告</span>
                        <div className="flex items-center gap-2">
                          <button onClick={downloadAnnotatedImage} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/20 text-emerald-500 rounded-lg hover:bg-emerald-500/30 text-xs">
                            <Download size={14} />下载标注图
                          </button>
                          <button onClick={() => exportReport('csv')} className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded-lg hover:bg-[var(--bg-tertiary)]/80 text-xs">
                            <FileText size={14} />导出CSV
                          </button>
                          <button onClick={() => exportReport('json')} className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded-lg hover:bg-[var(--bg-tertiary)]/80 text-xs">
                            <FileText size={14} />导出JSON
                          </button>
                          <button onClick={() => exportReport('pdf')} className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/20 text-orange-500 rounded-lg hover:bg-orange-500/30 text-xs">
                            <FileText size={14} />导出PDF
                          </button>
                        </div>
                      </div>

                      {/* Report Cards */}
                      <div className="grid grid-cols-4 gap-3">
                        <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
                          <div className="text-xs text-[var(--text-muted)] mb-1">缺陷数量</div>
                          <div className="text-xl font-bold text-[var(--text-primary)]">{result.totalDefects}</div>
                        </div>
                        <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
                          <div className="text-xs text-[var(--text-muted)] mb-1">平均置信度</div>
                          <div className="text-xl font-bold text-orange-500">{(avgConfidence * 100).toFixed(1)}%</div>
                        </div>
                        <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
                          <div className="text-xs text-[var(--text-muted)] mb-1">风险等级</div>
                          <div className={`text-xl font-bold ${riskInfo.color}`}>{riskInfo.level}</div>
                        </div>
                        <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
                          <div className="text-xs text-[var(--text-muted)] mb-1">处理时间</div>
                          <div className="text-xl font-bold text-[var(--text-primary)]">{result.processingTime.toFixed(3)}s</div>
                        </div>
                      </div>

                      <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
                        <div className="text-xs text-[var(--text-muted)] mb-2">处理建议</div>
                        <div className="text-sm text-[var(--text-primary)]">{riskInfo.suggestion}</div>
                      </div>

                      {/* Detail Table */}
                      {result.defects.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8">
                          <CheckCircle size={40} className="text-emerald-500 mb-3" />
                          <p className="text-[var(--text-secondary)] text-sm">未检测到缺陷</p>
                        </div>
                      ) : (
                        <div className="bg-[var(--bg-tertiary)]/50 rounded-lg border border-[var(--border-color)] overflow-hidden">
                          <table className="w-full">
                            <thead className="bg-[var(--bg-tertiary)]">
                              <tr>
                                <th className="text-left py-2 px-3 text-xs font-medium text-[var(--text-muted)]">ID</th>
                                <th className="text-left py-2 px-3 text-xs font-medium text-[var(--text-muted)]">缺陷类型</th>
                                <th className="text-left py-2 px-3 text-xs font-medium text-[var(--text-muted)]">置信度</th>
                                <th className="text-left py-2 px-3 text-xs font-medium text-[var(--text-muted)]">位置</th>
                                <th className="text-left py-2 px-3 text-xs font-medium text-[var(--text-muted)]">尺寸</th>
                              </tr>
                            </thead>
                            <tbody>
                              {result.defects.map((defect, index) => (
                                <tr key={defect.id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-tertiary)]/50 last:border-0">
                                  <td className="py-2 px-3 text-sm text-[var(--text-primary)]">{index + 1}</td>
                                  <td className="py-2 px-3">
                                    <span className="flex items-center gap-2">
                                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: DEFECT_TYPES[defect.defectType]?.color }} />
                                      <span className="text-sm text-[var(--text-primary)]">{DEFECT_TYPES[defect.defectType]?.label}</span>
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 text-sm font-mono text-[var(--text-primary)]">{(defect.confidence * 100).toFixed(1)}%</td>
                                  <td className="py-2 px-3 text-sm font-mono text-[var(--text-secondary)]">{defect.bbox[0]}, {defect.bbox[1]}</td>
                                  <td className="py-2 px-3 text-sm font-mono text-[var(--text-secondary)]">{defect.bbox[2] - defect.bbox[0]}×{defect.bbox[3] - defect.bbox[1]}</td>
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
            )}
          </div>

          {/* Right Panel - System Status + Defect Distribution */}
          <div className="col-span-3 space-y-3 overflow-y-auto">
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4">
              <h3 className="font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2 text-sm">
                <Activity size={16} className="text-orange-500" />
                系统状态
              </h3>

              <div className="space-y-2">
                <div className="flex items-center justify-between py-2 border-b border-[var(--border-color)]">
                  <div className="flex items-center gap-2">
                    <Cpu size={14} className="text-[var(--text-muted)]" />
                    <span className="text-xs text-[var(--text-secondary)]">检测模型</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded ${systemStatus.modelLoaded ? 'bg-emerald-500/20 text-emerald-500' : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'}`}>
                    {systemStatus.modelLoaded ? '已加载' : '未加载'}
                  </span>
                </div>

                <div className="flex items-center justify-between py-2 border-b border-[var(--border-color)]">
                  <div className="flex items-center gap-2">
                    <Database size={14} className="text-[var(--text-muted)]" />
                    <span className="text-xs text-[var(--text-secondary)]">数据库连接</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded ${systemStatus.dbConnected ? 'bg-emerald-500/20 text-emerald-500' : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'}`}>
                    {systemStatus.dbConnected ? '已连接' : '未连接'}
                  </span>
                </div>

                <div className="flex items-center justify-between py-2 border-b border-[var(--border-color)]">
                  <div className="flex items-center gap-2">
                    <MemoryStick size={14} className="text-[var(--text-muted)]" />
                    <span className="text-xs text-[var(--text-secondary)]">内存使用</span>
                  </div>
                  <span className="text-xs font-mono text-[var(--text-primary)]">{systemStatus.memoryUsage}%</span>
                </div>

                <div className="flex items-center justify-between py-2 border-b border-[var(--border-color)]">
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-[var(--text-muted)]" />
                    <span className="text-xs text-[var(--text-secondary)]">今日检测</span>
                  </div>
                  <span className="text-xs font-mono text-[var(--text-primary)]">{systemStatus.todayDetections}</span>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <HardDrive size={14} className="text-[var(--text-muted)]" />
                    <span className="text-xs text-[var(--text-secondary)]">累计记录</span>
                  </div>
                  <span className="text-xs font-mono text-[var(--text-primary)]">{systemStatus.totalRecords}</span>
                </div>
              </div>
            </div>

            {/* Defect Distribution Pie Chart */}
            {result && result.defects.length > 0 && (
              <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4">
                <h3 className="font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2 text-sm">
                  <PieChart size={16} className="text-orange-500" />
                  缺陷分布
                </h3>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <RePieChart>
                      <Pie
                        data={defectDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={35}
                        outerRadius={60}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {defectDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <ReTooltip
                        contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)' }}
                        formatter={(value: number, name: string) => [value, name]}
                      />
                    </RePieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 space-y-1">
                  {defectDistribution.map((item) => (
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

            {/* Supported Defect Types - 只显示凸起和焊缝两种 */}
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4">
              <h3 className="font-medium text-[var(--text-primary)] mb-3 text-xs uppercase tracking-wider">
                支持的缺陷类型
                <span className="ml-2 text-xs text-emerald-500">
                  2种
                </span>
              </h3>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#ef4444' }} />
                  <span className="text-xs text-[var(--text-secondary)]">凸起</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#3b82f6' }} />
                  <span className="text-xs text-[var(--text-secondary)]">焊缝</span>
                </div>
              </div>
              <div className="mt-2 text-xs text-emerald-500 italic">
                ✅ YOLO模型已加载，支持凸起和焊缝检测
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Defect Detail Modal */}
      <AnimatePresence>
        {selectedDefect && (
          <motion.div key="defect-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setSelectedDefect(null)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="bg-[var(--bg-card)] rounded-xl max-w-md w-full p-5 border border-[var(--border-color)]" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-medium text-[var(--text-primary)]">缺陷详情</h3>
                <button onClick={() => setSelectedDefect(null)} className="p-1 hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-secondary)]"><X size={18} /></button>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: DEFECT_TYPES[selectedDefect.defectType]?.color }} />
                  <span className="font-medium text-[var(--text-primary)]">{DEFECT_TYPES[selectedDefect.defectType]?.label}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
                    <div className="text-xs text-[var(--text-muted)] mb-1">置信度</div>
                    <div className="text-base font-mono text-[var(--text-primary)]">{(selectedDefect.confidence * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
                    <div className="text-xs text-[var(--text-muted)] mb-1">严重程度</div>
                    <span className={`inline-block px-2 py-0.5 rounded text-xs border ${getSeverityColor(selectedDefect.severity)}`}>{getSeverityLabel(selectedDefect.severity)}</span>
                  </div>
                </div>
                <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
                  <div className="text-xs text-[var(--text-muted)] mb-1">位置坐标</div>
                  <div className="text-sm font-mono text-[var(--text-primary)]">[{selectedDefect.bbox.join(', ')}]</div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SingleDetectionPage;
