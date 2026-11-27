/**
 * Shared types: the scenario corpus, the public game state and the moves.
 *
 * Field names in `DojoState` are snake_case whole words on purpose. The state
 * is read by a language-model player as raw JSON, so the names have to explain
 * themselves without a schema.
 */

export const INVESTIGATIONS = ['ask_question', 'verify_identity', 'check_address'] as const;
export const DECISIONS = ['pay', 'pay_with_holdback', 'refuse', 'report'] as const;
/** The closed move list. Nothing outside it is ever accepted. */
export const MOVES = [...INVESTIGATIONS, ...DECISIONS] as const;

export type Investigation = (typeof INVESTIGATIONS)[number];
export type Decision = (typeof DECISIONS)[number];
export type Move = (typeof MOVES)[number];

export const CHANNELS = ['sms', 'whatsapp', 'call', 'email', 'dm'] as const;
export type Channel = (typeof CHANNELS)[number];

export const REGIONS = ['india', 'latam', 'global'] as const;
export type Region = (typeof REGIONS)[number];

export type Truth = 'scam' | 'legitimate';

/** What a piece of evidence points to. Never shown to the player. */
export type Signal = Truth | 'unclear';

export interface Clue {
  text: string;
  signal: Signal;
}

/** One payment request with its ground truth. Only part of it is ever public. */
export interface Scenario {
  id: string;
  truth: Truth;
  /** Short machine name of the pattern, e.g. `romance` or `rent`. */
  category: string;
  /** The publicly known pattern this scenario represents, in one line. */
  basis: string;
  /** Advisories about the pattern that were opened and read while writing it. */
  sources?: string[];
  region: Region;
  channel: Channel;
  from: string;
  transcript: string[];
  ask: {
    /** Practice USDC. */
    amount: number;
    /** Recipient address fixture; a throwaway key, never a real person's wallet. */
    to: string;
    /** What the requester says the money is for. */
    purpose: string;
  };
  /** Revealed one at a time by `ask_question`, in this order. */
  clues: Clue[];
  /** Revealed by `verify_identity`: what the official channel says. */
  identity: Clue;
  /** Scam: the warning signs. Legitimate: what made it trustworthy. */
  tells: string[];
  /** One sentence the player should take away. */
  lesson: string;
}

export interface PublicScenario {
  channel: Channel;
  from: string;
  transcript: string[];
  ask: { amount: number; currency: 'USDC'; to: string; purpose: string };
}

export interface RevealedClue {
  source: 'question' | 'identity' | 'address';
  text: string;
}

export type InvestigationOutcome =
  'clue_revealed' | 'identity_checked' | 'address_checked' | 'address_unavailable';

export type DecisionOutcome =
  | 'scam_refused'
  | 'scam_reported'
  | 'scam_recovered'
  | 'scam_paid'
  | 'legitimate_paid'
  | 'legitimate_paid_with_window'
  | 'legitimate_refused'
  | 'legitimate_reported';

/** One accepted move. `turn` equals the entry's index in `history`. */
export interface HistoryEntry {
  turn: number;
  round: number;
  move: Move;
  outcome: InvestigationOutcome | DecisionOutcome;
  points: number;
}

/** The truth about a finished round, shown only after the player has decided. */
export interface RoundRecap {
  round: number;
  scenario_id: string;
  category: string;
  was_scam: boolean;
  decision: Decision;
  outcome: DecisionOutcome;
  correct: boolean;
  points: number;
  amount: number;
  tells: string[];
  lesson: string;
}

export type MemoStatus = 'pending' | 'written' | 'unavailable';

export interface RunResult {
  outcome: 'won' | 'lost';
  reason: 'cleared' | 'below_win_score' | 'out_of_lives';
  score: number;
  rounds_survived: number;
  correct_decisions: number;
  money_lost: number;
  money_recovered: number;
  /** sha256 of `canonicalHistory(history)`, hex. */
  history_sha256: string;
  /** The text written to Solana devnet as a Memo. */
  memo: string;
  memo_status: MemoStatus;
  memo_signature: string | null;
}

export type RunStatus = 'playing' | 'won' | 'lost';

/** The complete public state. Every HTTP response carries all of it. */
export interface DojoState {
  run_id: string;
  player: string;
  status: RunStatus;
  done: boolean;
  /** Number of accepted moves so far. Send it back with the next move. */
  turn: number;
  round: number;
  max_rounds: number;
  /** Rounds finished with at least one life left. */
  rounds_survived: number;
  lives: number;
  score: number;
  win_score: number;
  wallet: number;
  /** The amount the current request asks for; 0 once the run is over. */
  money_at_risk: number;
  money_lost: number;
  money_recovered: number;
  scenario: PublicScenario | null;
  revealed_clues: RevealedClue[];
  /** What a correct `pay` or `refuse` earns right now. Investigating lowers it. */
  points_available: number;
  legal_moves: Move[];
  last_round: RoundRecap | null;
  history: HistoryEntry[];
  result: RunResult | null;
}

/**
 * What `check_address` learned from the HOLDBACK risk agent. The engine is
 * pure, so the caller fetches the verdict and passes it in.
 */
export type AddressCheck =
  | { available: true; tier: string; score: number; window_secs: number; summary: string }
  | { available: false };

export interface MoveOutcome {
  /** The new state when `applied`, otherwise the unchanged input state. */
  state: DojoState;
  applied: boolean;
  /** Why the move was not applied, in words a player can act on. */
  error: string | null;
}
