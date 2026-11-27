import type { GuardianClient } from '@holdback/sdk';
import { PublicKey, type Connection, type Keypair } from '@solana/web3.js';

import type { AssetRegistry } from './assets';
import { ToolError } from './errors';

/** The Guardian calls this server makes; `GuardianClient` satisfies it. */
export type Guardian = Pick<GuardianClient, 'assess' | 'receipt' | 'holds' | 'evidence'>;

/** Everything the tools depend on. The binary builds it from env; tests inject fakes. */
export interface ServerDeps {
  connection: Connection;
  /** `null` when `HOLDBACK_GUARDIAN_URL` is not set. */
  guardian: Guardian | null;
  /** The wallet this server signs with, or `null` to hand back unsigned transactions. */
  signer: Keypair | null;
  /** Per-payment cap in display units of the asset being sent, or `null`. */
  maxAmount: string | null;
  /** Unix seconds. Defaults to the local clock. */
  now?: () => number;
}

/** What every tool module receives. */
export interface ToolContext {
  deps: ServerDeps;
  assets: AssetRegistry;
}

export function nowSeconds(deps: ServerDeps): number {
  return deps.now ? deps.now() : Math.floor(Date.now() / 1000);
}

/**
 * Payments are only as safe as the assessment behind them, so tools that
 * need the Guardian stop here instead of continuing without one.
 */
export function requireGuardian(deps: ServerDeps): Guardian {
  if (!deps.guardian) {
    throw new ToolError(
      'guardian_unavailable',
      'No risk service is configured. Set HOLDBACK_GUARDIAN_URL and restart the server.',
    );
  }
  return deps.guardian;
}

export function parseAddress(value: string, field: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new ToolError('invalid_address', `${field} is not a valid Solana address`);
  }
}

/**
 * Decides which wallet a tool acts for.
 *
 * With a configured keypair that wallet is the only possible actor: naming a
 * different one is refused rather than silently ignored, so a caller can
 * never believe it paid from a wallet it did not. Without a keypair the
 * caller must say whose transaction to build.
 */
export function resolveActor(
  deps: ServerDeps,
  given: string | undefined,
  field: string,
): PublicKey {
  if (deps.signer) {
    const own = deps.signer.publicKey;
    if (given !== undefined && !parseAddress(given, field).equals(own)) {
      throw new ToolError(
        'wallet_mismatch',
        `This server signs as ${own.toBase58()}. Omit ${field} or pass that address.`,
      );
    }
    return own;
  }
  if (given === undefined) {
    throw new ToolError(
      'wallet_required',
      `No signing key is configured, so ${field} is required: pass the wallet that will sign.`,
    );
  }
  return parseAddress(given, field);
}
