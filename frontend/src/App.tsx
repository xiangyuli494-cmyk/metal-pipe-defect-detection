import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import Layout from './components/Layout';
import SingleDetectionPage from './pages/SingleDetectionPage';
import BatchDetectionPage from './pages/BatchDetectionPage';
import CameraDetectionPage from './pages/CameraDetectionPage';
import HistoryPage from './pages/HistoryPage';
import StatisticsPage from './pages/StatisticsPage';
import UserManagementPage from './pages/UserManagementPage';
import ProfilePage from './pages/ProfilePage';
import SystemSettingsPage from './pages/SystemSettingsPage';
import { AuthProvider, useAuth } from './contexts/AuthContext';

const ProtectedRoute: React.FC<{ children: React.ReactNode; requiredRole?: string }> = ({ children, requiredRole }) => {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-[var(--text-secondary)]">加载中...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requiredRole && user?.role !== requiredRole && user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

const HomeRedirect: React.FC = () => {
  const { user } = useAuth();
  if (user?.role === 'viewer') {
    return <Navigate to="/history" replace />;
  }
  return <SingleDetectionPage />;
};

const AppRoutes: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-[var(--text-secondary)]">加载中...</span>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          isAuthenticated ? (
            <Navigate to="/" replace />
          ) : (
            <LoginPage />
          )
        }
      />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<HomeRedirect />} />
          <Route path="batch" element={
            <ProtectedRoute requiredRole="operator">
              <BatchDetectionPage />
            </ProtectedRoute>
          } />
          <Route path="video" element={
            <ProtectedRoute requiredRole="operator">
              <CameraDetectionPage initialMode="video" />
            </ProtectedRoute>
          } />
          <Route path="camera" element={
            <ProtectedRoute requiredRole="operator">
              <CameraDetectionPage initialMode="camera" />
            </ProtectedRoute>
          } />
          <Route path="history" element={<HistoryPage />} />
          <Route path="statistics" element={<StatisticsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route
            path="users"
            element={
              <ProtectedRoute requiredRole="admin">
                <UserManagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="settings"
            element={
              <ProtectedRoute requiredRole="admin">
                <SystemSettingsPage />
              </ProtectedRoute>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </AuthProvider>
  );
};

export default App;
