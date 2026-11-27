import { pathToRegexp } from 'next/dist/compiled/path-to-regexp';
import { describe, expect, it } from 'vitest';

import {
  DOJO_EMBED_CSP,
  contentSecurityPolicy,
  headerRules,
  type CspInputs,
} from '@/lib/security-headers';

const inputs: CspInputs = {
  connect: [
    'https://agent.example.workers.dev/v1',
    'https://api.devnet.solana.com',
    'https://project.supabase.co',
    null,
  ],
  media: ['https://agent.example.workers.dev/v1', 'https://project.supabase.co'],
};

/**
 * The headers a path ends up with, resolved the way Next.js does it: rules
 * are matched with path-to-regexp in order and a later rule overrides an
 * earlier one for the same header.
 */
function headersFor(path: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const rule of headerRules(inputs)) {
    if (!pathToRegexp(rule.source).test(path)) continue;
    for (const { key, value } of rule.headers) result.set(key.toLowerCase(), value);
  }
  return result;
}

describe('security headers', () => {
  it.each(['/dojo/watch/run-1', '/dojo/watch/x/y', '/dojo/watch'])(
    'lets the arena frame %s with exactly the required policy',
    (path) => {
      const headers = headersFor(path);
      expect(headers.get('content-security-policy')).toBe(
        'frame-ancestors https://app.bytearena.fun',
      );
      expect(DOJO_EMBED_CSP).toBe('frame-ancestors https://app.bytearena.fun');
      expect(headers.has('x-frame-options')).toBe(false);
      expect(headers.get('x-content-type-options')).toBe('nosniff');
    },
  );

  it.each([
    '/',
    '/app',
    '/h/abc',
    '/pay',
    '/api/health',
    '/api/dojo/runs',
    '/dojo',
    '/dojo/watching',
  ])('forbids framing %s', (path) => {
    const csp = headersFor(path).get('content-security-policy') ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('bytearena');
    expect(headersFor(path).get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(headersFor(path).get('x-content-type-options')).toBe('nosniff');
  });

  it('limits network access to the configured services, including their sockets', () => {
    const csp = contentSecurityPolicy(inputs);
    const connect = csp.split('; ').find((directive) => directive.startsWith('connect-src'));
    expect(connect).toBe(
      "connect-src 'self' https://agent.example.workers.dev wss://agent.example.workers.dev " +
        'https://api.devnet.solana.com wss://api.devnet.solana.com ' +
        'https://project.supabase.co wss://project.supabase.co',
    );
    expect(csp).toContain(
      "media-src 'self' blob: https://agent.example.workers.dev https://project.supabase.co;",
    );
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('unsafe-eval');
  });

  it('allows eval only in development', () => {
    expect(contentSecurityPolicy({ connect: [], development: true })).toContain("'unsafe-eval'");
  });
});
