import type { HoldRecord } from '@holdback/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { config, hasSupabase } from '@/config';
import { recordFromRow, upsertRecord } from '@/lib/holds';
import { useWallet } from '@/wallet/WalletContext';
import { useWalletSession } from '@/wallet/walletSession';

import type { HoldList } from './holds';
import { queryKeys } from './keys';

/** A Supabase client that authenticates as the wallet in `token`. Nothing is persisted. */
function clientFor(token: string): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    accessToken: async () => token,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Subscribes to changes of this wallet's rows in `holds` and writes them
 * straight into the query cache, so a countdown appears, extends or settles
 * the moment the chain event is mirrored. Returns whether the channel is
 * live; callers keep polling while it is not.
 *
 * Needs a Supabase project and a wallet session (row-level security only
 * shows a wallet its own holds). Without either this stays `false`.
 */
export function useHoldsRealtime(): boolean {
  const { address } = useWallet();
  const session = useWalletSession((state) => state.session);
  const queryClient = useQueryClient();
  const [live, setLive] = useState(false);
  const wallet = address?.toBase58() ?? null;
  const token = session && session.wallet === wallet ? session.token : null;

  useEffect(() => {
    if (!hasSupabase || !wallet || !token) return;
    const supabase = clientFor(token);

    const apply = (row: unknown) => {
      const record = recordFromRow(row);
      if (!record) return;
      const put = (role: 'sender' | 'recipient') =>
        queryClient.setQueryData<HoldList>(queryKeys.holds(wallet, role), (current) =>
          current ? { ...current, records: upsertRecord(current.records, record) } : current,
        );
      if (record.sender === wallet) put('sender');
      if (record.recipient === wallet) put('recipient');
      // The detail screen also shows evidence, so it refetches instead of patching.
      void queryClient.invalidateQueries({ queryKey: queryKeys.hold(record.pda) });
    };

    const channel = supabase
      .channel(`holds:${wallet}`)
      .on<HoldRecord>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'holds', filter: `sender=eq.${wallet}` },
        (change) => apply(change.new),
      )
      .on<HoldRecord>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'holds', filter: `recipient=eq.${wallet}` },
        (change) => apply(change.new),
      )
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));

    return () => {
      setLive(false);
      void supabase.removeChannel(channel);
    };
  }, [wallet, token, queryClient]);

  return live;
}
