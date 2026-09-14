import { useEffect, useState, useCallback } from 'react';

export type Theme = 'light';

/**
 * 获取初始主题
 * 固定使用亮色主题
 */
function getInitialTheme(): Theme {
  return 'light';
}

/**
 * 主题管理 Hook
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  // 应用主题到 DOM
  const applyTheme = useCallback((newTheme: Theme) => {
    if (typeof document === 'undefined') return;

    const html = document.documentElement;

    // 移除旧的主题类
    html.classList.remove('light', 'dark', 'glass');
    // 添加新的主题类
    html.classList.add(newTheme);
    // 设置 data-theme 属性
    html.setAttribute('data-theme', newTheme);

    // 保存到 localStorage
    localStorage.setItem('theme', newTheme);
  }, []);

  // 切换主题（当前仅支持亮色主题，保留函数以兼容现有代码）
  const toggleTheme = useCallback(() => {
    // 固定使用亮色主题
    setThemeState('light');
    applyTheme('light');
  }, [applyTheme]);

  // 设置指定主题
  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    applyTheme(newTheme);
  }, [applyTheme]);

  // 初始化时应用主题
  useEffect(() => {
    applyTheme(theme);

    // 强制使用亮色主题，不监听系统主题变化
  }, [applyTheme, theme]);

  return {
    theme,
    setTheme,
    toggleTheme,
    isDark: false,
    isLight: true,
    isGlass: false
  };
}

export default useTheme;
