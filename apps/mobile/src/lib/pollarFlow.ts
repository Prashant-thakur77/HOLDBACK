/**
 * The Pollar payment flow as a state machine.
 *
 * A Pollar wallet can send SOL or tokens to an address and nothing else: it
 * cannot sign a program instruction or a message. So a Pollar user:
 *
 *   1. proves they own the wallet by sending a small, exact amount into their
 *      own deposit box (`relayAuthStart` → transfer → `relayAuthComplete`),
 *   2. pays by sending the amount into the same deposit box, after which the
 *      relayer opens the hold (`relayOpen`),
 *   3. undoes or withdraws through the relayer (`relayReclaim`, `relayWithdraw`).
 *
 * On-chain, money in a deposit box can only go to a hold whose sender is the
 * box owner or back to the owner, which is why the transfer in step 1 is not a
 * fee: it stays the user's money and counts towards their next payment.
 *
 * This module has no React and no network code of its own; the Pollar client
 * and the agent client are passed in, so the whole flow runs in tests.
 */
import type {
  Lang,
  RelayAuthStart,
  RelayOpenRequest,
  RelayOpenResponse,
  RelaySession,
} from '@holdback/sdk';

/** The agent calls the flow makes. `GuardianClient` satisfies this. */
export interface RelayApi {
  relayAuthStart(owner: string, mint: string): Promise<RelayAuthStart>;
  relayAuthComplete(body: {
    challengeId: string;
    secret: string;
    signature: string;
  }): Promise<RelaySession>;
  relayOpen(body: RelayOpenRequest): Promise<RelayOpenResponse>;
  relayReclaim(hold: string): Promise<{ signature: string }>;
  relayWithdraw(mint: string, amount: string): Promise<{ signature: string }>;
}

export interface TransferRequest {
  destination: string;
  /** Base units, as a decimal string. */
  amount: string;
  mint: string;
}

/** What a Pollar `sendPayment` call came to, reduced to what the flow acts on. */
export type TransferResult =
  /** Submitted; `hash` is the transaction signature. `settled` is false while it is still pending. */
  | { status: 'sent'; hash: string; settled: boolean }
  /** Pollar refused or the transaction failed. Nothing moved. */
  | { status: 'rejected'; message: string }
  /** Waiting for the user to approve on another device; there is no signature yet. */
  | { status: 'needs_approval' };

/** Everything needed to keep paying without proving ownership again. Stored on the device. */
export interface PollarSession {
  token: string;
  owner: string;
  expiresAt: string;
  mint: string;
  depositBox: string;
  boxTokenAccount: string;
}

export type PollarActivity =
  | 'idle'
  | 'auth_challenge'
  | 'auth_transfer'
  | 'auth_verify'
  | 'deposit'
  | 'awaiting_funds'
  | 'opening'
  | 'reclaiming'
  | 'withdrawing';

export type PollarFlowErrorCode =
  | 'busy'
  | 'not_authenticated'
  | 'session_expired'
  /** Pollar refused both the deposit box address and its token account. */
  | 'deposit_rejected'
  | 'needs_approval'
  /** The transfer call itself threw (network, signed out). Whether money moved is unknown. */
  | 'transfer_failed'
  /** The transfer was sent but the money did not show up in the box in time. */
  | 'funds_not_arrived'
  | 'agent_error';

export class PollarFlowError extends Error {
  constructor(
    readonly code: PollarFlowErrorCode,
    message: string,
    /** Signature of a transfer that did go through before the failure, if any. */
    readonly transferHash: string | null = null,
  ) {
    super(message);
    this.name = 'PollarFlowError';
  }
}

export interface PollarFlowState {
  session: PollarSession | null;
  activity: PollarActivity;
  error: PollarFlowError | null;
}

export interface PollarFlowDeps {
  api: RelayApi;
  /** Makes the Pollar transfer. */
  transfer(request: TransferRequest): Promise<TransferResult>;
  /** Puts the relay session token on the agent client (or clears it with `null`). */
  setToken(token: string | null): void;
  /** Token balance of the deposit box in base units, or `null` when it cannot be read. */
  boxBalance(tokenAccount: string): Promise<bigint | null>;
  /** Called whenever the session changes, to persist or delete it. */
  persist?(session: PollarSession | null): void | Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SendRequest {
  recipient: string;
  /** Base units. */
  amount: bigint;
  context?: string;
  lang: Lang;
  windowSecs?: number;
}

/** How often and how long to wait for a transfer to show up on-chain. */
const POLL_INTERVAL_MS = 1_500;
const POLL_ATTEMPTS = 20;
/** The agent checks the proof transfer on-chain; a just-sent one may need a moment. */
const VERIFY_ATTEMPTS = 6;

type Listener = (state: PollarFlowState) => void;

export class PollarFlow {
  private state: PollarFlowState;
  private readonly listeners = new Set<Listener>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly deps: PollarFlowDeps,
    initial: PollarSession | null = null,
  ) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const session = initial && !this.expired(initial) ? initial : null;
    this.state = { session, activity: 'idle', error: null };
    if (session) deps.setToken(session.token);
  }

  /** Adopts a session read from storage. Ignored when it has expired or something is running. */
  restore(session: PollarSession): boolean {
    if (this.state.activity !== 'idle' || this.expired(session)) return false;
    this.deps.setToken(session.token);
    this.set({ session, error: null });
    return true;
  }

  getState = (): PollarFlowState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Proof-by-transfer login. Resolves with the session; rejects with a `PollarFlowError`. */
  authenticate(owner: string, mint: string): Promise<PollarSession> {
    return this.run('auth_challenge', async () => {
      const challenge = await this.agent(() => this.deps.api.relayAuthStart(owner, mint));

      this.set({ activity: 'auth_transfer' });
      const hash = await this.transferToBox(challenge, {
        amount: challenge.amount,
        mint: challenge.mint,
      });

      this.set({ activity: 'auth_verify' });
      const granted = await this.completeAuth(challenge, hash);
      const session: PollarSession = {
        token: granted.token,
        owner: granted.owner,
        expiresAt: granted.expiresAt,
        mint: challenge.mint,
        depositBox: challenge.depositBox,
        boxTokenAccount: challenge.boxTokenAccount,
      };
      this.deps.setToken(session.token);
      await this.deps.persist?.(session);
      this.set({ session });
      return session;
    });
  }

  /**
   * Pays `recipient` through the deposit box. Only the part of the amount that
   * is not already in the box is transferred, so a payment that failed after
   * its deposit can be retried without paying in twice.
   */
  send(request: SendRequest): Promise<RelayOpenResponse> {
    return this.run('deposit', async () => {
      const session = this.requireSession();
      const before = await this.deps.boxBalance(session.boxTokenAccount);
      const shortfall = before === null ? request.amount : request.amount - before;

      let transferHash: string | null = null;
      if (shortfall > 0n) {
        transferHash = await this.transferToBox(session, {
          amount: shortfall.toString(),
          mint: session.mint,
        });
        this.set({ activity: 'awaiting_funds' });
        await this.awaitFunds(session, request.amount, transferHash);
      }

      this.set({ activity: 'opening' });
      return this.agent(
        () =>
          this.deps.api.relayOpen({
            recipient: request.recipient,
            mint: session.mint,
            amount: request.amount.toString(),
            context: request.context,
            lang: request.lang,
            windowSecs: request.windowSecs,
          }),
        transferHash,
      );
    });
  }

  /** Undo: the relayer reclaims the hold to the owner's wallet. */
  undo(hold: string): Promise<{ signature: string }> {
    return this.run('reclaiming', async () => {
      this.requireSession();
      return this.agent(() => this.deps.api.relayReclaim(hold));
    });
  }

  /** Moves money that is sitting in the deposit box back to the owner's wallet. */
  withdraw(amount: bigint): Promise<{ signature: string }> {
    return this.run('withdrawing', async () => {
      const session = this.requireSession();
      return this.agent(() => this.deps.api.relayWithdraw(session.mint, amount.toString()));
    });
  }

  async signOut(): Promise<void> {
    await this.clearSession();
    this.set({ activity: 'idle', error: null });
  }

  /** Runs one operation at a time and records its outcome in the state. */
  private async run<T>(first: PollarActivity, task: () => Promise<T>): Promise<T> {
    if (this.state.activity !== 'idle') {
      throw new PollarFlowError('busy', 'Another Pollar operation is still running');
    }
    this.set({ activity: first, error: null });
    try {
      const result = await task();
      this.set({ activity: 'idle' });
      return result;
    } catch (cause) {
      const error =
        cause instanceof PollarFlowError
          ? cause
          : new PollarFlowError(
              'agent_error',
              cause instanceof Error ? cause.message : String(cause),
            );
      if (error.code === 'session_expired') await this.clearSession();
      this.set({ activity: 'idle', error });
      throw error;
    }
  }

  /**
   * Sends to the deposit box address the agent returned. Some transfer
   * services refuse a program-derived address as a destination; in that case
   * the box's token account is tried, and if that is refused too the error
   * carries both reasons.
   */
  private async transferToBox(
    box: { depositBox: string; boxTokenAccount: string },
    what: { amount: string; mint: string },
  ): Promise<string> {
    const first = await this.transfer({ destination: box.depositBox, ...what });
    if (first.status === 'sent') return first.hash;
    if (first.status === 'needs_approval') throw approvalError();

    const second = await this.transfer({ destination: box.boxTokenAccount, ...what });
    if (second.status === 'sent') return second.hash;
    if (second.status === 'needs_approval') throw approvalError();

    throw new PollarFlowError(
      'deposit_rejected',
      `Pollar refused the deposit box (${first.message}) and its token account (${second.message})`,
    );
  }

  /**
   * A transfer that throws (instead of answering "rejected") leaves it unknown
   * whether money moved, so it is never retried against the other address.
   */
  private async transfer(request: TransferRequest): Promise<TransferResult> {
    try {
      return await this.deps.transfer(request);
    } catch (error) {
      throw new PollarFlowError(
        'transfer_failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async completeAuth(challenge: RelayAuthStart, hash: string): Promise<RelaySession> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt++) {
      if (attempt > 0) await this.sleep(POLL_INTERVAL_MS);
      try {
        return await this.deps.api.relayAuthComplete({
          challengeId: challenge.challengeId,
          secret: challenge.secret,
          signature: hash,
        });
      } catch (error) {
        lastError = error;
        // Only "the cluster has not seen that transaction yet" and server trouble improve by waiting.
        const status = statusOf(error);
        const notSeenYet = (error as { code?: unknown } | null)?.code === 'transaction_not_found';
        if (!notSeenYet && status !== null && status < 500) break;
      }
    }
    throw new PollarFlowError(
      'agent_error',
      lastError instanceof Error ? lastError.message : 'The proof transfer could not be verified',
      hash,
    );
  }

  private async awaitFunds(session: PollarSession, needed: bigint, hash: string): Promise<void> {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
      const balance = await this.deps.boxBalance(session.boxTokenAccount);
      if (balance !== null && balance >= needed) return;
      await this.sleep(POLL_INTERVAL_MS);
    }
    throw new PollarFlowError(
      'funds_not_arrived',
      'The transfer was sent but has not reached the deposit box yet',
      hash,
    );
  }

  /** Runs an agent call, turning a 401 into `session_expired` and anything else into `agent_error`. */
  private async agent<T>(call: () => Promise<T>, transferHash: string | null = null): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof PollarFlowError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new PollarFlowError(
        statusOf(error) === 401 ? 'session_expired' : 'agent_error',
        message,
        transferHash,
      );
    }
  }

  private requireSession(): PollarSession {
    const { session } = this.state;
    if (!session) {
      throw new PollarFlowError('not_authenticated', 'Prove wallet ownership first');
    }
    if (this.expired(session)) {
      throw new PollarFlowError('session_expired', 'The relay session has expired');
    }
    return session;
  }

  private expired(session: PollarSession): boolean {
    const expiresAt = Date.parse(session.expiresAt);
    return !Number.isFinite(expiresAt) || expiresAt <= this.now();
  }

  private async clearSession(): Promise<void> {
    this.deps.setToken(null);
    await this.deps.persist?.(null);
    this.set({ session: null });
  }

  private set(patch: Partial<PollarFlowState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
}

/** The parts of Pollar's `SubmitOutcome` the flow reads. */
export type PollarOutcome =
  | { status: 'success' | 'pending'; hash: string }
  | { status: 'cosign_pending' }
  | { status: 'error'; message?: string; details?: string; code?: string; resultCode?: string };

/** Reduces a Pollar `sendPayment` outcome to a `TransferResult`. */
export function toTransferResult(outcome: PollarOutcome): TransferResult {
  switch (outcome.status) {
    case 'success':
      return { status: 'sent', hash: outcome.hash, settled: true };
    case 'pending':
      return { status: 'sent', hash: outcome.hash, settled: false };
    case 'cosign_pending':
      return { status: 'needs_approval' };
    case 'error':
      return {
        status: 'rejected',
        message:
          outcome.message ?? outcome.details ?? outcome.code ?? outcome.resultCode ?? 'rejected',
      };
  }
}

const approvalError = () =>
  new PollarFlowError(
    'needs_approval',
    'Approve the transfer on your other device, then try again',
  );

/** HTTP status of an agent error (`GuardianError.status`), or `null` for anything else. */
function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}
