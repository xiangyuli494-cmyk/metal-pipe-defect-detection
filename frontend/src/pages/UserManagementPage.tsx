import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Plus,
  Search,
  Edit2,
  Trash2,
  Shield,
  Eye,
  EyeOff,
  X,
  CheckCircle,
  AlertCircle,
  UserCircle2,
  Mail,
  Phone,
  Building2,
  Loader2,
  KeyRound
} from 'lucide-react';
import apiService from '../services/ApiService';

type UserRole = 'admin' | 'operator' | 'viewer';

interface User {
  id: number;
  username: string;
  displayName: string;
  email: string;
  phone?: string;
  department?: string;
  role: UserRole;
  is_active: boolean;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

const UserManagementPage: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Form data state
  const [formData, setFormData] = useState({
    username: '',
    displayName: '',
    email: '',
    phone: '',
    department: '',
    role: 'viewer' as UserRole,
    is_active: true
  });
  const [password, setPassword] = useState('');

  // Toast helper
  const addToast = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const data = await apiService.getUsers();
      const mappedUsers: User[] = data.map((u: any) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name || u.full_name || u.username,
        email: u.email || '',
        phone: '',
        department: '',
        role: u.role || 'viewer',
        is_active: !!u.is_active,
        avatarUrl: u.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.username}`,
        createdAt: u.created_at,
        updatedAt: u.updated_at
      }));
      setUsers(mappedUsers);
    } catch (error) {
      console.error('Error fetching users:', error);
      addToast('error', '获取用户列表失败');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredUsers = users.filter(user =>
    user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleOpenModal = (user?: User) => {
    if (user) {
      setEditingUser(user);
      setFormData({
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        phone: user.phone || '',
        department: user.department || '',
        role: user.role,
        is_active: user.is_active
      });
      setPassword('');
    } else {
      setEditingUser(null);
      setFormData({ username: '', displayName: '', email: '', phone: '', department: '', role: 'viewer', is_active: true });
      setPassword('');
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
    setShowPassword(false);
    setPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingUser) {
        await apiService.updateUser(editingUser.id, {
          full_name: formData.displayName,
          email: formData.email,
          role: formData.role,
          is_active: formData.is_active
        });
        addToast('success', '用户信息更新成功');
      } else {
        await apiService.createUser({
          username: formData.username,
          password: password,
          email: formData.email,
          full_name: formData.displayName,
          role: formData.role
        });
        addToast('success', `用户 ${formData.username} 创建成功`);
      }
      await fetchUsers();
      handleCloseModal();
    } catch (error) {
      console.error('Error saving user:', error);
      addToast('error', `操作失败: ${(error as Error).message}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除该用户吗？此操作不可恢复！')) return;
    
    try {
      await apiService.deleteUser(Number(id));
      setUsers(prev => prev.filter(u => u.id !== Number(id)));
      addToast('success', '用户已删除');
    } catch (error) {
      console.error('Error deleting user:', error);
      addToast('error', '删除用户失败');
    }
  };

  const handleToggleStatus = async (id: string) => {
    const user = users.find(u => u.id === Number(id));
    if (!user) return;

    try {
      const result = await apiService.toggleUserStatus(Number(id));
      setUsers(prev =>
        prev.map(u =>
          u.id === Number(id)
            ? { ...u, is_active: result.is_active }
            : u
        )
      );
      addToast(
        'success',
        `用户 ${user.username} 已${result.is_active ? '启用' : '停用'}`
      );
    } catch (error) {
      console.error('Error toggling status:', error);
      addToast('error', '状态切换失败');
    }
  };

  const openResetModal = (user: User) => {
    setResetUser(user);
    setNewPassword('');
    setIsResetModalOpen(true);
  };

  const handleResetPassword = async () => {
    if (!resetUser || !newPassword) return;
    
    if (newPassword.length < 6) {
      addToast('error', '密码长度至少6位');
      return;
    }

    try {
      await apiService.resetPassword(resetUser.id, newPassword);
      addToast('success', `用户 ${resetUser.username} 的密码已重置`);
      setIsResetModalOpen(false);
      setResetUser(null);
      setNewPassword('');
    } catch (error) {
      console.error('Error resetting password:', error);
      addToast('error', '密码重置失败');
    }
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return { label: '管理员', color: 'bg-orange-100 text-orange-700 border-orange-200', icon: <Shield size={12} /> };
      case 'operator':
        return { label: '操作员', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: null };
      case 'viewer':
        return { label: '查看员', color: 'bg-gray-100 text-gray-700 border-gray-200', icon: <Eye size={12} /> };
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '从未';
    return new Date(dateString).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-6 p-4 overflow-y-auto" style={{ height: 'calc(100vh - 56px)' }}>
      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 z-[100] space-y-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 50 }}
              className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border ${
                toast.type === 'success'
                  ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                  : toast.type === 'error'
                    ? 'bg-red-500/10 text-red-600 border-red-500/30'
                    : 'bg-blue-500/10 text-blue-600 border-blue-500/30'
              }`}
            >
              {toast.type === 'success'
                ? <CheckCircle size={18} />
                : toast.type === 'error'
                  ? <AlertCircle size={18} />
                  : <Eye size={18} />}
              <span className="text-sm font-medium">{toast.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">用户管理</h1>
          <p className="text-[var(--text-secondary)] mt-1">管理系统用户和权限</p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
        >
          <Plus size={18} />
          <span>添加用户</span>
        </button>
      </div>

      {/* Search */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={18} />
          <input
            type="text"
            placeholder="搜索用户名、姓名或邮箱..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
          />
        </div>
      </div>

      {/* User Table */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="text-orange-500 animate-spin" />
            <span className="ml-3 text-[var(--text-secondary)]">加载中...</span>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-[var(--bg-tertiary)]">
              <tr>
                <th className="text-left py-3 px-4 text-sm font-medium text-[var(--text-muted)]">用户</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[var(--text-muted)]">角色</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[var(--text-muted)]">状态</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[var(--text-muted)]">创建时间</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[var(--text-muted)]">最后更新</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[var(--text-muted)]">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-color)]">
              {filteredUsers.map((user) => {
                const roleBadge = getRoleBadge(user.role);
                return (
                  <motion.tr
                    key={user.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="hover:bg-[var(--bg-tertiary)]/50"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <img
                          src={user.avatarUrl ? (user.avatarUrl.startsWith('http') || user.avatarUrl.startsWith('/uploads') ? user.avatarUrl : `/uploads${user.avatarUrl}`) : `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`}
                          alt={user.displayName}
                          className="w-10 h-10 rounded-full bg-[var(--bg-tertiary)]"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`;
                          }}
                        />
                        <div>
                          <div className="font-medium text-[var(--text-primary)]">{user.displayName}</div>
                          <div className="text-sm text-[var(--text-muted)]">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${roleBadge.color}`}>
                        {roleBadge.icon}
                        {roleBadge.label}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => handleToggleStatus(String(user.id))}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                          user.is_active
                            ? 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'
                            : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-400'
                        }`}
                      >
                        {user.is_active ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                        {user.is_active ? '活跃' : '停用'}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-[var(--text-secondary)]">{formatDate(user.createdAt)}</td>
                    <td className="py-3 px-4 text-[var(--text-secondary)]">{formatDate(user.updatedAt)}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleOpenModal(user)}
                          className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
                          title="编辑"
                        >
                          <Edit2 size={16} className="text-[var(--text-secondary)]" />
                        </button>
                        <button
                          onClick={() => openResetModal(user)}
                          className="p-1.5 hover:bg-blue-500/10 rounded-lg transition-colors"
                          title="重置密码"
                        >
                          <KeyRound size={16} className="text-blue-500" />
                        </button>
                        <button
                          onClick={() => handleDelete(String(user.id))}
                          className="p-1.5 hover:bg-red-500/10 rounded-lg transition-colors"
                          title="删除"
                        >
                          <Trash2 size={16} className="text-red-500" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            key="user-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={handleCloseModal}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[var(--bg-card)] rounded-xl max-w-md w-full max-h-[90vh] overflow-hidden border border-[var(--border-color)]"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                  {editingUser ? '编辑用户' : '添加用户'}
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
                >
                  <X size={20} className="text-[var(--text-secondary)]" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">用户名</label>
                  <div className="relative">
                    <UserCircle2 className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={18} />
                    <input
                      type="text"
                      value={formData.username}
                      onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                      className="w-full pl-10 pr-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                      placeholder="请输入用户名"
                      required
                      disabled={!!editingUser}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">显示名称</label>
                  <input
                    type="text"
                    value={formData.displayName}
                    onChange={(e) => setFormData(prev => ({ ...prev, displayName: e.target.value }))}
                    className="w-full px-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                    placeholder="请输入显示名称"
                    required
                  />
                </div>
                {!editingUser && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">邮箱</label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={18} />
                        <input
                          type="email"
                          value={formData.email}
                          onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                          className="w-full pl-10 pr-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                          placeholder="请输入邮箱"
                          required={!editingUser}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">密码</label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full px-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                          placeholder="请输入密码（至少6位）"
                          required={!editingUser}
                          minLength={6}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                        >
                          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">角色</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value as UserRole }))}
                    className="w-full px-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                  >
                    <option value="admin">管理员</option>
                    <option value="operator">操作员</option>
                    <option value="viewer">查看员</option>
                  </select>
                </div>
                {editingUser && (
                  <div className="flex items-center gap-3 p-3 bg-[var(--bg-tertiary)]/50 rounded-lg">
                    <input
                      type="checkbox"
                      id="is-active"
                      checked={formData.is_active}
                      onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                      className="w-4 h-4 rounded border-[var(--border-color)] accent-orange-500"
                    />
                    <label htmlFor="is-active" className="text-sm text-[var(--text-secondary)] cursor-pointer">
                      账户状态：{formData.is_active ? '启用中' : '已停用'}
                    </label>
                  </div>
                )}
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="flex-1 px-4 py-2 border border-[var(--border-color)] text-[var(--text-secondary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
                  >
                    {editingUser ? '保存' : '创建'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reset Password Modal */}
      <AnimatePresence>
        {isResetModalOpen && resetUser && (
          <motion.div
            key="reset-password-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setIsResetModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[var(--bg-card)] rounded-xl max-w-md w-full border border-[var(--border-color)]"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <KeyRound size={20} className="text-blue-500" />
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">重置密码</h3>
                </div>
                <button
                  onClick={() => setIsResetModalOpen(false)}
                  className="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
                >
                  <X size={20} className="text-[var(--text-secondary)]" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-[var(--text-secondary)]">
                  为用户 <strong className="text-[var(--text-primary)]">{resetUser.displayName}</strong> ({resetUser.username}) 设置新密码：
                </p>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">新密码</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-blue-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                    placeholder="请输入新密码（至少6位）"
                    minLength={6}
                    autoFocus
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setIsResetModalOpen(false)}
                    className="flex-1 px-4 py-2 border border-[var(--border-color)] text-[var(--text-secondary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleResetPassword}
                    disabled={!newPassword || newPassword.length < 6}
                    className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    确认重置
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default UserManagementPage;
