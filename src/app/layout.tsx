import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'PacificaLens',
  description: 'Advanced analytics & risk management for Pacifica DEX',
  icons: {
    icon: [
      { url: '/pacificalens.ico', sizes: '32x32' },
      { url: '/pacificalens.ico', sizes: '64x64' },
      { url: '/pacificalens.ico', sizes: '128x128' },
      { url: '/pacificalens.ico', sizes: '256x256' },
    ],
    shortcut: '/pacificalens.ico',
    apple: { url: '/pacificalens.ico', sizes: '256x256' },
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
