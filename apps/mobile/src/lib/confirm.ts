/**
 * Transaction confirmation by polling signature status.
 *
 * A wallet returning a signature only means the transaction was submitted.
 * It can still fail on-chain or never land. This polls until the cluster
 * reports the transaction confirmed, reports an error, or the blockhash it
 * was built with has expired (after which it can never land).
 */

export interface SignatureStatus {
  confirmationStatus?: 'processed' | 'confirmed' | 'finalized';
  err: unknown;
}

/** The two RPC calls confirmation needs; a web3.js `Connection` satisfies it. */
export interface StatusSource {
  getSignatureStatuses(
    signatures: string[],
    config?: { searchTransactionHistory: boolean },
  ): Promise<{ value: (SignatureStatus | null)[] }>;
  getBlockHeight(commitment?: 'confirmed'): Promise<number>;
}

export type Confirmation =
  | { status: 'confirmed' }
  /** Landed and failed: `error` is the RPC `err` value. */
  | { status: 'failed'; error: unknown }
  /** The blockhash expired before the transaction landed. Safe to build a new one. */
  | { status: 'expired' }
  /** Still unknown after `timeoutMs`. Not safe to assume either outcome. */
  | { status: 'timeout' };

export interface ConfirmOptions {
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function confirmSignature(
  source: StatusSource,
  signature: string,
  lastValidBlockHeight: number | null,
  options: ConfirmOptions = {},
): Promise<Confirmation> {
  const intervalMs = options.intervalMs ?? 1_000;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const deadline = now() + timeoutMs;

  for (;;) {
    const status = await readStatus(source, signature);
    if (status?.err) return { status: 'failed', error: status.err };
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return { status: 'confirmed' };
    }

    if (!status && lastValidBlockHeight !== null) {
      const height = await source.getBlockHeight('confirmed').catch(() => null);
      if (height !== null && height > lastValidBlockHeight) {
        // One last look: it may have landed in the final valid block.
        const last = await readStatus(source, signature);
        if (last?.err) return { status: 'failed', error: last.err };
        if (last) return { status: 'confirmed' };
        return { status: 'expired' };
      }
    }

    if (now() >= deadline) return { status: 'timeout' };
    await sleep(intervalMs);
  }
}

/** A failed status request is treated as "not known yet" so one RPC hiccup does not end the wait. */
async function readStatus(
  source: StatusSource,
  signature: string,
): Promise<SignatureStatus | null> {
  try {
    const response = await source.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    return response.value[0] ?? null;
  } catch {
    return null;
  }
}
