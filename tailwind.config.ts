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
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        surface2: 'var(--surface2)',
        border1: 'var(--border1)',
        border2: 'var(--border2)',
        accent: 'var(--accent)',
        accent2: 'var(--accent2)',
        success: 'var(--success)',
        danger: 'var(--danger)',
        warn: 'var(--warn)',
        text1: 'var(--text1)',
        text2: 'var(--text2)',
        text3: 'var(--text3)',
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
