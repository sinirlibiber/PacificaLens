import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#f8fafc',
        surface: '#ffffff',
        surface2: '#f1f5f9',
        border1: '#e2e8f0',
        border2: '#cbd5e1',
        accent: '#00b4d8',
        accent2: '#0096c7',
        success: '#10b981',
        danger: '#ef4444',
        warn: '#f59e0b',
        text1: '#0f172a',
        text2: '#475569',
        text3: '#94a3b8',
      },
      fontFamily: {
        mono: ['DM Mono', 'monospace'],
        display: ['Inter', 'sans-serif'],
        sans: ['Inter', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
        'card-md': '0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.05)',
      },
    },
  },
  plugins: [],
}
export default config
