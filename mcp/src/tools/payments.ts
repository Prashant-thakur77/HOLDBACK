import {
  Tier,
  WINDOW_SECS_BY_TIER,
  buildCreateHoldTx,
  fetchConfig,
  fetchHold,
  formatAmount,
  formatDuration,
  fromHex,
  isTrusted,
  type AssessResponse,
} from '@holdback/sdk';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PublicKey } from '@solana/web3.js';
import { z } from 'zod';

import { assessmentShape, summarize } from '../assessment';
import { exceedsCap, toBaseUnits, type Asset } from '../assets';
import {
  nowSeconds,
  parseAddress,
  requireGuardian,
  resolveActor,
  type ToolContext,
} from '../context';
import { ToolError } from '../errors';
import { address, amount, context, lang, mint, submission } from '../schemas';
import { submit } from '../submit';
import { registerTool } from '../tool';

function isSanctioned(assessment: AssessResponse): boolean {
  return assessment.tierIndex === Tier.SANCTIONED || assessment.requiresConfirmation;
}

interface Party {
  sender: PublicKey;
  recipient: PublicKey;
  asset: Asset;
  base: bigint;
}

/** Shared front half of both tools: who pays whom, in what, and how much. */
async function readParty(
  { deps, assets }: ToolContext,
  args: { sender?: string; recipient: string; mint: string; amount: string },
): Promise<Party> {
  const sender = resolveActor(deps, args.sender, 'sender');
  const recipient = parseAddress(args.recipient, 'recipient');
  if (sender.equals(recipient)) {
    throw new ToolError('self_payment', 'sender and recipient are the same wallet');
  }
  const asset = await assets.resolve(args.mint);
  return { sender, recipient, asset, base: toBaseUnits(args.amount, asset) };
}

function assess(
  ctx: ToolContext,
  party: Party,
  args: { context?: string; lang: 'en' | 'hi' | 'es' | 'pt' },
) {
  return requireGuardian(ctx.deps).assess({
    sender: party.sender.toBase58(),
    recipient: party.recipient.toBase58(),
    mint: party.asset.mint?.toBase58() ?? null,
    amount: party.base.toString(),
    context: args.context,
    lang: args.lang,
  });
}

/**
 * Picks the window that goes on-chain. The policy window is a floor: a
 * caller may ask for longer, never shorter. The instant path additionally
 * needs the sender's on-chain trust record, because the program refuses a
 * zero-window payment without it; when the record is missing the payment
 * falls back to the default hold instead of failing.
 */
async function chooseWindow(
  { deps }: ToolContext,
  party: Party,
  policySecs: number,
  requestedSecs: number | undefined,
): Promise<{ windowSecs: number; notes: string[] }> {
  const notes: string[] = [];
  let windowSecs = policySecs;

  if (requestedSecs !== undefined && requestedSecs > policySecs) {
    const config = await fetchConfig(deps.connection);
    if (config && requestedSecs > config.maxWindowSecs) {
      throw new ToolError(
        'window_too_long',
        `The program allows windows up to ${formatDuration(config.maxWindowSecs)}.`,
        { maxWindowSecs: config.maxWindowSecs },
      );
    }
    windowSecs = requestedSecs;
  } else if (requestedSecs !== undefined && requestedSecs < policySecs) {
    notes.push(
      `The requested window (${formatDuration(requestedSecs)}) is shorter than the policy ` +
        `window, so the policy window was used. Windows can be lengthened, never shortened.`,
    );
  }

  if (windowSecs === 0 && !(await isTrusted(deps.connection, party.sender, party.recipient))) {
    windowSecs = WINDOW_SECS_BY_TIER[Tier.UNKNOWN];
    notes.push(
      'The recipient was assessed as trusted, but the sender has no on-chain trust record ' +
        'for them, so the payment uses the default hold instead of the instant path. Call ' +
        'release_early to pay now, or trust_recipient to make future payments instant.',
    );
  }
  return { windowSecs, notes };
}

export function registerPaymentTools(server: McpServer, ctx: ToolContext): void {
  const { deps } = ctx;

  registerTool(server, {
    name: 'assess_recipient',
    title: 'Assess a recipient before paying',
    description:
      'Checks a Solana recipient against live scam evidence (on-chain reputation, blocklists, ' +
      'sanctions lists, abuse reports, web reports, wallet behaviour) and returns the risk ' +
      'tier, the undo window a payment would get, the score, and the strongest findings with ' +
      'links. Read-only: nothing is paid or signed. Use it to look before deciding; ' +
      'send_protected_payment runs the same assessment itself, so you do not need to call ' +
      'this first.',
    input: {
      recipient: address('Wallet that would receive the payment.'),
      mint,
      amount,
      sender: address('Wallet that would pay. Omit when this server has a signing key.').optional(),
      context,
      lang,
    },
    output: {
      ...assessmentShape,
      recipient: z.string(),
      payable: z
        .boolean()
        .describe('False when send_protected_payment would refuse this recipient outright.'),
      advice: z.string().describe('What to do next, in one sentence.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run(args) {
      const party = await readParty(ctx, args);
      const assessment = await assess(ctx, party, args);
      const summary = summarize(assessment);
      const payable = !isSanctioned(assessment);
      return {
        ...summary,
        recipient: party.recipient.toBase58(),
        payable,
        advice: payable
          ? `send_protected_payment would place this payment under a ${summary.window} undo window.`
          : 'Do not pay this recipient: it is on a sanctions list and payments to it are refused.',
      };
    },
  });

  registerTool(server, {
    name: 'send_protected_payment',
    title: 'Send a payment with an undo window',
    description:
      'Pays a Solana recipient through HOLDBACK instead of an irreversible transfer. The ' +
      'recipient is assessed first; the money then sits in an on-chain hold for a window sized ' +
      'by the risk (about 30 minutes for an unknown recipient, up to 24 hours for a flagged ' +
      'one) during which undo_payment returns it to the sender. After the window it is ' +
      'released to the recipient automatically. Recipients the sender has marked as trusted ' +
      'are paid instantly. Sanctioned recipients and amounts over the configured cap are ' +
      'refused and nothing is built. If this server has a signing key the payment is sent and ' +
      'confirmed; otherwise the result carries an unsigned transaction for the sender’s wallet. ' +
      'Use this for every payment unless told to bypass protection.',
    input: {
      recipient: address('Wallet to pay.'),
      mint,
      amount,
      sender: address('Paying wallet. Omit when this server has a signing key.').optional(),
      context,
      lang,
      windowSecs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Ask for a longer undo window, in seconds. Values below the policy window are ' +
            'ignored: a window can be lengthened, never shortened.',
        ),
    },
    output: {
      ...submission,
      path: z
        .enum(['hold', 'instant'])
        .describe('hold: money is held and can be undone. instant: paid directly, final.'),
      hold: z
        .string()
        .nullable()
        .describe('Address of the hold account; null on the instant path.'),
      sender: z.string(),
      recipient: z.string(),
      mint: z.string(),
      amount: z.string().describe('Display units.'),
      amountBaseUnits: z.string(),
      windowSecs: z.number().describe('The undo window actually applied, in seconds.'),
      releaseAt: z
        .string()
        .nullable()
        .describe('ISO 8601 time the recipient can be paid; null on the instant path.'),
      releaseAtIsEstimate: z
        .boolean()
        .describe(
          'True when releaseAt was computed from the local clock (transaction not confirmed ' +
            'yet); false when it was read from the confirmed hold.',
        ),
      assessment: z.object(assessmentShape),
      notes: z.array(z.string()).describe('Anything the caller should tell the user.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async run(args) {
      const party = await readParty(ctx, args);
      const { sender, recipient, asset, base } = party;
      const display = formatAmount(base, asset.decimals);

      if (deps.maxAmount !== null && exceedsCap(base, asset.decimals, deps.maxAmount)) {
        throw new ToolError(
          'amount_over_cap',
          `Refused: ${display} ${asset.symbol} is over this server's limit of ` +
            `${deps.maxAmount} per payment (HOLDBACK_MAX_AMOUNT). Nothing was built or sent.`,
          { maxAmount: deps.maxAmount, requested: display },
        );
      }

      const assessment = await assess(ctx, party, args);
      const summary = summarize(assessment);
      if (isSanctioned(assessment)) {
        throw new ToolError(
          'recipient_sanctioned',
          'Refused: the recipient is on a sanctions list. Nothing was built or sent. Do not ' +
            'try to pay this address another way; tell the user why.',
          { assessment: summary },
        );
      }

      const { windowSecs, notes } = await chooseWindow(
        ctx,
        party,
        assessment.windowSecs,
        args.windowSecs,
      );
      const built = await buildCreateHoldTx(deps.connection, {
        sender,
        recipient,
        mint: asset.mint,
        amount: base,
        windowSecs,
        tier: assessment.tierIndex,
        evidenceHash: fromHex(assessment.evidenceHash),
      });
      const outcome = await submit(deps, built, sender);

      // Once confirmed, the hold account is the authority on the release
      // time (it uses the cluster clock); before that only an estimate exists.
      let releaseAt: number | null = built.hold ? nowSeconds(deps) + windowSecs : null;
      let releaseAtIsEstimate = built.hold !== null;
      if (built.hold && outcome.status === 'sent') {
        const confirmed = await fetchHold(deps.connection, built.hold, {
          commitment: 'confirmed',
        }).catch(() => null);
        if (confirmed) {
          releaseAt = confirmed.releaseAt;
          releaseAtIsEstimate = false;
        }
      }

      if (assessment.tierIndex >= Tier.SUSPICIOUS) {
        notes.push(
          `The recipient is ${assessment.tier}. Tell the user what was found; undo_payment ` +
            'brings the money back at any time before releaseAt.',
        );
      }
      if (built.instant) notes.push('Paid on the instant path: this payment cannot be undone.');

      return {
        ...outcome,
        path: built.instant ? ('instant' as const) : ('hold' as const),
        hold: built.hold?.toBase58() ?? null,
        sender: sender.toBase58(),
        recipient: recipient.toBase58(),
        mint: asset.id,
        amount: display,
        amountBaseUnits: base.toString(),
        windowSecs,
        releaseAt: releaseAt === null ? null : new Date(releaseAt * 1000).toISOString(),
        releaseAtIsEstimate,
        assessment: summary,
        notes,
      };
    },
  });
}
