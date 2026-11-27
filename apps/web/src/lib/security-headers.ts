/**
 * Response headers for every route, as `next.config.ts` hands them to
 * Next.js. Kept free of framework and environment imports so the same
 * function is used by the config and checked by the tests.
 *
 * Two policies exist:
 *
 * - Everywhere: a Content-Security-Policy that limits scripts to this origin,
 *   limits network access to the services the app is configured for, and
 *   forbids framing.
 * - `/dojo/watch/*` only: `frame-ancestors https://app.bytearena.fun` and
 *   nothing else. The spectator page is embedded by the arena, which requires
 *   exactly this header; the page is read-only and never touches a wallet.
 */

export const DOJO_EMBED_CSP = 'frame-ancestors https://app.bytearena.fun';
export const DOJO_WATCH_SOURCE = '/dojo/watch/:path*';

export interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

export interface CspInputs {
  /** Origins the browser calls: the agent, the RPC endpoint and Supabase. */
  connect: (string | null)[];
  /** Origins that serve audio: voice notes come from the agent or from storage. */
  media?: (string | null)[];
  /** Adds what React's development mode needs (`eval` for stack reconstruction). */
  development?: boolean;
}

function origin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** `https://x` also allows `wss://x`: RPC subscriptions and Realtime use WebSockets. */
function withSockets(origins: string[]): string[] {
  return origins.flatMap((value) => [value, value.replace(/^http/, 'ws')]);
}

export function contentSecurityPolicy(inputs: CspInputs): string {
  const origins = (urls: (string | null)[] = []) => [
    ...new Set(urls.flatMap((url) => (url ? (origin(url) ?? []) : []))),
  ];
  const script = ["'self'", "'unsafe-inline'", ...(inputs.development ? ["'unsafe-eval'"] : [])];
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    // Next.js streams page data through inline scripts, hence 'unsafe-inline'.
    ['script-src', script],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:']],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', ["'self'", ...withSockets(origins(inputs.connect))]],
    ['media-src', ["'self'", 'blob:', ...origins(inputs.media)]],
    ['frame-ancestors', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['object-src', ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

const COMMON: HeaderRule['headers'] = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), payment=()' },
];

/**
 * Rules in the order Next.js applies them: when two rules set the same header
 * for a path, the later one wins. The catch-all therefore comes first and the
 * watch-page rule replaces its Content-Security-Policy.
 */
export function headerRules(inputs: CspInputs): HeaderRule[] {
  return [
    {
      source: '/:path*',
      headers: [
        ...COMMON,
        { key: 'Content-Security-Policy', value: contentSecurityPolicy(inputs) },
      ],
    },
    {
      source: DOJO_WATCH_SOURCE,
      headers: [{ key: 'Content-Security-Policy', value: DOJO_EMBED_CSP }],
    },
  ];
}
