/**
 * Collector 1: reputation that only HOLDBACK has. The program counts, per
 * recipient, how many holds it received, how many were pulled back and how
 * many flags it carries; and the sender may hold a `Trust` account for it.
 */
import { PublicKey } from '@solana/web3.js';
import { fetchSubjectStats, isTrusted } from '@holdback/sdk';

import { countOffchainFlags } from '../db/flags';
import type { Signal } from '../signals';
import type { Collector } from './types';

/** Holds a recipient must have received before its undo ratio means anything. */
export const MIN_HOLDS_FOR_RATIO = 3;
export const RECLAIM_MAJORITY_RATIO = 0.5;
export const RECLAIM_OFTEN_RATIO = 0.25;
/** Completed payments, with no undo and no flag, that count as a clean record. */
export const CLEAN_RELEASES_MIN = 5;

export interface ReputationFacts {
  trusted: boolean;
  flags: number;
  holdsReceived: number;
  holdsReclaimedAgainst: number;
  holdsReleasedTo: number;
  /** `null` when the database could not be asked. */
  offchainFlags: number | null;
}

/** Pure mapping from counters to signals, shared with the tests. */
export function reputationSignals(facts: ReputationFacts): Signal[] {
  const source = 'onchain_reputation' as const;
  const signals: Signal[] = [];
  if (facts.trusted) {
    signals.push({
      source,
      signal: 'trust_account',
      detail: 'The sender has an on-chain trust record for this recipient.',
    });
  }
  if (facts.flags > 0) {
    signals.push({
      source,
      signal: 'onchain_flags',
      value: facts.flags,
      detail: `${facts.flags} HOLDBACK user(s) flagged this address on-chain.`,
    });
  } else {
    signals.push({
      source,
      signal: 'no_onchain_flags',
      detail: 'No on-chain flags against this address.',
    });
  }
  const { holdsReceived: received, holdsReclaimedAgainst: reclaimed } = facts;
  if (received >= MIN_HOLDS_FOR_RATIO) {
    const ratio = reclaimed / received;
    const detail = `Senders pulled back ${reclaimed} of ${received} payments held for this address.`;
    if (ratio >= RECLAIM_MAJORITY_RATIO) {
      signals.push({ source, signal: 'reclaimed_majority', detail });
    } else if (ratio >= RECLAIM_OFTEN_RATIO) {
      signals.push({ source, signal: 'reclaimed_often', detail });
    }
  }
  if (facts.holdsReleasedTo >= CLEAN_RELEASES_MIN && reclaimed === 0 && facts.flags === 0) {
    signals.push({
      source,
      signal: 'clean_releases',
      detail: `${facts.holdsReleasedTo} payments to this address completed and none was undone.`,
    });
  }
  if (facts.offchainFlags !== null) {
    signals.push(
      facts.offchainFlags > 0
        ? {
            source,
            signal: 'offchain_flags',
            value: facts.offchainFlags,
            detail: `${facts.offchainFlags} report(s) about this address were sent to HOLDBACK.`,
          }
        : {
            source,
            signal: 'no_offchain_flags',
            detail: 'No reports about this address were sent to HOLDBACK.',
          },
    );
  }
  return signals;
}

export const onchainCollector: Collector = {
  name: 'onchain_reputation',
  timeoutMs: 3_500,
  cacheTtlSecs: null,
  async collect({ services, subject }) {
    const { cluster, programId, db } = services;
    const sender = new PublicKey(subject.sender);
    const recipient = new PublicKey(subject.recipient);
    const [trusted, stats, offchainFlags] = await Promise.all([
      isTrusted(cluster, sender, recipient, { programId }),
      fetchSubjectStats(cluster, recipient, { programId }),
      db ? countOffchainFlags(db, subject.recipient).catch(() => null) : Promise.resolve(null),
    ]);
    return reputationSignals({
      trusted,
      flags: stats?.flags ?? 0,
      holdsReceived: stats?.holdsReceived ?? 0,
      holdsReclaimedAgainst: stats?.holdsReclaimedAgainst ?? 0,
      holdsReleasedTo: stats?.holdsReleasedTo ?? 0,
      offchainFlags,
    });
  },
};
