/**
 * Everything the Worker reads from its environment. Each value is optional
 * on purpose: a missing credential switches the feature that needs it to
 * "unavailable" instead of breaking the whole service.
 */

/** The subset of an R2 bucket this service uses. An `R2Bucket` binding satisfies it. */
export interface VoiceBucket {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
}

export interface Env {
  /** RPC of the cluster the HOLDBACK program runs on (devnet). */
  SOLANA_RPC_URL?: string;
  /** Mainnet RPC for wallet history, names and Seeker checks. Defaults to Helius, then the public endpoint. */
  MAINNET_RPC_URL?: string;
  /** Overrides the program id baked into the SDK's IDL. */
  PROGRAM_ID?: string;

  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Signs wallet-session JWTs that Supabase accepts (Realtime under RLS). */
  SUPABASE_JWT_SECRET?: string;

  HELIUS_API_KEY?: string;
  CHAINABUSE_API_KEY?: string;
  /** Calls allowed per calendar month on the single Chainabuse key. */
  CHAINABUSE_MONTHLY_BUDGET?: string;
  FIRECRAWL_API_KEY?: string;
  SNS_API_URL?: string;

  /** `anthropic` (default) or `openai`. */
  LLM_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;

  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_AGENT_ID?: string;
  ELEVENLABS_VOICE_ID?: string;
  ELEVENLABS_TTS_MODEL?: string;
  /** Twilio number imported into ElevenLabs, for outbound calls. */
  ELEVENLABS_PHONE_NUMBER_ID?: string;
  /** Minimum USD value of a FLAGGED hold that triggers an outbound call. */
  OUTBOUND_CALL_MIN_USD?: string;
  VOICE_REQUIRE_AUTH?: string;

  /** Signing keys, base58 or a JSON byte array. Never logged. */
  ORACLE_KEYPAIR?: string;
  RELAYER_KEYPAIR?: string;
  CRANK_KEYPAIR?: string;

  /** Shared secrets for `/v1/crank` and `/v1/dojo/memo`. */
  CRANK_SECRET?: string;
  DOJO_SECRET?: string;
  /** Signs relay sessions and sign-in challenges. */
  SESSION_JWT_SECRET?: string;

  TURNSTILE_SECRET_KEY?: string;
  /** `true` mirrors well-supported off-chain flags on-chain with the crank key. */
  FLAG_MIRROR_ONCHAIN?: string;
  FLAG_MIRROR_MIN_REPORTS?: string;

  EXPO_ACCESS_TOKEN?: string;
  /** Public origin of this service, used in voice-note links. */
  PUBLIC_BASE_URL?: string;

  VOICE_BUCKET?: VoiceBucket;
}

/** Background work that may outlive the response (Workers' `ctx.waitUntil`). */
export interface Background {
  waitUntil(promise: Promise<unknown>): void;
}

export function numberVar(value: string | undefined, fallback: number): number {
  const parsed = value === undefined || value === '' ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function flag(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}
