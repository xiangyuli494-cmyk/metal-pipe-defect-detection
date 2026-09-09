import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import apiService from '../services/ApiService';

// 本地MySQL用户角色类型
type UserRole = 'admin' | 'operator' | 'viewer';

interface User {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  avatarUrl?: string;
  email?: string;
  phone?: string;
  department?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  updateUser: (userData: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 检查本地存储中是否有已登录用户
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        setUser(parsedUser);
      } catch (error) {
        console.error('解析保存的用户数据失败:', error);
        localStorage.removeItem('currentUser');
      }
    }
    setIsLoading(false);
  }, []);

  // 监听 token 被清除事件（ApiService 刷新失败时触发），同步 React state
  useEffect(() => {
    const handleTokenCleared = () => {
      setUser(null);
    };
    window.addEventListener('auth:tokenCleared', handleTokenCleared);
    return () => window.removeEventListener('auth:tokenCleared', handleTokenCleared);
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        console.error('登录失败:', data.detail || '未知错误');
        return false;
      }

      // 登录成功，存储用户信息和 JWT token
      const dbUser = data.data;
      const loginUser: User = {
        id: dbUser.id.toString(),
        username: dbUser.username,
        displayName: dbUser.displayName,
        role: dbUser.role as UserRole,
        email: dbUser.email,
        phone: dbUser.phone,
        department: dbUser.department,
        avatarUrl: dbUser.avatarUrl
      };

      setUser(loginUser);
      localStorage.setItem('currentUser', JSON.stringify(loginUser));

      // 存储 JWT tokens
      if (dbUser.access_token) {
        localStorage.setItem('accessToken', dbUser.access_token);
      }
      if (dbUser.refresh_token) {
        localStorage.setItem('refreshToken', dbUser.refresh_token);
      }

      return true;

    } catch (error) {
      console.error('登录异常:', error);
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    setUser(null);
    // clearTokens 会清除 localStorage 并触发 auth:tokenCleared 事件
    // 先 setUser(null) 避免事件处理器重复操作
    localStorage.removeItem('currentUser');
    apiService.clearTokens();
  }, []);

  const updateUser = useCallback((userData: Partial<User>) => {
    if (user) {
      const updatedUser = { ...user, ...userData };
      setUser(updatedUser);
      localStorage.setItem('currentUser', JSON.stringify(updatedUser));
    }
  }, [user]);

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    logout,
    updateUser
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};