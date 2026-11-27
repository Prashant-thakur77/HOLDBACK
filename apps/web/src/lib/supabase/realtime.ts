/**
 * Realtime subscription to the `holds` mirror for one wallet. Row-level
 * security only delivers rows where the wallet in the session JWT is the
 * sender or the recipient, so this is useless (and silent) without a session.
 */
import type { HoldRecord } from '@holdback/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';

import { rowToRecord } from '../holds';
import { setSupabaseSession } from './browser';

export type HoldsRole = 'sender' | 'recipient';

export type HoldsChannelStatus = 'connecting' | 'live' | 'failed' | 'closed';

export interface HoldsSubscription {
  supabase: SupabaseClient;
  wallet: string;
  role: HoldsRole;
  /** Wallet-session JWT from the agent. */
  token: string;
  /** A hold was created or changed. */
  onRecord: (record: HoldRecord) => void;
  /** A hold was removed, or a row could not be read: the caller should refetch. */
  onStale: () => void;
  onStatus?: (status: HoldsChannelStatus) => void;
}

/** Starts the subscription and returns the function that ends it. */
export function subscribeToHolds(options: HoldsSubscription): () => void {
  const { supabase, wallet, role, token, onRecord, onStale, onStatus } = options;
  let closed = false;
  onStatus?.('connecting');

  const channel = supabase
    .channel(`holds:${role}:${wallet}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'holds', filter: `${role}=eq.${wallet}` },
      (payload) => {
        if (payload.eventType === 'DELETE') return onStale();
        const record = rowToRecord(payload.new);
        if (record) onRecord(record);
        else onStale();
      },
    );

  // The token must be on the socket before the channel joins, or the join is
  // authorised as anonymous and row-level security filters everything out.
  void setSupabaseSession(token)
    .then(() => {
      if (closed) return;
      channel.subscribe((status) => {
        if (closed) return;
        if (status === 'SUBSCRIBED') onStatus?.('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onStatus?.('failed');
        else if (status === 'CLOSED') onStatus?.('closed');
      });
    })
    .catch(() => onStatus?.('failed'));

  return () => {
    closed = true;
    void supabase.removeChannel(channel);
  };
}
