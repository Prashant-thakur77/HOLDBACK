/** The JSON shape of a hold as tools return it, from the chain or from the mirror. */
import {
  HoldOrigin,
  HoldStatus,
  STATUS_NAMES,
  Tier,
  explain,
  formatAmount,
  fromHex,
  tierName,
  toHex,
  type Hold,
  type HoldRecord,
} from '@holdback/sdk';
import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';

import type { AssetRegistry } from './assets';
import { tier } from './schemas';

export const holdShape = {
  source: z
    .enum(['chain', 'guardian_mirror'])
    .describe(
      'chain: read from the hold account itself. guardian_mirror: the account is closed or ' +
        'unreachable, so this is the risk service’s off-chain copy.',
    ),
  address: z.string(),
  sender: z.string(),
  recipient: z.string(),
  mint: z.string().describe('"SOL" or the token mint address.'),
  amount: z.string().nullable().describe('Display units; null when the mint cannot be read.'),
  amountBaseUnits: z.string(),
  symbol: z.string().nullable(),
  tier,
  status: z.enum(STATUS_NAMES),
  origin: z.enum(['WALLET', 'DEPOSIT_BOX']),
  createdAt: z.string().describe('ISO 8601.'),
  releaseAt: z.string().describe('ISO 8601. Until then the sender can undo.'),
  secondsRemaining: z.number().describe('Seconds of undo window left; 0 once it is over.'),
  canUndo: z.boolean().describe('True while undo_payment can still bring the money back.'),
  evidenceHash: z.string().describe('Hex sha256 of the evidence document behind the window.'),
  summary: z.string().describe('One plain sentence describing where the hold stands.'),
};

export type HoldView = z.infer<z.ZodObject<typeof holdShape>>;

const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString();

async function view(
  hold: Hold,
  source: HoldView['source'],
  assets: AssetRegistry,
  now: number,
): Promise<HoldView> {
  // A hold stays readable even when its mint is not: the amount is then
  // reported in base units only.
  const asset = await assets.forMint(hold.mint).catch(() => null);
  const pending = hold.status === HoldStatus.PENDING;
  return {
    source,
    address: hold.address.toBase58(),
    sender: hold.sender.toBase58(),
    recipient: hold.recipient.toBase58(),
    mint: hold.isSol ? 'SOL' : hold.mint.toBase58(),
    amount: asset ? formatAmount(hold.amount, asset.decimals) : null,
    amountBaseUnits: hold.amount.toString(),
    symbol: asset?.symbol ?? null,
    tier: tierName(hold.tier),
    status: STATUS_NAMES[hold.status],
    origin: hold.origin === HoldOrigin.DEPOSIT_BOX ? 'DEPOSIT_BOX' : 'WALLET',
    createdAt: iso(hold.createdAt),
    releaseAt: iso(hold.releaseAt),
    secondsRemaining: pending ? Math.max(0, hold.releaseAt - now) : 0,
    canUndo: pending && now < hold.releaseAt,
    evidenceHash: toHex(hold.evidenceHash),
    summary: explain(
      hold,
      asset ? { now, symbol: asset.symbol, decimals: asset.decimals } : { now },
    ),
  };
}

export function viewChainHold(hold: Hold, assets: AssetRegistry, now: number): Promise<HoldView> {
  return view(hold, 'chain', assets, now);
}

/**
 * Renders the Guardian's off-chain copy in the same shape as a chain hold.
 * The mirror does not record the rent payer, nonce or bump; they are only
 * needed to build settle instructions, which a mirrored (closed) hold can no
 * longer take, so they are left at their zero values and never returned.
 */
export function viewMirrorHold(
  record: HoldRecord,
  assets: AssetRegistry,
  now: number,
): Promise<HoldView> {
  const mint = record.mint ? new PublicKey(record.mint) : PublicKey.default;
  const hold: Hold = {
    address: new PublicKey(record.pda),
    sender: new PublicKey(record.sender),
    recipient: new PublicKey(record.recipient),
    mint,
    amount: BigInt(record.amount),
    createdAt: Math.floor(Date.parse(record.createdAt) / 1000),
    releaseAt: Math.floor(Date.parse(record.releaseAt) / 1000),
    tier: Tier[record.tier],
    evidenceHash: fromHex(record.evidenceHash),
    origin: HoldOrigin[record.origin],
    status: HoldStatus[record.status],
    rentPayer: PublicKey.default,
    nonce: 0n,
    bump: 0,
    isSol: record.mint === null,
  };
  return view(hold, 'guardian_mirror', assets, now);
}
