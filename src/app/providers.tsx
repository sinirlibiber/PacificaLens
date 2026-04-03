'use client';
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';

const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: false,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;

  if (!appId) return <>{children}</>;

  return (
    <PrivyProvider
      appId={appId}
      clientId={clientId}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#00b4d8',
          logo: 'https://raw.githubusercontent.com/sinirlibiber/PacificaLens/refs/heads/main/public/logo.png',
        },
        loginMethods: ['wallet'],
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
        solanaClusters: [
          { name: 'mainnet-beta', rpcUrl: 'https://api.mainnet-beta.solana.com' },
        ],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
