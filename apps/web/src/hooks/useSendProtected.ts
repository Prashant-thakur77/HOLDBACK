'use client';

import {
  buildCreateHoldTx,
  fromHex,
  getMintInfo,
  previewTransaction,
  type AssessResponse,
  type CreateHoldResult,
  type Lang,
  type Preview,
} from '@holdback/sdk';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useCallback, useRef, useState } from 'react';

import { requireGuardian } from '@/lib/guardian';
import { planPayment, type PaymentPlan } from '@/lib/payment';
import { sendAndConfirm, toTxError, txError, type TxError } from '@/lib/tx';

/** A built transaction older than this is rebuilt before signing: blockhashes expire. */
const REBUILD_AFTER_MS = 30_000;

export type SendStage =
  | 'idle'
  /** Asking the agent for the verdict and the window. */
  | 'assessing'
  /** Building the hold (or instant transfer) transaction. */
  | 'building'
  /** Simulating it to show what will leave the wallet. */
  | 'previewing'
  /** Waiting for the user to confirm the pre-sign card. */
  | 'ready'
  /** Waiting for the wallet. */
  | 'signing'
  /** Sent; waiting for the cluster to confirm. */
  | 'confirming'
  | 'done'
  | 'error';

export interface SendInput {
  /** Base58 address. */
  recipient: string;
  /** Mint address, or `null` for SOL. */
  mint: string | null;
  /** Base units. */
  amount: bigint;
  /** The user's own words about why they are paying. */
  context?: string;
  lang: Lang;
}

/** Everything the pre-sign card shows. Nothing has been signed at this point. */
export interface PreparedPayment {
  input: SendInput;
  assessment: AssessResponse;
  plan: PaymentPlan;
  /** Address the hold will have, or `null` for an instant transfer. */
  hold: string | null;
  /** Simulated balance changes for the sender: SOL first, then the token if any. */
  preview: Preview;
}

export interface SendState {
  stage: SendStage;
  prepared: PreparedPayment | null;
  signature: string | null;
  error: TxError | null;
}

export interface SendProtected extends SendState {
  /** Runs assess, build and preview. Resolves with the pre-sign data, or `null` on failure. */
  prepare: (input: SendInput) => Promise<PreparedPayment | null>;
  /**
   * Signs and sends what `prepare` built. A sanctioned recipient needs
   * `acknowledgeSanctioned: true`, which the page sets only after the user
   * has typed the confirmation phrase.
   */
  send: (options?: { acknowledgeSanctioned?: boolean }) => Promise<string | null>;
  reset: () => void;
}

const INITIAL: SendState = { stage: 'idle', prepared: null, signature: null, error: null };

interface Draft {
  built: CreateHoldResult;
  builtAt: number;
  sender: PublicKey;
}

/**
 * The protected send flow, one stage at a time:
 * assess, build, preview, then (after the user confirms) sign, send, confirm.
 *
 * Failures never throw; they land in `error` with a `kind` to switch on and,
 * when the program refused the instruction, the decoded program error.
 */
export function useSendProtected(): SendProtected {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [state, setState] = useState<SendState>(INITIAL);
  const draft = useRef<Draft | null>(null);
  /** A newer `prepare` or a `reset` invalidates the results of an older run. */
  const run = useRef(0);

  /** `prepare` failures clear the draft; `send` failures keep it so the user can retry. */
  const fail = useCallback((error: TxError, keepPrepared = false) => {
    setState((previous) => ({ ...(keepPrepared ? previous : INITIAL), stage: 'error', error }));
    return null;
  }, []);

  const prepare = useCallback(
    async (input: SendInput) => {
      const current = ++run.current;
      const stale = () => current !== run.current;
      draft.current = null;
      const stage = (next: SendStage) => {
        if (!stale()) setState({ ...INITIAL, stage: next });
      };

      const sender = wallet.publicKey;
      if (!sender) return fail(txError('wallet_not_connected', 'Connect a wallet first'));
      let recipient: PublicKey;
      try {
        recipient = new PublicKey(input.recipient.trim());
      } catch {
        return fail(txError('invalid_input', 'The recipient is not a valid Solana address'));
      }
      if (recipient.equals(sender)) {
        return fail(txError('invalid_input', 'You cannot send a protected payment to yourself'));
      }
      if (input.amount <= 0n) {
        return fail(txError('invalid_input', 'Enter an amount greater than zero'));
      }
      const mint = input.mint ? new PublicKey(input.mint) : null;

      let assessment: AssessResponse;
      try {
        stage('assessing');
        assessment = await requireGuardian().assess({
          sender: sender.toBase58(),
          recipient: recipient.toBase58(),
          mint: input.mint,
          amount: input.amount.toString(),
          context: input.context?.trim() || undefined,
          lang: input.lang,
        });
      } catch (failure) {
        return stale() ? null : fail(toTxError(failure, 'agent_unavailable'));
      }

      try {
        stage('building');
        const plan = await planPayment(connection, assessment, sender, recipient);
        const built = await buildCreateHoldTx(connection, {
          sender,
          recipient,
          mint,
          amount: input.amount,
          windowSecs: plan.windowSecs,
          tier: plan.tier,
          evidenceHash: fromHex(assessment.evidenceHash),
        });

        stage('previewing');
        const watch: Parameters<typeof previewTransaction>[2] = [{ owner: sender, mint: null }];
        if (mint) {
          const { tokenProgram } = await getMintInfo(connection, mint);
          watch.push({ owner: sender, mint, tokenProgram });
        }
        const preview = await previewTransaction(connection, built.transaction, watch);
        if (stale()) return null;
        if (!preview.ok) {
          const error = toTxError({ logs: preview.logs, err: preview.error }, 'simulation_failed');
          return fail(
            error.program ? error : txError('simulation_failed', 'The simulation failed'),
          );
        }

        const prepared: PreparedPayment = {
          input,
          assessment,
          plan,
          hold: built.hold?.toBase58() ?? null,
          preview,
        };
        draft.current = { built, builtAt: Date.now(), sender };
        setState({ stage: 'ready', prepared, signature: null, error: null });
        return prepared;
      } catch (failure) {
        return stale() ? null : fail(toTxError(failure, 'simulation_failed'));
      }
    },
    [connection, wallet.publicKey, fail],
  );

  const send = useCallback(
    async (options: { acknowledgeSanctioned?: boolean } = {}) => {
      const current = run.current;
      const prepared = state.prepared;
      const pending = draft.current;
      // `error` is allowed so a declined or expired attempt can be retried as is.
      const sendable = state.stage === 'ready' || state.stage === 'error';
      if (!prepared || !pending || !sendable) {
        return fail(txError('invalid_input', 'Prepare the payment before sending it'));
      }
      if (!wallet.publicKey?.equals(pending.sender)) {
        return fail(txError('wallet_not_connected', 'The wallet changed; prepare again'));
      }
      if (prepared.assessment.requiresConfirmation && !options.acknowledgeSanctioned) {
        return fail(
          txError('confirmation_required', 'This recipient needs an explicit confirmation'),
          true,
        );
      }

      try {
        setState((previous) => ({ ...previous, stage: 'signing', error: null }));
        let built = pending.built;
        if (Date.now() - pending.builtAt > REBUILD_AFTER_MS) {
          // Same nonce, so the hold keeps the address the user was shown.
          built = await buildCreateHoldTx(connection, {
            sender: pending.sender,
            recipient: new PublicKey(prepared.input.recipient.trim()),
            mint: prepared.input.mint ? new PublicKey(prepared.input.mint) : null,
            amount: prepared.input.amount,
            windowSecs: prepared.plan.windowSecs,
            tier: prepared.plan.tier,
            evidenceHash: fromHex(prepared.assessment.evidenceHash),
            nonce: pending.built.nonce,
          });
        }
        const signature = await sendAndConfirm(
          connection,
          {
            sendTransaction: async (...args) => {
              const sent = await wallet.sendTransaction(...args);
              if (current === run.current) {
                setState((previous) => ({ ...previous, stage: 'confirming', signature: sent }));
              }
              return sent;
            },
          },
          built,
        );
        if (current !== run.current) return signature;
        draft.current = null;
        setState((previous) => ({ ...previous, stage: 'done', signature, error: null }));
        return signature;
      } catch (failure) {
        return current === run.current ? fail(toTxError(failure), true) : null;
      }
    },
    [connection, wallet, state.prepared, state.stage, fail],
  );

  const reset = useCallback(() => {
    run.current += 1;
    draft.current = null;
    setState(INITIAL);
  }, []);

  return { ...state, prepare, send, reset };
}
