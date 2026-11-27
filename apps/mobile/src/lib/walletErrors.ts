/**
 * Sorting wallet failures into the three things the UI treats differently:
 * the user backed out (not an error), no wallet app is installed, or
 * something actually went wrong.
 */

export type WalletFailure = 'cancelled' | 'no_wallet' | 'failed';

const CANCEL_CODES = new Set(['ERROR_ASSOCIATION_CANCELLED', 'ERROR_AUTHORIZATION_FAILED']);
/** Mobile Wallet Adapter JSON-RPC codes: authorization failed and "not signed" (user declined). */
const DECLINED_RPC_CODES = new Set([-1, -3]);

function textOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return '';
}

export function classifyWalletError(error: unknown): WalletFailure {
  const code = (error as { code?: unknown } | null)?.code;
  const message = textOf(error);

  if (typeof code === 'string' && CANCEL_CODES.has(code)) return 'cancelled';
  if (typeof code === 'number' && DECLINED_RPC_CODES.has(code)) return 'cancelled';
  if (
    /CancellationException|cancelled by user|user (declined|rejected|canceled|cancelled)/i.test(
      message,
    )
  ) {
    return 'cancelled';
  }
  if (code === 'ERROR_WALLET_NOT_FOUND' || /no installed wallet|wallet.*not found/i.test(message)) {
    return 'no_wallet';
  }
  return 'failed';
}

export function isUserCancellation(error: unknown): boolean {
  return classifyWalletError(error) === 'cancelled';
}

/** The message of any thrown value, for the detail line under a localized headline. */
export function errorDetail(error: unknown): string {
  return textOf(error) || 'Unknown error';
}

/** Why a wallet action did not complete, in terms the UI can explain. */
export type ActionFailure =
  | WalletFailure
  /** The blockhash expired before the transaction landed; nothing happened. */
  | 'expired'
  /** Not confirmed in time; the outcome is unknown. */
  | 'timeout'
  /** Landed and failed on-chain; `detail` carries the program's message when there is one. */
  | 'onchain'
  /** This kind of wallet cannot do this action. */
  | 'unsupported';

export class WalletActionError extends Error {
  constructor(
    readonly kind: ActionFailure,
    readonly detail: string,
    readonly signature: string | null = null,
  ) {
    super(detail);
    this.name = 'WalletActionError';
  }
}
