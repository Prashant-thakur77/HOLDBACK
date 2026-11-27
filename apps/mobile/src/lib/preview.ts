/**
 * Reading a simulate-before-sign result: what leaves the wallet, what the
 * network costs, and whether the simulation moves more than the user typed.
 */

export interface PreviewInput {
  /** Amount the user entered, in base units. */
  amount: bigint;
  /** True when the payment itself is in SOL. */
  isSol: boolean;
  /** Simulated change of the sender's payment-token balance (negative = leaves). Ignored for SOL. */
  tokenDelta: bigint;
  /** Simulated change of the sender's SOL balance in lamports. */
  solDelta: bigint;
}

export interface PreviewVerdict {
  /** Base units of the payment asset that leave the wallet. */
  outflow: bigint;
  /** Lamports spent on top of the payment: network fee plus account rent deposits. */
  costLamports: bigint;
  /** True when more of the payment asset leaves than the user entered. Never sign that. */
  mismatch: boolean;
}

/**
 * Most a HOLDBACK payment may cost in SOL beyond the amount itself: the fee,
 * the hold account, a vault token account and the recipient's stats account
 * are each a few thousand to two million lamports. Anything above this is
 * treated as an unexpected outflow.
 */
export const MAX_EXPECTED_COST_LAMPORTS = 20_000_000n;

export function judgePreview(input: PreviewInput): PreviewVerdict {
  const solOut = input.solDelta < 0n ? -input.solDelta : 0n;
  if (input.isSol) {
    const cost = solOut > input.amount ? solOut - input.amount : 0n;
    return {
      outflow: solOut - cost,
      costLamports: cost,
      mismatch: cost > MAX_EXPECTED_COST_LAMPORTS,
    };
  }
  const tokenOut = input.tokenDelta < 0n ? -input.tokenDelta : 0n;
  return {
    outflow: tokenOut,
    costLamports: solOut,
    mismatch: tokenOut > input.amount || solOut > MAX_EXPECTED_COST_LAMPORTS,
  };
}
