/**
 * Collector 2: the recipient's mainnet history through Helius. Scam
 * wallets live on mainnet, so this looks there even while the HOLDBACK
 * program runs on devnet; an address is the same key on both.
 */
import { CollectorUnavailable } from '../errors';
import { postJson, requestJson } from '../lib/http';
import type { Signal } from '../signals';
import type { BlocklistStore } from '../store/types';
import {
  counterparties,
  firstFunder,
  inboundCounts,
  isBurstActivity,
  isDustSprayer,
  isInstantDrain,
  isSweepPattern,
  transfersOf,
  type ParsedTx,
} from './heuristics';
import type { Collector } from './types';

const HELIUS_API = 'https://mainnet.helius-rpc.com';
/** Parsed transactions the heuristics look at (the endpoint's maximum). */
export const PARSED_TX_LIMIT = 100;
/** Signature pages walked to find the wallet's first transaction. */
export const SIGNATURE_PAGES = 3;
export const SIGNATURE_PAGE_SIZE = 1_000;
const CACHE_TTL_SECS = 15 * 60;

/** Wallet age and activity that count as established. */
export const ESTABLISHED_AGE_SECS = 180 * 86_400;
export const ESTABLISHED_MIN_TXS = 50;
export const NEW_WALLET_1D_SECS = 86_400;
export const NEW_WALLET_7D_SECS = 7 * 86_400;
/** Earlier transfers from the sender that count as an existing relationship. */
export const PRIOR_HISTORY_MIN_TRANSFERS = 2;
/** Senders kept in the cached profile for the prior-history check. */
const MAX_CACHED_SENDERS = 300;

/** What is cached per recipient. It holds nothing about the sender. */
export interface WalletProfile {
  /** Signatures seen; a lower bound when `ageKnown` is false. */
  txCount: number;
  /** Unix seconds of the oldest signature seen. */
  firstSeen: number | null;
  /** True when the signature walk reached the wallet's first transaction. */
  ageKnown: boolean;
  firstFunder: string | null;
  sweepPattern: boolean;
  instantDrain: boolean;
  dustSprayer: boolean;
  /** Timestamps of the parsed window, for the burst check. */
  recentTimestamps: number[];
  counterparties: string[];
  inboundBySender: Record<string, number>;
}

interface SignatureInfo {
  signature: string;
  blockTime?: number | null;
}

async function rpc(apiKey: string, method: string, params: unknown[]): Promise<unknown> {
  const answer = (await postJson(
    `${HELIUS_API}/?api-key=${apiKey}`,
    { jsonrpc: '2.0', id: 1, method, params },
    { timeoutMs: 5_000 },
  )) as { result?: unknown; error?: { message?: string } };
  if (answer.error) throw new Error(`Helius RPC ${method} failed`);
  return answer.result;
}

/** Walks signatures newest to oldest until the first transaction or the page budget. */
async function walkSignatures(apiKey: string, address: string) {
  let before: string | undefined;
  let count = 0;
  let oldest: SignatureInfo | null = null;
  for (let page = 0; page < SIGNATURE_PAGES; page++) {
    const batch = (await rpc(apiKey, 'getSignaturesForAddress', [
      address,
      { limit: SIGNATURE_PAGE_SIZE, ...(before ? { before } : {}) },
    ])) as SignatureInfo[];
    count += batch.length;
    oldest = batch[batch.length - 1] ?? oldest;
    if (batch.length < SIGNATURE_PAGE_SIZE) return { count, oldest, reachedStart: true };
    before = oldest?.signature;
  }
  return { count, oldest, reachedStart: false };
}

async function parsedHistory(apiKey: string, address: string): Promise<ParsedTx[]> {
  const url = `${HELIUS_API}/v0/addresses/${address}/transactions?api-key=${apiKey}&limit=${PARSED_TX_LIMIT}`;
  return (await requestJson(url, { timeoutMs: 5_000 })) as ParsedTx[];
}

async function parseOne(apiKey: string, signature: string): Promise<ParsedTx | null> {
  const parsed = (await postJson(
    `${HELIUS_API}/v0/transactions?api-key=${apiKey}`,
    { transactions: [signature] },
    { timeoutMs: 4_000 },
  )) as ParsedTx[];
  return parsed[0] ?? null;
}

export async function loadProfile(apiKey: string, address: string): Promise<WalletProfile> {
  const [signatures, transactions] = await Promise.all([
    walkSignatures(apiKey, address),
    parsedHistory(apiKey, address),
  ]);
  const transfers = transfersOf(address, transactions);

  // The first funder is only meaningful when the wallet's first transaction
  // is known. It is in the parsed window for young wallets; otherwise it is
  // fetched on its own.
  let funder: string | null = null;
  if (signatures.reachedStart && signatures.oldest) {
    const inWindow = transactions.some((tx) => tx.signature === signatures.oldest!.signature);
    const firstTx = inWindow
      ? transactions.filter((tx) => tx.signature === signatures.oldest!.signature)
      : [await parseOne(apiKey, signatures.oldest.signature).catch(() => null)].filter(
          (tx): tx is ParsedTx => tx !== null,
        );
    funder = firstFunder(address, transfersOf(address, firstTx));
  }

  const bySender = Object.entries(inboundCounts(address, transfers))
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CACHED_SENDERS);

  return {
    txCount: signatures.count,
    firstSeen: signatures.oldest?.blockTime ?? null,
    ageKnown: signatures.reachedStart,
    firstFunder: funder,
    sweepPattern: isSweepPattern(address, transfers),
    instantDrain: isInstantDrain(address, transfers),
    dustSprayer: isDustSprayer(address, transfers),
    recentTimestamps: transactions.map((tx) => tx.timestamp),
    counterparties: counterparties(address, transfers),
    inboundBySender: Object.fromEntries(bySender),
  };
}

const days = (secs: number) => Math.max(1, Math.round(secs / 86_400));

/** Pure mapping from a profile to signals. `listed` are counterparties found on a list. */
export function profileSignals(
  profile: WalletProfile,
  sender: string,
  nowSecs: number,
  listed: Set<string>,
): Signal[] {
  const source = 'helius' as const;
  const signals: Signal[] = [];
  if (profile.txCount === 0) {
    return [
      { source, signal: 'no_history', detail: 'This address has no transactions on mainnet.' },
    ];
  }

  const ageSecs = profile.ageKnown && profile.firstSeen ? nowSecs - profile.firstSeen : null;
  if (ageSecs !== null && ageSecs < NEW_WALLET_1D_SECS) {
    signals.push({
      source,
      signal: 'wallet_new_1d',
      detail: 'The wallet made its first mainnet transaction less than a day ago.',
    });
  } else if (ageSecs !== null && ageSecs < NEW_WALLET_7D_SECS) {
    signals.push({
      source,
      signal: 'wallet_new_7d',
      detail: `The wallet made its first mainnet transaction ${days(ageSecs)} day(s) ago.`,
    });
  }

  const heuristics: [boolean, string, string][] = [
    [
      profile.sweepPattern,
      'sweep_pattern',
      'Many different wallets pay in and nearly everything is forwarded to one or two wallets.',
    ],
    [
      profile.instantDrain,
      'instant_drain',
      'Most deposits are moved out again within ten minutes.',
    ],
    [
      profile.dustSprayer,
      'dust_sprayer',
      'The wallet sends tiny amounts of SOL to many different wallets.',
    ],
    [
      isBurstActivity(ageSecs, profile.txCount, profile.recentTimestamps),
      'burst_activity',
      `The wallet has ${profile.txCount} transactions, far more than its age explains.`,
    ],
  ];
  for (const [fired, signal, detail] of heuristics) {
    if (fired) signals.push({ source, signal, detail });
  }

  if (profile.firstFunder && listed.has(profile.firstFunder)) {
    signals.push({
      source,
      signal: 'funded_by_known_bad',
      detail: `The wallet was first funded by ${profile.firstFunder}, which is on a scam or sanctions list.`,
    });
  }
  const badCounterparties = profile.counterparties.filter(
    (address) => listed.has(address) && address !== profile.firstFunder,
  );
  if (badCounterparties.length > 0) {
    signals.push({
      source,
      signal: 'known_bad_counterparty',
      detail: `The wallet transacted with ${badCounterparties.length} listed address(es), including ${badCounterparties[0]}.`,
    });
  }

  const priorTransfers = profile.inboundBySender[sender] ?? 0;
  if (priorTransfers >= PRIOR_HISTORY_MIN_TRANSFERS) {
    signals.push({
      source,
      signal: 'prior_history_with_sender',
      detail: `The sender paid this wallet ${priorTransfers} times in its recent mainnet history.`,
    });
  }

  const risky = signals.some((signal) => signal.signal !== 'prior_history_with_sender');
  const established =
    profile.txCount >= ESTABLISHED_MIN_TXS &&
    // A wallet whose first transaction is beyond the walk is older than anything fetched.
    (!profile.ageKnown || (ageSecs !== null && ageSecs >= ESTABLISHED_AGE_SECS));
  if (established && !risky) {
    signals.push({
      source,
      signal: 'wallet_established',
      detail: profile.ageKnown
        ? `The wallet has been active for ${days(ageSecs!)} days with ${profile.txCount} transactions.`
        : `The wallet has more than ${profile.txCount} transactions.`,
    });
  }
  return signals;
}

async function listedAmong(store: BlocklistStore, addresses: string[]): Promise<Set<string>> {
  if (addresses.length === 0) return new Set();
  try {
    return new Set((await store.lookupAddresses(addresses)).map((hit) => hit.value));
  } catch {
    return new Set();
  }
}

export const heliusCollector: Collector = {
  name: 'helius',
  timeoutMs: 7_000,
  cacheTtlSecs: CACHE_TTL_SECS,
  async collect({ services, subject, now }) {
    const apiKey = services.env.HELIUS_API_KEY;
    if (!apiKey) throw new CollectorUnavailable('HELIUS_API_KEY is not set');
    const profile = await services.cache.wrap('helius', subject.recipient, CACHE_TTL_SECS, () =>
      loadProfile(apiKey, subject.recipient),
    );
    const candidates = [...profile.counterparties];
    if (profile.firstFunder) candidates.push(profile.firstFunder);
    const listed = await listedAmong(services.storage.blocklists, candidates);
    return profileSignals(profile, subject.sender, Math.floor(now.getTime() / 1000), listed);
  },
};
