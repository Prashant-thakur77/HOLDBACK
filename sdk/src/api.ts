/**
 * The HTTP contract of the risk agent ("Guardian") and a typed client for
 * it. The web app, the mobile app, the MCP server, the Dojo and the eval
 * scripts all talk to the agent through these types.
 */
import type { TierName } from './constants';
import type { EvidenceDocument, EvidenceItem, Finding } from './evidence';

export const LANGS = ['en', 'hi', 'es', 'pt'] as const;
export type Lang = (typeof LANGS)[number];

/** `mint: null` means native SOL. Amounts are base units as decimal strings. */
export interface AssessRequest {
  sender: string;
  recipient: string;
  mint: string | null;
  amount: string;
  /** The user's own words about why they are paying. Never stored verbatim. */
  context?: string;
  lang: Lang;
}

export interface AssessResponse {
  tier: TierName;
  /** 0..4, the value written on-chain. */
  tierIndex: number;
  windowSecs: number;
  score: number;
  findings: Finding[];
  evidence: EvidenceItem[];
  /** Two or three sentences in the user's language, citing the strongest evidence. */
  spoken: { lang: Lang; text: string };
  /** Hex sha256 of `document`; pass its bytes to `create_hold`. */
  evidenceHash: string;
  document: EvidenceDocument;
  /** Collectors that did not answer in time. */
  unavailable: string[];
  /** True for SANCTIONED: the app must make the user type a confirmation phrase. */
  requiresConfirmation: boolean;
  latencyMs: number;
  /** Where the service keeps evidence. `memory` is a local, non-persistent mode. */
  storage?: { kind: 'supabase' | 'memory'; persistent: boolean };
}

/** A hold as mirrored off-chain, plus what the receipt page shows. */
export interface HoldRecord {
  pda: string;
  sender: string;
  recipient: string;
  /** Mint address, or `null` for SOL. */
  mint: string | null;
  amount: string;
  tier: TierName;
  origin: 'WALLET' | 'DEPOSIT_BOX';
  status: 'PENDING' | 'RELEASED' | 'RECLAIMED';
  createdAt: string;
  releaseAt: string;
  evidenceHash: string;
  createSignature: string | null;
  settleSignature: string | null;
}

export interface HoldReceipt {
  hold: HoldRecord;
  document: EvidenceDocument | null;
  spoken: Partial<Record<Lang, string>>;
  /** URL of the generated voice note for this hold, when one exists. */
  voiceNoteUrl: string | null;
}

export interface ReassessResponse {
  extended: boolean;
  tier: TierName;
  releaseAt: string;
  evidenceHash: string;
  signature: string | null;
}

export interface LiveStats {
  holdsCreated: number;
  holdsReclaimed: number;
  holdsReleased: number;
  /** USD value, from USDC and USD-priced SOL holds. */
  valueProtectedUsd: number;
  valueReclaimedUsd: number;
  updatedAt: string;
}

/** Proof-by-transfer login for wallets that can only make transfers. */
export interface RelayAuthStart {
  challengeId: string;
  /** Keep on the device; needed to complete the challenge. */
  secret: string;
  /** Send exactly this many base units of `mint` to `depositBox`. */
  amount: string;
  mint: string;
  depositBox: string;
  boxTokenAccount: string;
  expiresAt: string;
}

export interface RelaySession {
  token: string;
  owner: string;
  expiresAt: string;
}

export interface RelayOpenRequest {
  recipient: string;
  mint: string;
  amount: string;
  context?: string;
  lang: Lang;
  /** Optional longer window; the agent never goes below its own policy. */
  windowSecs?: number;
}

export interface RelayOpenResponse {
  hold: string;
  signature: string;
  assessment: AssessResponse;
}

export interface VoiceSession {
  /** ElevenLabs agent id and a short-lived signed URL or conversation token. */
  agentId: string;
  signedUrl: string | null;
  conversationToken: string | null;
  /** Injected into the agent at session start. */
  dynamicVariables: Record<string, string | number | boolean>;
}

export interface SeekerVerification {
  /** "Verified Seeker owner": the wallet holds a Seeker Genesis Token. */
  seekerOwner: boolean;
  genesisMint: string | null;
  skrBalance: string | null;
  skrDomain: string | null;
}

/** Sign `message` with the wallet, then exchange the signature for a session. */
export interface AuthChallenge {
  wallet: string;
  message: string;
  challenge: string;
  expiresAt: string;
}

/** A wallet session. The token is also a Supabase JWT with the claim `wallet`. */
export interface WalletSession {
  token: string;
  wallet: string;
  expiresAt: string;
}

export class GuardianError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface GuardianClientOptions {
  baseUrl: string;
  /** Bearer token for relay or wallet-session endpoints. */
  token?: string;
  fetch?: typeof fetch;
}

/** Thin typed wrapper over the agent's REST API. Works in browsers, React Native, Node and Workers. */
export class GuardianClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  token: string | undefined;

  constructor(options: GuardianClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    this.token = options.token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
      throw new GuardianError(
        response.status,
        error?.code ?? 'http_error',
        error?.message ?? `Request failed with status ${response.status}`,
      );
    }
    return payload as T;
  }

  assess(request: AssessRequest): Promise<AssessResponse> {
    return this.request('POST', '/v1/assess', request);
  }

  reassess(pda: string): Promise<ReassessResponse> {
    return this.request('POST', `/v1/holds/${pda}/reassess`);
  }

  receipt(pda: string): Promise<HoldReceipt> {
    return this.request('GET', `/v1/holds/${pda}`);
  }

  holds(wallet: string, role: 'sender' | 'recipient' = 'sender'): Promise<{ holds: HoldRecord[] }> {
    return this.request('GET', `/v1/holds?wallet=${wallet}&role=${role}`);
  }

  evidence(hash: string): Promise<EvidenceDocument> {
    return this.request('GET', `/v1/evidence/${hash}`);
  }

  stats(): Promise<LiveStats> {
    return this.request('GET', '/v1/stats');
  }

  flag(body: {
    subject: string;
    reason: number;
    note?: string;
    captchaToken: string;
    reporter?: string;
  }): Promise<{ id: string }> {
    return this.request('POST', '/v1/flags', body);
  }

  relayAuthStart(owner: string, mint: string): Promise<RelayAuthStart> {
    return this.request('POST', '/v1/relay/auth/start', { owner, mint });
  }

  relayAuthComplete(body: {
    challengeId: string;
    secret: string;
    signature: string;
  }): Promise<RelaySession> {
    return this.request('POST', '/v1/relay/auth/complete', body);
  }

  relayOpen(body: RelayOpenRequest): Promise<RelayOpenResponse> {
    return this.request('POST', '/v1/relay/open', body);
  }

  relayReclaim(hold: string): Promise<{ signature: string }> {
    return this.request('POST', '/v1/relay/reclaim', { hold });
  }

  relayWithdraw(mint: string, amount: string): Promise<{ signature: string }> {
    return this.request('POST', '/v1/relay/withdraw', { mint, amount });
  }

  authChallenge(wallet: string): Promise<AuthChallenge> {
    return this.request('POST', '/v1/auth/challenge', { wallet });
  }

  /** `signature` is the base58 ed25519 signature of the challenge message. */
  authSession(body: {
    wallet: string;
    challenge: string;
    signature: string;
  }): Promise<WalletSession> {
    return this.request('POST', '/v1/auth/session', body);
  }

  /** Asks the oracle to lengthen a hold by `hours`. Needs the sender's session token. */
  voiceExtend(pda: string, hours: number): Promise<ReassessResponse> {
    return this.request('POST', '/v1/voice/extend', { hold: pda, hours });
  }

  voiceSession(pda: string, lang: Lang): Promise<VoiceSession> {
    return this.request('POST', '/v1/voice/session', { hold: pda, lang });
  }

  /** URL of the spoken explanation (audio/mpeg) for an evidence hash. */
  voiceNoteUrl(evidenceHash: string, lang: Lang): string {
    return `${this.baseUrl}/v1/voice/note/${evidenceHash}?lang=${lang}`;
  }

  registerPush(body: { wallet: string; pushToken: string; lang: Lang }): Promise<{ ok: true }> {
    return this.request('POST', '/v1/push/register', body);
  }

  seeker(wallet: string): Promise<SeekerVerification> {
    return this.request('GET', `/v1/seeker/${wallet}`);
  }

  resolveName(
    name: string,
  ): Promise<{ name: string; address: string | null; lookalikeOf: string | null }> {
    return this.request('GET', `/v1/names/${encodeURIComponent(name)}`);
  }
}
