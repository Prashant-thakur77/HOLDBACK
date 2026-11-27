import { parseProgramError, type BuiltTransaction } from '@holdback/sdk';
import type { Connection, PublicKey } from '@solana/web3.js';
import { useQueryClient } from '@tanstack/react-query';
import { MobileWalletProvider, useMobileWallet } from '@wallet-ui/react-native-web3js';
import { use, useCallback, useMemo, type ReactNode } from 'react';

import { config, hasPollar } from '@/config';
import { guardian } from '@/data/guardian';
import { confirmSignature } from '@/lib/confirm';
import { WalletActionError, classifyWalletError, errorDetail } from '@/lib/walletErrors';
import { useSettings } from '@/state/settings';

import { PollarHandleContext, PollarRoot } from './PollarBridge';
import { WalletContext, type WalletApi } from './WalletContext';
import { clearWalletSession } from './walletSession';

/** Shown by the wallet app when it asks the user to authorize HOLDBACK. */
const IDENTITY = { name: 'HOLDBACK' };

/**
 * Everything wallet-related: the Mobile Wallet Adapter session, the optional
 * Pollar client, and one `useWallet()` API over both.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <MobileWalletProvider chain={config.chain} endpoint={config.rpcUrl} identity={IDENTITY}>
      <PollarLayer>
        <Unified>{children}</Unified>
      </PollarLayer>
    </MobileWalletProvider>
  );
}

function PollarLayer({ children }: { children: ReactNode }) {
  const { connection } = useMobileWallet();
  if (!hasPollar) return <PollarHandleContext value={null}>{children}</PollarHandleContext>;
  return <PollarRoot connection={connection}>{children}</PollarRoot>;
}

function Unified({ children }: { children: ReactNode }) {
  const mwa = useMobileWallet();
  const pollar = use(PollarHandleContext);
  const kind = useSettings((state) => state.walletKind);
  const queryClient = useQueryClient();
  const { connection, account } = mwa;

  const address: PublicKey | null =
    kind === 'pollar'
      ? (pollar?.address ?? null)
      : kind === 'mwa'
        ? (account?.address ?? null)
        : null;

  const connectWallet = useCallback(async () => {
    try {
      const authorized = await mwa.connect();
      return authorized.address;
    } catch (error) {
      throw new WalletActionError(classifyWalletError(error), errorDetail(error));
    }
  }, [mwa]);

  const signAndConfirm = useCallback(
    async (build: (connection: Connection) => Promise<BuiltTransaction>) => {
      // Read the slot before building: the wallet only needs an RPC node at least this recent.
      const minContextSlot = await connection.getSlot('confirmed');
      const built = await build(connection);

      let signature: string;
      try {
        signature = await mwa.signAndSendTransaction(built.transaction, minContextSlot);
      } catch (error) {
        throw new WalletActionError(classifyWalletError(error), errorDetail(error));
      }

      const outcome = await confirmSignature(connection, signature, built.lastValidBlockHeight);
      switch (outcome.status) {
        case 'confirmed':
          return signature;
        case 'failed': {
          const program = parseProgramError(outcome.error);
          throw new WalletActionError(
            'onchain',
            program?.message ?? JSON.stringify(outcome.error),
            signature,
          );
        }
        case 'expired':
          throw new WalletActionError('expired', 'Blockhash expired', signature);
        case 'timeout':
          throw new WalletActionError('timeout', 'Not confirmed in time', signature);
      }
    },
    [connection, mwa],
  );

  const signMessage = useCallback(
    async (message: Uint8Array) => {
      try {
        return await mwa.signMessage(message);
      } catch (error) {
        throw new WalletActionError(classifyWalletError(error), errorDetail(error));
      }
    },
    [mwa],
  );

  const disconnect = useCallback(async () => {
    if (kind === 'pollar') await pollar?.logout();
    else await mwa.disconnect().catch(() => undefined);
    guardian.token = undefined;
    await clearWalletSession();
    queryClient.clear();
    useSettings.getState().reset();
  }, [kind, pollar, mwa, queryClient]);

  const value = useMemo<WalletApi>(
    () => ({
      kind,
      address,
      connection,
      connectWallet,
      disconnect,
      signAndConfirm,
      signMessage,
      pollar,
    }),
    [kind, address, connection, connectWallet, disconnect, signAndConfirm, signMessage, pollar],
  );

  return <WalletContext value={value}>{children}</WalletContext>;
}
