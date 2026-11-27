import { describe, expect, it } from 'vitest';

import { EnvError, parsePublicEnv } from '@/lib/env';
import { parseServerEnv } from '@/lib/env.server';

const KEY = 'k'.repeat(40);

describe('parsePublicEnv', () => {
  it('defaults to devnet on localhost with every integration off', () => {
    expect(parsePublicEnv({})).toEqual({
      siteUrl: 'http://localhost:3000',
      agentUrl: null,
      cluster: 'devnet',
      rpcUrl: null,
      supabaseUrl: null,
      supabaseAnonKey: null,
      build: { commit: 'unknown', time: 'unknown' },
    });
  });

  it('treats empty variables as unset', () => {
    const env = parsePublicEnv({
      NEXT_PUBLIC_AGENT_URL: '',
      NEXT_PUBLIC_SOLANA_CLUSTER: ' ',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
    });
    expect(env.agentUrl).toBeNull();
    expect(env.cluster).toBe('devnet');
    expect(env.supabaseAnonKey).toBeNull();
  });

  it('reads a full configuration and strips trailing slashes', () => {
    const env = parsePublicEnv({
      NEXT_PUBLIC_SITE_URL: 'https://holdback.example/',
      NEXT_PUBLIC_AGENT_URL: 'https://agent.example.workers.dev//',
      NEXT_PUBLIC_SOLANA_CLUSTER: 'mainnet-beta',
      NEXT_PUBLIC_SOLANA_RPC_URL: 'https://rpc.example/?api-key=abc',
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: KEY,
      NEXT_PUBLIC_BUILD_COMMIT: 'abc1234',
      NEXT_PUBLIC_BUILD_TIME: '2026-11-27T00:00:00.000Z',
    });
    expect(env).toEqual({
      siteUrl: 'https://holdback.example',
      agentUrl: 'https://agent.example.workers.dev',
      cluster: 'mainnet-beta',
      rpcUrl: 'https://rpc.example/?api-key=abc',
      supabaseUrl: 'https://project.supabase.co',
      supabaseAnonKey: KEY,
      build: { commit: 'abc1234', time: '2026-11-27T00:00:00.000Z' },
    });
  });

  it('fails loudly on malformed values and names the variable, not its value', () => {
    const attempt = () =>
      parsePublicEnv({
        NEXT_PUBLIC_AGENT_URL: 'agent.example.com',
        NEXT_PUBLIC_SOLANA_CLUSTER: 'mainnet',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'short-secret',
      });
    expect(attempt).toThrow(EnvError);
    try {
      attempt();
    } catch (failure) {
      const { issues, message } = failure as EnvError;
      expect(issues.map((issue) => issue.split(':')[0])).toEqual([
        'NEXT_PUBLIC_AGENT_URL',
        'NEXT_PUBLIC_SOLANA_CLUSTER',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      ]);
      expect(message).not.toContain('short-secret');
      expect(message).not.toContain('agent.example.com');
    }
  });
});

describe('parseServerEnv', () => {
  it('has every server integration off by default', () => {
    expect(parseServerEnv({})).toEqual({
      agentUrl: null,
      rpcUrl: null,
      supabaseServiceRoleKey: null,
      dojoSecret: null,
    });
  });

  it('reads server-only values', () => {
    const env = parseServerEnv({
      AGENT_URL: 'https://agent.internal.example/',
      SOLANA_RPC_URL: 'https://devnet.helius-rpc.com/?api-key=abc',
      SUPABASE_SERVICE_ROLE_KEY: KEY,
      DOJO_SECRET: 's'.repeat(32),
    });
    expect(env).toEqual({
      agentUrl: 'https://agent.internal.example',
      rpcUrl: 'https://devnet.helius-rpc.com/?api-key=abc',
      supabaseServiceRoleKey: KEY,
      dojoSecret: 's'.repeat(32),
    });
  });

  it('rejects a secret that is too short to be real', () => {
    expect(() => parseServerEnv({ DOJO_SECRET: 'abc' })).toThrow(/DOJO_SECRET/);
  });
});
