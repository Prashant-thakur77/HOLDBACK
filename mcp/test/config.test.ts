import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { afterAll, describe, expect, it } from 'vitest';

import { exceedsCap } from '../src/assets';
import { ConfigError, DEFAULT_RPC_URL, loadConfig } from '../src/config';
import { ToolError, redact, toErrorBody } from '../src/errors';

const keypair = Keypair.generate();
const directory = mkdtempSync(join(tmpdir(), 'holdback-mcp-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('loadConfig', () => {
  it('defaults to devnet, no risk service, no key and no cap', () => {
    expect(loadConfig({})).toEqual({
      rpcUrl: DEFAULT_RPC_URL,
      guardianUrl: null,
      signer: null,
      maxAmount: null,
    });
  });

  it('reads a keypair from a file or from a base58 secret key', () => {
    const file = join(directory, 'id.json');
    writeFileSync(file, JSON.stringify([...keypair.secretKey]));

    const fromFile = loadConfig({ HOLDBACK_KEYPAIR: file });
    expect(fromFile.signer?.publicKey.equals(keypair.publicKey)).toBe(true);

    const fromBase58 = loadConfig({ HOLDBACK_KEYPAIR: bs58.encode(keypair.secretKey) });
    expect(fromBase58.signer?.publicKey.equals(keypair.publicKey)).toBe(true);
  });

  it('never repeats a bad key in the error', () => {
    const secret = bs58.encode(keypair.secretKey).slice(0, 60);
    let message = '';
    try {
      loadConfig({ HOLDBACK_KEYPAIR: secret });
    } catch (failure) {
      expect(failure).toBeInstanceOf(ConfigError);
      message = (failure as Error).message;
    }
    expect(message).toContain('HOLDBACK_KEYPAIR');
    expect(message).not.toContain(secret);
  });

  it('validates the URLs and the cap', () => {
    expect(() => loadConfig({ HOLDBACK_RPC_URL: 'not a url' })).toThrow(ConfigError);
    expect(() => loadConfig({ HOLDBACK_GUARDIAN_URL: 'ftp://guardian.example' })).toThrow(
      ConfigError,
    );
    expect(() => loadConfig({ HOLDBACK_MAX_AMOUNT: '-5' })).toThrow(ConfigError);
    expect(() => loadConfig({ HOLDBACK_MAX_AMOUNT: '0' })).toThrow(ConfigError);
    expect(loadConfig({ HOLDBACK_MAX_AMOUNT: ' 250.5 ' }).maxAmount).toBe('250.5');
  });
});

describe('exceedsCap', () => {
  it('compares exactly across decimal scales', () => {
    expect(exceedsCap(100_000_000n, 6, '100')).toBe(false);
    expect(exceedsCap(100_000_001n, 6, '100')).toBe(true);
    expect(exceedsCap(1_500_000_000n, 9, '1.5')).toBe(false);
    expect(exceedsCap(1_500_000_001n, 9, '1.5')).toBe(true);
    // A cap with more decimals than the mint still compares correctly.
    expect(exceedsCap(12n, 1, '1.25')).toBe(false);
    expect(exceedsCap(13n, 1, '1.25')).toBe(true);
  });
});

describe('error bodies', () => {
  it('strips credentials from messages', () => {
    const failure = new Error('fetch https://rpc.example/?api-key=abc123&x=1 failed');
    expect(toErrorBody(failure)).toEqual({
      code: 'internal_error',
      message: 'fetch https://rpc.example/?api-key=***&x=1 failed',
    });
    expect(redact('GET /v0?token=s3cret')).toBe('GET /v0?token=***');
  });

  it('keeps the code and details of a tool refusal', () => {
    expect(toErrorBody(new ToolError('amount_over_cap', 'Refused', { maxAmount: '5' }))).toEqual({
      code: 'amount_over_cap',
      message: 'Refused',
      details: { maxAmount: '5' },
    });
  });
});
