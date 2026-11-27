/** Plain words for the Dojo's moves and outcomes, shared by the game and the spectator page. */
import type { Decision, Investigation, RoundRecap } from '@holdback/dojo';

export const INVESTIGATION_LABELS: Record<Investigation, { label: string; hint: string }> = {
  ask_question: { label: 'Ask a question', hint: 'Reveals the next clue' },
  verify_identity: { label: 'Verify who it is', hint: 'What the official channel says' },
  check_address: { label: 'Check the address', hint: 'The risk agent’s verdict' },
};

export const DECISION_LABELS: Record<Decision, string> = {
  pay: 'Pay',
  pay_with_holdback: 'Pay with a hold',
  refuse: 'Refuse',
  report: 'Report as a scam',
};

export const CLUE_SOURCES: Record<'question' | 'identity' | 'address', string> = {
  question: 'You asked',
  identity: 'Official channel',
  address: 'Risk agent',
};

/** One sentence about what a decided round did to the money. */
export function recapMoney(recap: RoundRecap): string {
  const amount = `${recap.amount.toLocaleString('en-US')} USDC`;
  switch (recap.outcome) {
    case 'scam_paid':
      return `${amount} is gone.`;
    case 'scam_recovered':
      return `${amount} was taken back inside the undo window.`;
    case 'scam_refused':
    case 'scam_reported':
      return `${amount} stayed in the wallet.`;
    case 'legitimate_paid':
    case 'legitimate_paid_with_window':
      return `${amount} paid for something real.`;
    default:
      return 'An honest request was turned away.';
  }
}
