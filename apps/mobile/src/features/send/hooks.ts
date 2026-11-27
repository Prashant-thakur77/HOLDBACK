import {
  Tier,
  buildCreateHoldTx,
  fromHex,
  parseProgramError,
  previewTransaction,
  type AssessResponse,
  type Lang,
} from '@holdback/sdk';
import { PublicKey } from '@solana/web3.js';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { hasAgent } from '@/config';
import { guardian } from '@/data/guardian';
import { queryKeys } from '@/data/keys';
import type { TokenMeta } from '@/data/tokens';
import { judgePreview, type PreviewVerdict } from '@/lib/preview';
import { classifyRecipient } from '@/lib/recipient';
import { useWallet } from '@/wallet/WalletContext';

/** A value that only changes after it has been stable for `delayMs`. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

export type RecipientState =
  | { status: 'empty' }
  | { status: 'invalid' }
  | { status: 'resolving'; name: string }
  | { status: 'not_found'; name: string }
  | { status: 'unavailable'; name: string }
  | { status: 'ready'; address: string; name: string | null; lookalikeOf: string | null };

/** Turns the recipient field into an address, asking the agent to resolve `.sol` / `.skr` names. */
export function useRecipient(text: string): RecipientState {
  const input = classifyRecipient(useDebounced(text, 350));
  const name = input.kind === 'name' ? input.name : null;
  const lookup = useQuery({
    queryKey: queryKeys.name(name ?? ''),
    queryFn: () => guardian.resolveName(name!),
    enabled: hasAgent && !!name,
    staleTime: 60_000,
    retry: false,
  });

  if (input.kind === 'empty') return { status: 'empty' };
  if (input.kind === 'invalid') return { status: 'invalid' };
  if (input.kind === 'address') {
    return { status: 'ready', address: input.address, name: null, lookalikeOf: null };
  }
  if (!hasAgent || lookup.isError) return { status: 'unavailable', name: input.name };
  if (!lookup.data) return { status: 'resolving', name: input.name };
  if (!lookup.data.address) return { status: 'not_found', name: input.name };
  return {
    status: 'ready',
    address: lookup.data.address,
    name: input.name,
    lookalikeOf: lookup.data.lookalikeOf,
  };
}

export interface AssessInputs {
  recipient: string | null;
  mint: string | null;
  amount: bigint | null;
  context: string;
  lang: Lang;
}

/** The live verdict: re-asked (debounced) whenever recipient, amount, token or reason changes. */
export function useAssessment(inputs: AssessInputs) {
  const { address } = useWallet();
  const settled = useDebounced(inputs, 600);
  const sender = address?.toBase58() ?? '';
  const ready = hasAgent && !!address && !!settled.recipient && settled.amount !== null;
  return useQuery<AssessResponse>({
    queryKey: [
      'assess',
      sender,
      settled.recipient,
      settled.mint,
      settled.amount?.toString(),
      settled.context,
      settled.lang,
    ],
    queryFn: () =>
      guardian.assess({
        sender,
        recipient: settled.recipient!,
        mint: settled.mint,
        amount: settled.amount!.toString(),
        context: settled.context.trim() || undefined,
        lang: settled.lang,
      }),
    enabled: ready,
    staleTime: 30_000,
    retry: false,
  });
}

/** What goes on-chain with the hold: taken from the verdict, or neutral values without one. */
export function holdTerms(assessment: AssessResponse | undefined): {
  tier: number;
  evidenceHash: Uint8Array;
} {
  if (!assessment) return { tier: Tier.UNKNOWN, evidenceHash: new Uint8Array(32) };
  return { tier: assessment.tierIndex, evidenceHash: fromHex(assessment.evidenceHash) };
}

export interface PreviewInputs {
  recipient: string | null;
  token: TokenMeta | undefined;
  amount: bigint | null;
  windowSecs: number;
  assessment: AssessResponse | undefined;
  enabled: boolean;
}

export type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  /** The RPC could not run the simulation; nothing is known. */
  | { status: 'unavailable' }
  /** The transaction would fail on-chain. */
  | { status: 'failed'; reason: string }
  | { status: 'ok'; verdict: PreviewVerdict };

/**
 * Simulate-before-sign: builds the exact payment and asks the RPC what it
 * would do to the sender's balances, before any signature exists.
 */
export function usePreview(inputs: PreviewInputs): PreviewState {
  const { address, connection } = useWallet();
  const { recipient, token, amount, windowSecs, assessment } = inputs;
  const ready = inputs.enabled && !!address && !!recipient && !!token && amount !== null;
  const terms = holdTerms(assessment);

  const query = useQuery({
    queryKey: [
      'preview',
      address?.toBase58(),
      recipient,
      token?.mint,
      amount?.toString(),
      windowSecs,
      terms.tier,
      assessment?.evidenceHash,
    ],
    queryFn: async (): Promise<PreviewState> => {
      const sender = address!;
      const mint = token!.mint ? new PublicKey(token!.mint) : null;
      const built = await buildCreateHoldTx(connection, {
        sender,
        recipient: new PublicKey(recipient!),
        mint,
        amount: amount!,
        windowSecs,
        ...terms,
      });
      const preview = await previewTransaction(connection, built.transaction, [
        { owner: sender, mint, tokenProgram: token!.tokenProgram ?? undefined },
        { owner: sender, mint: null },
      ]);
      if (!preview.ok) {
        const program = parseProgramError(preview.logs) ?? parseProgramError(preview.error);
        return { status: 'failed', reason: program?.message ?? JSON.stringify(preview.error) };
      }
      const verdict = judgePreview({
        amount: amount!,
        isSol: mint === null,
        tokenDelta: preview.changes[0]?.delta ?? 0n,
        solDelta: preview.changes[1]?.delta ?? 0n,
      });
      return { status: 'ok', verdict };
    },
    enabled: ready,
    staleTime: 20_000,
    retry: false,
  });

  if (!ready) return { status: 'idle' };
  if (query.isError) return { status: 'unavailable' };
  return query.data ?? { status: 'loading' };
}
