import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg:        'var(--bg)',
        surface:   'var(--surface)',
        surface2:  'var(--surface2)',
        surface3:  'var(--surface3)',
        border1:   'var(--border1)',
        border2:   'var(--border2)',
        accent:    'var(--accent)',
        accent2:   'var(--accent2)',
        success:   'var(--success)',
        danger:    'var(--danger)',
        warn:      'var(--warn)',
        text1:     'var(--text1)',
        text2:     'var(--text2)',
        text3:     'var(--text3)',
      },
      fontFamily: {
        mono:    ['DM Mono', 'monospace'],
        display: ['Syne', 'sans-serif'],
        sans:    ['Syne', 'sans-serif'],
      },
      boxShadow: {
        card:    'var(--shadow)',
        'card-md': 'var(--shadow-md)',
        'card-lg': 'var(--shadow-lg)',
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '20px',
      },
    },
  },
  plugins: [],
}
export default config
