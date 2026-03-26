'use client';
import { useState, useEffect } from 'react';

export function useTheme() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Load saved preference
    const saved = localStorage.getItem('pl_theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = saved ? saved === 'dark' : prefersDark;
    setIsDark(dark);
    if (dark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, []);

  function toggle() {
    setIsDark(prev => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('pl_theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('pl_theme', 'light');
      }
      return next;
    });
  }

  return { isDark, toggle };
}
