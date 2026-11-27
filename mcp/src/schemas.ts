/** Zod pieces shared by several tools, so every tool words them identically. */
import { LANGS, TIER_NAMES } from '@holdback/sdk';
import { z } from 'zod';

export const address = (what: string) =>
  z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'must be a base58 Solana address')
    .describe(what);

export const mint = z
  .string()
  .min(3)
  .describe(
    'The asset to pay in: the literal "SOL" for native SOL, or the base58 address of an SPL ' +
      'Token / Token-2022 mint (devnet USDC is 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU).',
  );

export const amount = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'must be a plain decimal such as "12.5"')
  .describe(
    'Amount in whole display units of the asset, as a decimal string: "12.5" means 12.5 USDC ' +
      'or 12.5 SOL. Never base units (lamports).',
  );

export const lang = z
  .enum(LANGS)
  .default('en')
  .describe('Language for the spoken explanation: en, hi, es or pt.');

export const context = z
  .string()
  .max(1000)
  .optional()
  .describe(
    'Why this payment is being made, in the words of whoever asked for it (for example the ' +
      'message that requested the money). The risk service scores it for pressure tactics ' +
      'such as urgency, secrecy or impersonation. Pass it whenever you have it.',
  );

export const tier = z
  .enum(TIER_NAMES)
  .describe(
    'Risk tier. TRUSTED: the sender trusts this recipient, no wait. UNKNOWN: nothing known, ' +
      'short undo window. SUSPICIOUS: warning signs. FLAGGED: reported for scams. ' +
      'SANCTIONED: on a sanctions list, payment refused.',
  );

/** The outcome of a tool that changes chain state. */
export const submission = {
  status: z
    .enum(['sent', 'needs_signature', 'no_change'])
    .describe(
      'sent: signed by this server and confirmed on-chain. needs_signature: nothing happened ' +
        'yet; `unsignedTransaction` must be signed by `requiredSigner` and sent. no_change: ' +
        'the chain was already in the requested state, so nothing was built.',
    ),
  signature: z.string().nullable().describe('Transaction signature when status is sent.'),
  unsignedTransaction: z
    .string()
    .nullable()
    .describe(
      'Base64 of an unsigned versioned transaction when status is needs_signature. Pass it to ' +
        'the wallet of `requiredSigner` to sign and send. It expires after `lastValidBlockHeight` ' +
        '(roughly one minute).',
    ),
  requiredSigner: z.string().describe('The wallet that signs (or signed) this transaction.'),
  lastValidBlockHeight: z.number().nullable(),
};
