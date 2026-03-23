import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'PacificaLens',
  description: 'Advanced analytics & risk management for Pacifica DEX',
  icons: {
    icon: '/pacificalens.ico',
    shortcut: '/pacificalens.ico',
    apple: '/pacificalens.ico',
    other: [{ rel: 'icon', url: '/pacificalens.ico', sizes: '256x256' }],
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
