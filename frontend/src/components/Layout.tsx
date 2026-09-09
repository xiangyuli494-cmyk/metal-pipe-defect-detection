import React, { useState, useEffect, useCallback } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Scan,
  Image,
  Camera,
  History,
  BarChart3,
  Users,
  Settings,
  UserCircle2,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Bell,
  Shield,
  Eye,
  Activity,
  Cpu,
  AlertCircle,
  Info,
  CheckCircle,
  AlertTriangle,
  Trash2,
  CheckCheck,
  FileVideo
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import apiService from '../services/ApiService';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  roles?: string[];
}

interface Notification {
  id: number;
  user_id: number | null;
  type: 'defect' | 'system' | 'info' | 'warning' | 'error';
  title: string;
  message: string;
  is_read: number;
  link: string | null;
  created_at: string;
}

const Layout: React.FC = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // 加载通知
  const loadNotifications = useCallback(async () => {
    try {
      const data = await apiService.getNotifications(20);
      const unread = data.filter((n: Notification) => !n.is_read).length;
      setNotifications(data);
      setUnreadCount(unread);
    } catch (error) {
      console.error('加载通知失败:', error);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    // 每30秒刷新一次
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  // 标记单条已读
  const handleMarkRead = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiService.markNotificationRead(id);
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, is_read: 1 } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('标记已读失败:', error);
    }
  };

  // 全部标为已读
  const handleMarkAllRead = async () => {
    try {
      await apiService.markAllNotificationsRead();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
      setUnreadCount(0);
    } catch (error) {
      console.error('标记全部已读失败:', error);
    }
  };

  // 删除单条
  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiService.deleteNotification(id);
      const deleted = notifications.find(n => n.id === id);
      setNotifications(prev => prev.filter(n => n.id !== id));
      if (deleted && !deleted.is_read) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error('删除通知失败:', error);
    }
  };

  // 清空全部
  const handleClearAll = async () => {
    if (!confirm('确定清空所有通知吗？')) return;
    try {
      await apiService.clearNotifications();
      setNotifications([]);
      setUnreadCount(0);
      setIsNotificationOpen(false); // 关闭通知弹窗
    } catch (error) {
      console.error('清空通知失败:', error);
    }
  };

  // 通知类型图标
  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'defect': return <AlertCircle size={16} className="text-red-500" />;
      case 'error': return <AlertTriangle size={16} className="text-red-500" />;
      case 'warning': return <AlertCircle size={16} className="text-amber-500" />;
      case 'system': return <Activity size={16} className="text-blue-500" />;
      default: return <Info size={16} className="text-blue-500" />;
    }
  };

  // 通知类型颜色
  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'defect': return 'border-l-red-500';
      case 'error': return 'border-l-red-500';
      case 'warning': return 'border-l-amber-500';
      case 'system': return 'border-l-blue-500';
      default: return 'border-l-blue-500';
    }
  };

  // 格式化时间
  const formatTime = (timeStr: string) => {
    const date = new Date(timeStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN');
  };

  const navItems: NavItem[] = [
    { path: '/', label: '单张检测', icon: <Scan size={18} />, roles: ['admin', 'operator'] },
    { path: '/batch', label: '批量检测', icon: <Image size={18} />, roles: ['admin', 'operator'] },
    { path: '/video', label: '视频检测', icon: <FileVideo size={18} />, roles: ['admin', 'operator'] },
    { path: '/camera', label: '摄像头检测', icon: <Camera size={18} />, roles: ['admin', 'operator'] },
    { path: '/history', label: '历史记录', icon: <History size={18} /> },
    { path: '/statistics', label: '统计分析', icon: <BarChart3 size={18} /> },
    { path: '/users', label: '用户管理', icon: <Users size={18} />, roles: ['admin'] },
    { path: '/settings', label: '系统设置', icon: <Settings size={18} />, roles: ['admin'] }
  ];

  const filteredNavItems = navItems.filter(
    item => !item.roles || item.roles.includes(user?.role || '')
  );

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin':
        return { label: '管理员', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30', icon: <Shield size={12} /> };
      case 'operator':
        return { label: '操作员', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: <Cpu size={12} /> };
      case 'viewer':
        return { label: '查看员', color: 'bg-[var(--bg-tertiary)]/50 text-[var(--text-muted)] border-[var(--border-color)]', icon: <Eye size={12} /> };
      default:
        return { label: role, color: 'bg-[var(--bg-tertiary)]/50 text-[var(--text-muted)]', icon: null };
    }
  };

  const roleBadge = getRoleBadge(user?.role || '');

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex">
      {/* Sidebar - Desktop */}
      <motion.aside
        initial={false}
        animate={{ width: isSidebarOpen ? 240 : 72 }}
        className="hidden lg:flex flex-col bg-[var(--bg-card)] border-r border-[var(--border-color)] fixed h-full z-20"
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg flex items-center justify-center shadow-lg shadow-orange-500/20">
              <Scan className="text-white" size={20} />
            </div>
            {isSidebarOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="font-semibold text-[var(--text-primary)]"
              >
                <div className="text-sm font-medium">金属细管检测</div>
                <div className="text-xs text-[var(--text-muted)]">缺陷检测系统</div>
              </motion.div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
          {filteredNavItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <motion.button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                  isActive
                    ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/25'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                }`}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <span className={isActive ? 'text-white' : ''}>{item.icon}</span>
                {isSidebarOpen && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="font-medium text-sm"
                  >
                    {item.label}
                  </motion.span>
                )}
              </motion.button>
            );
          })}
        </nav>

        {/* Toggle Button */}
        <div className="p-2 border-t border-[var(--border-color)]">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="w-full flex items-center justify-center p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] transition-colors"
          >
            {isSidebarOpen ? <ChevronDown className="rotate-90" size={18} /> : <ChevronDown className="-rotate-90" size={18} />}
          </button>
        </div>
      </motion.aside>

      {/* Mobile Sidebar */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            key="mobile-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-30 lg:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}
        {isMobileMenuOpen && (
          <motion.aside
            key="mobile-sidebar"
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            className="fixed left-0 top-0 bottom-0 w-72 bg-[var(--bg-card)] z-40 lg:hidden border-r border-[var(--border-color)]"
          >
            <div className="h-16 flex items-center justify-between px-4 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg flex items-center justify-center">
                  <Scan className="text-white" size={20} />
                </div>
                <div className="font-semibold text-[var(--text-primary)] text-sm">
                  金属细管检测
                </div>
              </div>
              <button onClick={() => setIsMobileMenuOpen(false)}>
                <X size={24} className="text-[var(--text-muted)]" />
              </button>
            </div>
            <nav className="p-3 space-y-1">
              {filteredNavItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => {
                      navigate(item.path);
                      setIsMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                      isActive
                        ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {item.icon}
                    <span className="font-medium text-sm">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className={`flex-1 flex flex-col min-h-0 transition-all duration-300 overflow-hidden ${
        isSidebarOpen ? 'lg:ml-[240px]' : 'lg:ml-[72px]'
      }`} style={{ height: '100vh' }}>
        {/* Header */}
        <header className="h-14 bg-[var(--bg-card)]/80 backdrop-blur-xl border-b border-[var(--border-color)] flex items-center justify-between px-4 lg:px-6 sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-2 hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-muted)]"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-orange-500" />
              <h1 className="text-sm font-semibold text-[var(--text-primary)] hidden sm:block">
                {filteredNavItems.find(item => item.path === location.pathname)?.label || '金属细管内壁缺陷检测系统'}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Notifications */}
            <div className="relative">
              <button
                onClick={() => setIsNotificationOpen(!isNotificationOpen)}
                className="relative p-2 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors text-[var(--text-muted)]"
              >
                <Bell size={18} />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-medium px-1">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              {/* Notification Dropdown */}
              {isNotificationOpen && (
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsNotificationOpen(false)}
                />
              )}
              <AnimatePresence>
                {isNotificationOpen && (
                  <motion.div
                    key="notification-panel"
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full mt-2 w-80 max-h-[480px] bg-[var(--bg-card)] rounded-xl shadow-xl border border-[var(--border-color)] z-50 overflow-hidden flex flex-col"
                  >
                      {/* Header */}
                      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
                        <h3 className="font-semibold text-[var(--text-primary)]">通知中心</h3>
                        <div className="flex items-center gap-1">
                          {unreadCount > 0 && (
                            <button
                              onClick={handleMarkAllRead}
                              className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                              title="全部标为已读"
                            >
                              <CheckCheck size={16} />
                            </button>
                          )}
                          {notifications.length > 0 && (
                            <button
                              onClick={handleClearAll}
                              className="p-1.5 hover:bg-red-500/10 rounded-lg text-[var(--text-muted)] hover:text-red-400"
                              title="清空通知"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Notification List */}
                      <div className="flex-1 overflow-y-auto">
                        {notifications.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
                            <Bell size={32} className="mb-2 opacity-50" />
                            <p className="text-sm">暂无通知</p>
                          </div>
                        ) : (
                          <div className="divide-y divide-[var(--border-color)]">
                            {notifications.map((notification) => (
                              <div
                                key={notification.id}
                                className={`relative px-4 py-3 hover:bg-[var(--bg-tertiary)]/50 transition-colors cursor-pointer border-l-2 ${getNotificationColor(notification.type)} ${
                                  !notification.is_read ? 'bg-[var(--bg-tertiary)]/30' : ''
                                }`}
                                onClick={() => {
                                  if (!notification.is_read) {
                                    handleMarkRead(notification.id, { stopPropagation: () => {} } as React.MouseEvent);
                                  }
                                }}
                              >
                                <div className="flex items-start gap-3">
                                  <div className="mt-0.5 flex-shrink-0">
                                    {getNotificationIcon(notification.type)}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className={`text-sm font-medium truncate ${
                                        !notification.is_read ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                                      }`}>
                                        {notification.title}
                                      </p>
                                      <span className="text-xs text-[var(--text-muted)] flex-shrink-0">
                                        {formatTime(notification.created_at)}
                                      </span>
                                    </div>
                                    <p className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2">
                                      {notification.message}
                                    </p>
                                    {!notification.is_read && (
                                      <span className="inline-block w-2 h-2 bg-orange-500 rounded-full mt-1" />
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    {!notification.is_read && (
                                      <button
                                        onClick={(e) => handleMarkRead(notification.id, e)}
                                        className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                        title="标为已读"
                                      >
                                        <CheckCircle size={14} />
                                      </button>
                                    )}
                                    <button
                                      onClick={(e) => handleDelete(notification.id, e)}
                                      className="p-1 hover:bg-red-500/10 rounded text-[var(--text-muted)] hover:text-red-400"
                                      title="删除"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Footer */}
                      {notifications.length > 0 && (
                        <div className="px-4 py-2 border-t border-[var(--border-color)] text-center">
                          <span className="text-xs text-[var(--text-muted)]">
                            共 {notifications.length} 条通知
                            {unreadCount > 0 && `，${unreadCount} 条未读`}
                          </span>
                        </div>
                      )}
                    </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* User Menu */}
            <div className="relative">
              <button
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="flex items-center gap-3 p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
              >
                <img
                  src={user?.avatarUrl ? (user.avatarUrl.startsWith('http') || user.avatarUrl.startsWith('/uploads') ? user.avatarUrl : `/uploads${user.avatarUrl}`) : `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.username || 'user'}`}
                  alt={user?.displayName}
                  className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)]"
                  onError={(e) => {
                    // 如果加载失败，使用默认头像
                    (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.username || 'user'}`;
                  }}
                />
                <div className="hidden sm:block text-left">
                  <div className="text-sm font-medium text-[var(--text-primary)]">{user?.displayName}</div>
                  <div className="text-xs text-[var(--text-muted)]">{user?.username}</div>
                </div>
                <ChevronDown size={14} className="text-[var(--text-muted)]" />
              </button>

              <AnimatePresence>
                {isUserMenuOpen && (
                  <motion.div
                    key="user-menu"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute right-0 top-full mt-2 w-56 bg-[var(--bg-card)] rounded-xl shadow-xl border border-[var(--border-color)] py-2 z-50"
                  >
                    <div className="px-4 py-3 border-b border-[var(--border-color)]">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1 border ${roleBadge.color}`}>
                          {roleBadge.icon}
                          {roleBadge.label}
                        </span>
                      </div>
                      <div className="text-sm text-[var(--text-muted)] mt-1">{user?.email}</div>
                    </div>
                    <button
                      onClick={() => {
                        navigate('/profile');
                        setIsUserMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      <UserCircle2 size={18} />
                      <span>个人资料</span>
                    </button>
                    <div className="border-t border-[var(--border-color)] mt-2 pt-2">
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <LogOut size={18} />
                        <span>退出登录</span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <div className="h-full overflow-y-auto">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
};

export default Layout;
