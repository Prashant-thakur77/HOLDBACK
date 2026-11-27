import type { PollarClientConfig } from '@pollar/core';
import { createSecureStoreAdapter } from '@pollar/core/adapters/expo';
import { PollarProvider, usePollar } from '@pollar/react-native';
import { PublicKey, type Connection } from '@solana/web3.js';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import {
  createContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { config } from '@/config';
import { guardian } from '@/data/guardian';
import { toPublicKey } from '@/lib/address';
import {
  PollarFlow,
  toTransferResult,
  type PollarSession,
  type TransferRequest,
} from '@/lib/pollarFlow';

import type { PollarHandle } from './WalletContext';

export const PollarHandleContext = createContext<PollarHandle | null>(null);

const SESSION_KEY = 'holdback.relay.session';
const OAUTH_REDIRECT = 'holdback://auth';

/** Reads the stored relay session. A missing or unreadable value is simply "no session". */
async function readSession(): Promise<PollarSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    return raw ? (JSON.parse(raw) as PollarSession) : null;
  } catch {
    return null;
  }
}

async function writeSession(session: PollarSession | null): Promise<void> {
  try {
    if (session) await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
    else await SecureStore.deleteItemAsync(SESSION_KEY);
  } catch {
    // Losing the stored session only means proving ownership again next time.
  }
}

async function boxBalance(connection: Connection, tokenAccount: string): Promise<bigint | null> {
  try {
    const balance = await connection.getTokenAccountBalance(
      new PublicKey(tokenAccount),
      'confirmed',
    );
    return BigInt(balance.value.amount);
  } catch {
    return null;
  }
}

/**
 * What the flow needs from React land. The flow is created once for the app
 * (it owns the relay session), while the Pollar client and the connection
 * come from providers, so the mounted bridge keeps these two fields current.
 */
const runtime: {
  sendPayment: ReturnType<typeof usePollar>['sendPayment'] | null;
  connection: Connection | null;
} = { sendPayment: null, connection: null };

const flow = new PollarFlow({
  api: guardian,
  transfer: async (request: TransferRequest) => {
    if (!runtime.sendPayment) throw new Error('Pollar is not signed in');
    return toTransferResult(
      await runtime.sendPayment({
        chain: 'SOLANA',
        destination: request.destination,
        amount: request.amount,
        mint: request.mint,
      }),
    );
  },
  setToken: (token) => {
    guardian.token = token ?? undefined;
  },
  boxBalance: async (tokenAccount) =>
    runtime.connection ? boxBalance(runtime.connection, tokenAccount) : null,
  persist: writeSession,
});

/**
 * Mounts Pollar and exposes it to the rest of the app as a `PollarHandle`.
 * The Pollar client keeps its login in the device keystore (expo-secure-store),
 * so the storage adapter has to exist before the provider renders.
 */
export function PollarRoot({
  connection,
  children,
}: {
  connection: Connection;
  children: ReactNode;
}) {
  const [clientConfig, setClientConfig] = useState<PollarClientConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    createSecureStoreAdapter()
      .then((storage) => {
        if (cancelled) return;
        setClientConfig({
          apiKey: config.pollarKey,
          storage,
          oauthRedirectUri: OAUTH_REDIRECT,
          openAuthUrl: async ({ getUrl, redirectUri }) => {
            const url = await getUrl();
            if (url) await WebBrowser.openAuthSessionAsync(url, redirectUri ?? OAUTH_REDIRECT);
          },
        });
      })
      .catch(() => {
        // Without the keystore the Pollar client still works; it just forgets the login on restart.
        if (!cancelled) setClientConfig({ apiKey: config.pollarKey });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!clientConfig) return <PollarHandleContext value={null}>{children}</PollarHandleContext>;
  return (
    <PollarProvider config={clientConfig}>
      <Bridge connection={connection}>{children}</Bridge>
    </PollarProvider>
  );
}

function Bridge({ connection, children }: { connection: Connection; children: ReactNode }) {
  const pollar = usePollar();
  const solanaAddress = pollar.wallets.find((wallet) => wallet.chain === 'SOLANA')?.address ?? null;

  // Keep the flow pointed at the live Pollar client and RPC connection.
  useEffect(() => {
    runtime.sendPayment = pollar.sendPayment;
    runtime.connection = connection;
    return () => {
      runtime.sendPayment = null;
    };
  }, [pollar.sendPayment, connection]);

  const state = useSyncExternalStore(flow.subscribe, flow.getState);

  // Adopt a stored relay session, but only for the wallet it was issued to.
  useEffect(() => {
    if (!solanaAddress) return;
    let cancelled = false;
    readSession().then((stored) => {
      if (cancelled || !stored) return;
      if (stored.owner === solanaAddress) flow.restore(stored);
      else void writeSession(null);
    });
    return () => {
      cancelled = true;
    };
  }, [solanaAddress]);

  const handle = useMemo<PollarHandle>(
    () => ({
      signedIn: pollar.isAuthenticated,
      address: toPublicKey(solanaAddress),
      openLogin: () => pollar.openLoginModal(),
      logout: async () => {
        await flow.signOut();
        await pollar.logout();
      },
      flow,
      state,
    }),
    [pollar, solanaAddress, state],
  );

  return <PollarHandleContext value={handle}>{children}</PollarHandleContext>;
}
