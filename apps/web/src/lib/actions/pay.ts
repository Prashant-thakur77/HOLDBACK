/**
 * The "pay with HOLDBACK" Solana Action.
 *
 * `GET` describes the payment and shows the recipient's current verdict.
 * `POST` asks the agent to assess this exact payer, recipient and amount and
 * returns an unsigned transaction: a hold with the undo window the agent
 * chose, or an instant transfer when the payer already trusts the recipient
 * on-chain. A sanctioned recipient is refused.
 *
 * Everything here takes its collaborators as arguments so the handlers can
 * be exercised without a network.
 */
import {
  GuardianError,
  LANGS,
  Tier,
  WINDOW_SECS_BY_TIER,
  attestationFor,
  buildCreateHoldTx,
  formatAmount,
  formatDuration,
  fromHex,
  parseAmount,
  type AssessResponse,
  type GuardianClient,
  type Lang,
} from '@holdback/sdk';
import type {
  ActionGetResponse,
  ActionPostRequest,
  LinkedAction,
  TransactionResponse,
} from '@solana/actions-spec';
import { PublicKey, type Connection } from '@solana/web3.js';

import type { Cluster } from '../env';
import { errorMessage } from '../errors';
import { shortAddress } from '../format';
import { DEVNET_USDC, SOL, resolveMint, type MintMeta } from '../mints';
import { planPayment, type PaymentPlan } from '../payment';
import { ActionFailure, actionError, actionJson } from './spec';

export const PAY_ACTION_PATH = '/api/actions/pay';
export const ACTION_ICON_PATH = '/action-icon.svg';

const U64_MAX = (1n << 64n) - 1n;

/**
 * `GET` has no payer yet, so the verdict shown there is about the recipient
 * alone: the agent is asked on behalf of the all-zero address, which has no
 * history and trusts nobody.
 */
const NO_PAYER = PublicKey.default.toBase58();
/** Without an amount the preview assesses the smallest payment there is. */
const PREVIEW_AMOUNT = '1';

export interface PayActionDeps {
  /** `null` when no agent is configured. */
  guardian: Pick<GuardianClient, 'assess'> | null;
  connection: Connection;
  cluster: Cluster;
}

export interface PayQuery {
  recipient: PublicKey;
  mint: MintMeta;
  /** Base units, or `null` when the link leaves the amount to the payer. */
  amount: bigint | null;
  lang: Lang;
}

function parseAddress(value: string | null, name: string): PublicKey {
  if (!value) throw new ActionFailure(400, `Missing "${name}": a Solana address is required`);
  try {
    return new PublicKey(value);
  } catch {
    throw new ActionFailure(400, `"${name}" is not a valid Solana address`);
  }
}

async function parseMint(value: string | null, deps: PayActionDeps): Promise<MintMeta> {
  const text = value?.trim() ?? '';
  if (text === '' || text.toUpperCase() === 'SOL') return SOL;
  if (text.toUpperCase() === 'USDC') {
    if (deps.cluster !== 'devnet') {
      throw new ActionFailure(400, '"mint=USDC" is a devnet shortcut; pass the mint address');
    }
    return DEVNET_USDC;
  }
  const address = parseAddress(text, 'mint').toBase58();
  try {
    return await resolveMint(deps.connection, address, deps.cluster);
  } catch (failure) {
    const message = errorMessage(failure);
    // What the SDK throws for an address that is not a usable mint.
    if (/does not exist|not a token mint|no mint data/.test(message)) {
      throw new ActionFailure(400, `"mint": ${message}`);
    }
    throw new ActionFailure(502, 'Could not read the mint from the Solana RPC');
  }
}

function parseAmountParam(value: string | null, mint: MintMeta): bigint | null {
  if (value === null || value.trim() === '') return null;
  let amount: bigint;
  try {
    amount = parseAmount(value, mint.decimals);
  } catch {
    throw new ActionFailure(
      400,
      `"amount" must be a positive number with at most ${mint.decimals} decimal places`,
    );
  }
  if (amount <= 0n) throw new ActionFailure(400, '"amount" must be greater than zero');
  if (amount > U64_MAX) throw new ActionFailure(400, '"amount" is too large');
  return amount;
}

function parseLang(value: string | null): Lang {
  if (value === null || value === '') return 'en';
  if ((LANGS as readonly string[]).includes(value)) return value as Lang;
  throw new ActionFailure(400, `"lang" must be one of ${LANGS.join(', ')}`);
}

export async function parsePayQuery(url: URL, deps: PayActionDeps): Promise<PayQuery> {
  const recipient = parseAddress(url.searchParams.get('to'), 'to');
  const lang = parseLang(url.searchParams.get('lang'));
  const mint = await parseMint(url.searchParams.get('mint'), deps);
  const amount = parseAmountParam(url.searchParams.get('amount'), mint);
  return { recipient, mint, amount, lang };
}

async function assess(
  deps: PayActionDeps,
  query: PayQuery,
  sender: string,
  amount: string,
): Promise<AssessResponse> {
  if (!deps.guardian) throw new ActionFailure(503, 'The risk check is not available right now');
  try {
    return await deps.guardian.assess({
      sender,
      recipient: query.recipient.toBase58(),
      mint: query.mint.address,
      amount,
      lang: query.lang,
    });
  } catch (failure) {
    // A 4xx from the agent is about this request; anything else is an outage.
    if (failure instanceof GuardianError && failure.status >= 400 && failure.status < 500) {
      throw new ActionFailure(400, `The risk check rejected this payment: ${failure.message}`);
    }
    throw new ActionFailure(503, 'The risk check is not available right now');
  }
}

const isSanctioned = (assessment: AssessResponse) =>
  assessment.tier === 'SANCTIONED' || assessment.requiresConfirmation;

const SANCTIONED_MESSAGE =
  'This address is on a sanctions list. HOLDBACK does not build payments to it.';

/** What the Blink shows under the title: the verdict in words, then the agent's own explanation. */
export function describeVerdict(assessment: AssessResponse | null): string {
  if (!assessment) {
    return 'The risk check is not available right now. The undo window is set when you pay.';
  }
  if (isSanctioned(assessment)) return `Risk check: SANCTIONED. ${SANCTIONED_MESSAGE}`;
  const window =
    assessment.windowSecs > 0
      ? `You can undo this payment for ${formatDuration(assessment.windowSecs)} before it reaches the recipient.`
      : `It is sent instantly if your wallet has marked this recipient as trusted; otherwise you can undo it for ${formatDuration(WINDOW_SECS_BY_TIER[Tier.UNKNOWN])}.`;
  return `Risk check: ${assessment.tier}. ${window} ${assessment.spoken.text}`.trim();
}

function payHref(query: PayQuery, amount: string): string {
  const params = new URLSearchParams({ to: query.recipient.toBase58() });
  if (query.mint.address) params.set('mint', query.mint.address);
  if (query.lang !== 'en') params.set('lang', query.lang);
  // `{amount}` must stay unescaped: the client substitutes the payer's input.
  return `${PAY_ACTION_PATH}?${params.toString()}&amount=${amount}`;
}

/** The metadata for a pay link, also used by the `/pay` page for non-Blink visitors. */
export async function describePayAction(url: URL, deps: PayActionDeps): Promise<ActionGetResponse> {
  const query = await parsePayQuery(url, deps);
  const { mint, amount } = query;

  let assessment: AssessResponse | null = null;
  try {
    assessment = await assess(deps, query, NO_PAYER, amount?.toString() ?? PREVIEW_AMOUNT);
  } catch {
    // The description says the verdict is unavailable; paying is refused later if it still is.
  }
  const refused = assessment !== null && isSanctioned(assessment);

  const amountInput: LinkedAction = {
    type: 'transaction',
    label: 'Pay with HOLDBACK',
    href: payHref(query, '{amount}'),
    parameters: [
      {
        name: 'amount',
        type: 'number',
        label: `Amount in ${mint.symbol}`,
        required: true,
        min: Number(formatAmount(1n, mint.decimals)),
        pattern: `^\\d+(\\.\\d{1,${mint.decimals}})?$`,
        patternDescription: `A number with at most ${mint.decimals} decimal places`,
      },
    ],
  };

  return {
    type: 'action',
    icon: new URL(ACTION_ICON_PATH, url.origin).toString(),
    title: `Pay ${shortAddress(query.recipient.toBase58())} with an undo window`,
    description: describeVerdict(assessment),
    label:
      amount === null
        ? 'Pay with HOLDBACK'
        : `Pay ${formatAmount(amount, mint.decimals)} ${mint.symbol}`,
    disabled: refused || undefined,
    error: refused ? { message: SANCTIONED_MESSAGE } : undefined,
    links: amount === null ? { actions: [amountInput] } : undefined,
  };
}

function successMessage(plan: PaymentPlan): string {
  return plan.instant
    ? 'You trust this recipient, so the payment is sent instantly with no undo window.'
    : `Payment held by HOLDBACK. You can undo it for ${formatDuration(plan.windowSecs)}; after that it is released to the recipient.`;
}

async function readPayer(request: Request): Promise<PublicKey> {
  let body: Partial<ActionPostRequest> | null;
  try {
    body = (await request.json()) as Partial<ActionPostRequest> | null;
  } catch {
    throw new ActionFailure(400, 'The request body must be JSON: {"account": "<payer address>"}');
  }
  const account = typeof body?.account === 'string' ? body.account : null;
  return parseAddress(account, 'account');
}

/** Builds the unsigned payment transaction for the payer named in the request body. */
export async function buildPayTransaction(
  request: Request,
  deps: PayActionDeps,
): Promise<TransactionResponse> {
  const query = await parsePayQuery(new URL(request.url), deps);
  if (query.amount === null) throw new ActionFailure(400, 'Missing "amount"');
  const sender = await readPayer(request);
  if (sender.equals(query.recipient)) {
    throw new ActionFailure(400, 'The payer and the recipient are the same address');
  }

  const assessment = await assess(deps, query, sender.toBase58(), query.amount.toString());
  if (isSanctioned(assessment)) throw new ActionFailure(403, SANCTIONED_MESSAGE);

  let evidenceHash: Uint8Array;
  try {
    evidenceHash = fromHex(assessment.evidenceHash);
  } catch {
    evidenceHash = new Uint8Array();
  }
  if (evidenceHash.length !== 32) {
    throw new ActionFailure(502, 'The risk check returned an unusable evidence hash');
  }

  try {
    const plan = await planPayment(deps.connection, assessment, sender, query.recipient);
    const built = await buildCreateHoldTx(deps.connection, {
      sender,
      recipient: query.recipient,
      mint: query.mint.address ? new PublicKey(query.mint.address) : null,
      amount: query.amount,
      windowSecs: plan.windowSecs,
      tier: plan.tier,
      evidenceHash,
      attestation: attestationFor(assessment, {
        sender,
        recipient: query.recipient,
        mint: query.mint.address ? new PublicKey(query.mint.address) : null,
        amount: query.amount,
      }),
    });
    return {
      type: 'transaction',
      transaction: Buffer.from(built.transaction.serialize()).toString('base64'),
      message: successMessage(plan),
    };
  } catch (failure) {
    console.error('pay action: building the transaction failed', errorMessage(failure));
    throw new ActionFailure(502, 'Could not build the transaction: the Solana RPC did not answer');
  }
}

/** Runs a handler and renders either its result or its failure with the Action headers. */
async function respond(cluster: Cluster, run: () => Promise<unknown>): Promise<Response> {
  try {
    return actionJson(await run(), cluster);
  } catch (failure) {
    if (failure instanceof ActionFailure) return actionError(failure, cluster);
    console.error('pay action failed', errorMessage(failure));
    return actionError(new ActionFailure(500, 'Unexpected error'), cluster);
  }
}

export function handlePayGet(request: Request, deps: PayActionDeps): Promise<Response> {
  return respond(deps.cluster, () => describePayAction(new URL(request.url), deps));
}

export function handlePayPost(request: Request, deps: PayActionDeps): Promise<Response> {
  return respond(deps.cluster, () => buildPayTransaction(request, deps));
}
