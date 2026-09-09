import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Scan, Eye, EyeOff, Loader2, Shield, User, Lock, Activity, CheckCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const success = await login(username, password);
      if (success) {
        navigate('/', { replace: true });
      } else {
        setError('用户名或密码错误');
      }
    } catch (err) {
      setError('登录失败，请稍后重试');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center p-4">
      <div className="w-full max-w-5xl grid lg:grid-cols-2 gap-0 bg-[var(--bg-card)] rounded-2xl shadow-2xl overflow-hidden border border-[var(--border-color)]">
        {/* Left Side - Branding */}
        <div className="hidden lg:flex flex-col bg-gradient-to-br from-[var(--bg-card)] via-[var(--bg-tertiary)] to-[var(--bg-card)] p-12 text-white relative overflow-hidden">
          <div className="absolute inset-0 opacity-20">
            <div className="absolute top-20 left-20 w-64 h-64 border border-orange-500/20 rounded-full"></div>
            <div className="absolute bottom-20 right-20 w-48 h-48 border border-orange-500/20 rounded-full"></div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 border border-orange-500/10 rounded-full"></div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="relative z-10 flex-1 flex flex-col"
          >
            <div className="flex items-center gap-3 mb-8">
              <div className="w-14 h-14 bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/30">
                <Scan size={32} className="text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[var(--text-primary)]">金属细管检测</h1>
                <p className="text-[var(--text-secondary)] text-sm">内壁缺陷检测系统</p>
              </div>
            </div>

            <div className="flex-1 flex flex-col justify-center">
              <h2 className="text-4xl font-bold mb-6 leading-tight text-[var(--text-primary)]">
                智能检测<br />
                <span className="text-orange-500">精准识别</span>
              </h2>
              <p className="text-[var(--text-secondary)] text-lg mb-8 leading-relaxed">
                基于YOLO深度学习框架的金属细管内壁缺陷检测系统，支持单张图片、批量图片、摄像头实时及视频文件等多种检测模式的自动识别与分析。
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[var(--bg-tertiary)]/50 backdrop-blur-sm rounded-xl p-4 border border-[var(--border-color)]">
                  <div className="text-3xl font-bold text-orange-500 mb-1">YOLO</div>
                  <div className="text-[var(--text-secondary)] text-sm">深度学习模型</div>
                </div>
                <div className="bg-[var(--bg-tertiary)]/50 backdrop-blur-sm rounded-xl p-4 border border-[var(--border-color)]">
                  <div className="text-3xl font-bold text-orange-500 mb-1">4种</div>
                  <div className="text-[var(--text-secondary)] text-sm">检测模式</div>
                </div>
              </div>

              <div className="mt-8 space-y-3">
                <div className="flex items-center gap-3 text-[var(--text-secondary)]">
                  <CheckCircle size={18} className="text-emerald-500" />
                  <span className="text-sm">实时缺陷检测与分类</span>
                </div>
                <div className="flex items-center gap-3 text-[var(--text-secondary)]">
                  <CheckCircle size={18} className="text-emerald-500" />
                  <span className="text-sm">批量图像处理支持</span>
                </div>
                <div className="flex items-center gap-3 text-[var(--text-secondary)]">
                  <CheckCircle size={18} className="text-emerald-500" />
                  <span className="text-sm">摄像头实时检测</span>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-8 border-t border-[var(--border-color)]">
              <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">
                <Shield size={16} />
                <span>安全认证 · 数据加密 · 权限管理</span>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Right Side - Login Form */}
        <div className="p-8 lg:p-12 flex flex-col bg-[var(--bg-card)]">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex-1 flex flex-col justify-center"
          >
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-2">欢迎回来</h2>
              <p className="text-[var(--text-muted)]">请登录您的账户以继续</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  用户名
                </label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={20} />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="请输入用户名"
                    className="w-full pl-12 pr-4 py-3 border border-[var(--border-color)] rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder-[var(--text-muted)]"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  密码
                </label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={20} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入密码"
                    className="w-full pl-12 pr-12 py-3 border border-[var(--border-color)] rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder-[var(--text-muted)]"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm flex items-center gap-2"
                >
                  <Activity size={16} />
                  <span>{error}</span>
                </motion.div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed shadow-lg shadow-orange-500/25 hover:shadow-xl hover:shadow-orange-500/30"
              >
                {isLoading ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    <span>登录中...</span>
                  </>
                ) : (
                  <span>登录</span>
                )}
              </button>
            </form>
          </motion.div>

          <div className="mt-8 pt-6 border-t border-[var(--border-color)] text-center text-sm text-[var(--text-muted)]">
            Metal Pipe Defect Detection System v1.0
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
