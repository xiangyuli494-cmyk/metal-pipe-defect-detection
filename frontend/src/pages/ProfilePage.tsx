import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  UserCircle2,
  Mail,
  Phone,
  Building2,
  Shield,
  Camera,
  Edit2,
  Lock,
  Eye,
  EyeOff,
  CheckCircle,
  Save,
  X,
  Loader2
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import apiService from '../services/ApiService';

const ProfilePage: React.FC = () => {
  const { user, updateUser } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'password'>('profile');
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    displayName: user?.displayName || '',
    email: user?.email || '',
    phone: user?.phone || '',
    department: user?.department || ''
  });
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSaveProfile = async () => {
    setIsSaving(true);
    try {
      await apiService.updateProfile({
        user_id: user?.id,
        display_name: formData.displayName,
        email: formData.email,
        phone: formData.phone,
        department: formData.department
      });
      updateUser(formData);
      setIsEditing(false);
      setMessage({ type: 'success', text: '个人资料已更新' });
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '保存失败' });
    } finally {
      setIsSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleChangePassword = async () => {
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setMessage({ type: 'error', text: '新密码与确认密码不一致' });
      return;
    }
    if (passwordData.newPassword.length < 6) {
      setMessage({ type: 'error', text: '新密码长度至少6位' });
      return;
    }
    try {
      await apiService.changePassword(user?.id, passwordData.currentPassword, passwordData.newPassword);
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setMessage({ type: 'success', text: '密码修改成功' });
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '密码修改失败' });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const result = await apiService.uploadAvatar(file, parseInt(user?.id || '0', 10));
        updateUser({ avatarUrl: result.avatar_url });
        setMessage({ type: 'success', text: '头像已更新' });
      } catch (error: any) {
        setMessage({ type: 'error', text: error.message || '头像上传失败' });
      }
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const getRoleBadge = () => {
    switch (user?.role) {
      case 'admin':
        return { label: '管理员', color: 'bg-orange-100 text-orange-700' };
      case 'operator':
        return { label: '操作员', color: 'bg-blue-100 text-blue-700' };
      case 'viewer':
        return { label: '查看员', color: 'bg-gray-100 text-gray-700' };
      default:
        return { label: user?.role || '', color: 'bg-gray-100 text-gray-700' };
    }
  };

  const roleBadge = getRoleBadge();

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-4 overflow-y-auto" style={{ height: 'calc(100vh - 56px)' }}>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">个人资料</h1>
        <p className="text-[var(--text-secondary)] mt-1">管理您的个人信息和账户设置</p>
      </div>

      {/* Message */}
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-4 rounded-lg flex items-center gap-2 ${
            message.type === 'success' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
          }`}
        >
          <CheckCircle size={18} />
          <span>{message.text}</span>
        </motion.div>
      )}

      {/* Profile Card */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-[var(--border-color)]">
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors ${
              activeTab === 'profile'
                ? 'text-orange-500 border-b-2 border-orange-500'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <UserCircle2 size={18} />
            基本信息
          </button>
          <button
            onClick={() => setActiveTab('password')}
            className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors ${
              activeTab === 'password'
                ? 'text-orange-500 border-b-2 border-orange-500'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Lock size={18} />
            修改密码
          </button>
        </div>

        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <div className="p-6">
            <div className="flex flex-col md:flex-row gap-8">
              {/* Avatar Section */}
              <div className="flex flex-col items-center">
                <div className="relative">
                  <img
                    src={user?.avatarUrl ? (user.avatarUrl.startsWith('http') || user.avatarUrl.startsWith('/uploads') ? user.avatarUrl : `/uploads${user.avatarUrl}`) : `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.username || 'user'}`}
                    alt={user?.displayName}
                    className="w-32 h-32 rounded-full bg-[var(--bg-tertiary)] object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.username || 'user'}`;
                    }}
                  />
                  <button
                    onClick={handleAvatarClick}
                    className="absolute bottom-0 right-0 w-10 h-10 bg-orange-500 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-orange-600 transition-colors"
                  >
                    <Camera size={18} />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>
                <div className="mt-4 text-center">
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">{user?.displayName}</h3>
                  <p className="text-[var(--text-muted)]">@{user?.username}</p>
                  <span className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-medium ${roleBadge.color}`}>
                    {roleBadge.label}
                  </span>
                </div>
              </div>

              {/* Form Section */}
              <div className="flex-1 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-[var(--text-primary)]">详细信息</h4>
                  {!isEditing && (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="flex items-center gap-1 text-sm text-orange-500 hover:text-orange-600 transition-colors"
                    >
                      <Edit2 size={14} />
                      编辑
                    </button>
                  )}
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-[var(--text-secondary)] mb-1">显示名称</label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={formData.displayName}
                        onChange={(e) => setFormData(prev => ({ ...prev, displayName: e.target.value }))}
                        className="w-full px-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                      />
                    ) : (
                      <div className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-primary)]">
                        <UserCircle2 size={16} className="text-[var(--text-muted)]" />
                        {user?.displayName}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm text-[var(--text-secondary)] mb-1">用户名</label>
                    <div className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-primary)]">
                      <Shield size={16} className="text-[var(--text-muted)]" />
                      {user?.username}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-[var(--text-secondary)] mb-1">邮箱</label>
                    {isEditing ? (
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
                        <input
                          type="email"
                          value={formData.email}
                          onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                          className="w-full pl-10 pr-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-primary)]">
                        <Mail size={16} className="text-[var(--text-muted)]" />
                        {user?.email || '未设置'}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm text-[var(--text-secondary)] mb-1">电话</label>
                    {isEditing ? (
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
                        <input
                          type="tel"
                          value={formData.phone}
                          onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                          className="w-full pl-10 pr-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-primary)]">
                        <Phone size={16} className="text-[var(--text-muted)]" />
                        {user?.phone || '未设置'}
                      </div>
                    )}
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-[var(--text-secondary)] mb-1">部门</label>
                    {isEditing ? (
                      <div className="relative">
                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
                        <input
                          type="text"
                          value={formData.department}
                          onChange={(e) => setFormData(prev => ({ ...prev, department: e.target.value }))}
                          className="w-full pl-10 pr-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-primary)]">
                        <Building2 size={16} className="text-[var(--text-muted)]" />
                        {user?.department || '未设置'}
                      </div>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setFormData({
                          displayName: user?.displayName || '',
                          email: user?.email || '',
                          phone: user?.phone || '',
                          department: user?.department || ''
                        });
                      }}
                      className="flex items-center gap-2 px-4 py-2 border border-[var(--border-color)] text-[var(--text-secondary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                    >
                      <X size={16} />
                      取消
                    </button>
                    <button
                      onClick={handleSaveProfile}
                      disabled={isSaving}
                      className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
                    >
                      {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      {isSaving ? '保存中...' : '保存'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Password Tab */}
        {activeTab === 'password' && (
          <div className="p-6">
            <div className="max-w-md">
              <h4 className="font-medium text-[var(--text-primary)] mb-4">修改密码</h4>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-[var(--text-secondary)] mb-1">当前密码</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
                    <input
                      type={showCurrentPassword ? 'text' : 'password'}
                      value={passwordData.currentPassword}
                      onChange={(e) => setPasswordData(prev => ({ ...prev, currentPassword: e.target.value }))}
                      className="w-full pl-10 pr-10 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                      placeholder="请输入当前密码"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                    >
                      {showCurrentPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-[var(--text-secondary)] mb-1">新密码</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={passwordData.newPassword}
                      onChange={(e) => setPasswordData(prev => ({ ...prev, newPassword: e.target.value }))}
                      className="w-full pl-10 pr-10 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                      placeholder="请输入新密码（至少6位）"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                    >
                      {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-[var(--text-secondary)] mb-1">确认新密码</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={passwordData.confirmPassword}
                      onChange={(e) => setPasswordData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                      className="w-full pl-10 pr-10 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-orange-500 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                      placeholder="请再次输入新密码"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                    >
                      {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <button
                  onClick={handleChangePassword}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
                >
                  <Save size={16} />
                  修改密码
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Account Info */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-6">
        <h4 className="font-medium text-[var(--text-primary)] mb-4">账户信息</h4>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="p-4 bg-[var(--bg-tertiary)] rounded-lg">
            <div className="text-sm text-[var(--text-muted)] mb-1">账户状态</div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
              <span className="font-medium text-[var(--text-primary)]">正常</span>
            </div>
          </div>
          <div className="p-4 bg-[var(--bg-tertiary)] rounded-lg">
            <div className="text-sm text-[var(--text-muted)] mb-1">注册时间</div>
            <div className="font-medium text-[var(--text-primary)]">2026-01-01</div>
          </div>
          <div className="p-4 bg-[var(--bg-tertiary)] rounded-lg">
            <div className="text-sm text-[var(--text-muted)] mb-1">最后登录</div>
            <div className="font-medium text-[var(--text-primary)]">2026-04-16 10:00</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
