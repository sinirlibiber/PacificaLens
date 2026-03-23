import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'PacificaLens',
  description: 'Advanced analytics & risk management for Pacifica DEX',
  icons: {
    icon: [
      { url: '/pacificalens.ico', sizes: '256x256' },
      { url: '/logo.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/logo.png',
    apple: '/logo.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
