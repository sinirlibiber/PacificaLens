import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { Analytics } from '@vercel/analytics/next';

export const metadata: Metadata = {
  title: 'PacificaLens',
  description: 'Advanced analytics & risk management for Pacifica DEX',
  icons: {
    icon: [
      { url: '/pacificalens.ico', sizes: '32x32', type: 'image/x-icon' },
      { url: '/logo.png', sizes: '256x256', type: 'image/png' },
    ],
    shortcut: '/logo.png',
    apple: { url: '/logo.png', sizes: '180x180' },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
