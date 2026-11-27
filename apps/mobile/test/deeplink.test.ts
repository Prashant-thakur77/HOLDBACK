import { describe, expect, it } from 'vitest';

import { parseDeepLink, routeFor, targetFromNotification } from '@/lib/deeplink';
import { classifyRecipient, parseScannedCode } from '@/lib/recipient';

const PDA = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const OTHER = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

describe('parseDeepLink', () => {
  it('parses a hold link', () => {
    expect(parseDeepLink(`holdback://hold/${PDA}`)).toEqual({ kind: 'hold', pda: PDA });
  });

  it('tolerates a trailing slash, a query string and a triple slash', () => {
    expect(parseDeepLink(`holdback://hold/${PDA}/`)).toEqual({ kind: 'hold', pda: PDA });
    expect(parseDeepLink(`holdback://hold/${PDA}?from=push`)).toEqual({ kind: 'hold', pda: PDA });
    expect(parseDeepLink(`holdback:///hold/${PDA}`)).toEqual({ kind: 'hold', pda: PDA });
  });

  it('rejects a hold link whose address is not a public key', () => {
    expect(parseDeepLink('holdback://hold/not-an-address')).toBeNull();
    expect(parseDeepLink('holdback://hold/')).toBeNull();
    expect(parseDeepLink(`holdback://hold/${PDA}/extra`)).toBeNull();
    expect(parseDeepLink('holdback://hold/../../settings')).toBeNull();
  });

  it('parses a send link with and without an amount', () => {
    expect(parseDeepLink(`holdback://send?to=${OTHER}&amount=12.5`)).toEqual({
      kind: 'send',
      recipient: OTHER,
      amount: '12.5',
    });
    expect(parseDeepLink(`holdback://send?to=${OTHER}`)).toEqual({
      kind: 'send',
      recipient: OTHER,
      amount: null,
    });
  });

  it('drops an amount that is not a plain decimal', () => {
    expect(parseDeepLink(`holdback://send?to=${OTHER}&amount=1e9`)).toEqual({
      kind: 'send',
      recipient: OTHER,
      amount: null,
    });
  });

  it('ignores other schemes, hosts and empty input', () => {
    expect(parseDeepLink(`https://example.com/hold/${PDA}`)).toBeNull();
    expect(parseDeepLink('holdback://settings')).toBeNull();
    expect(parseDeepLink('holdback://send?to=nobody')).toBeNull();
    expect(parseDeepLink('')).toBeNull();
    expect(parseDeepLink(null)).toBeNull();
  });
});

describe('targetFromNotification', () => {
  it('reads a link or a bare hold address from the payload', () => {
    expect(targetFromNotification({ url: `holdback://hold/${PDA}` })).toEqual({
      kind: 'hold',
      pda: PDA,
    });
    expect(targetFromNotification({ hold: PDA })).toEqual({ kind: 'hold', pda: PDA });
  });

  it('falls back to the hold field when the link is unusable', () => {
    expect(targetFromNotification({ url: 'https://evil.example', hold: PDA })).toEqual({
      kind: 'hold',
      pda: PDA,
    });
  });

  it('returns null for payloads without a valid target', () => {
    expect(targetFromNotification(null)).toBeNull();
    expect(targetFromNotification('text')).toBeNull();
    expect(targetFromNotification({ hold: 42 })).toBeNull();
    expect(targetFromNotification({ hold: 'nope' })).toBeNull();
  });
});

describe('routeFor', () => {
  it('builds in-app routes', () => {
    expect(routeFor({ kind: 'hold', pda: PDA })).toBe(`/hold/${PDA}`);
    expect(routeFor({ kind: 'send', recipient: OTHER, amount: '5' })).toBe(
      `/send?to=${OTHER}&amount=5`,
    );
    expect(routeFor({ kind: 'send', recipient: 'maya.sol', amount: null })).toBe(
      '/send?to=maya.sol',
    );
  });
});

describe('classifyRecipient', () => {
  it('recognises addresses and names', () => {
    expect(classifyRecipient(` ${PDA} `)).toEqual({ kind: 'address', address: PDA });
    expect(classifyRecipient('Maya.SOL')).toEqual({ kind: 'name', name: 'maya.sol' });
    expect(classifyRecipient('shop.pay.skr')).toEqual({ kind: 'name', name: 'shop.pay.skr' });
  });

  it('rejects everything else', () => {
    expect(classifyRecipient('')).toEqual({ kind: 'empty' });
    expect(classifyRecipient('maya')).toEqual({ kind: 'invalid' });
    expect(classifyRecipient('maya.eth')).toEqual({ kind: 'invalid' });
    expect(classifyRecipient('0x52908400098527886E0F7030069857D2E4169EE7')).toEqual({
      kind: 'invalid',
    });
    expect(classifyRecipient(PDA.slice(0, 20))).toEqual({ kind: 'invalid' });
  });
});

describe('parseScannedCode', () => {
  it('reads a bare address or name', () => {
    expect(parseScannedCode(PDA)).toEqual({
      recipient: PDA,
      amount: null,
      mint: null,
      label: null,
    });
    expect(parseScannedCode('maya.sol')?.recipient).toBe('maya.sol');
  });

  it('reads a solana: payment URL', () => {
    expect(
      parseScannedCode(`solana:${OTHER}?amount=2.5&spl-token=${PDA}&label=Coffee%20Cart`),
    ).toEqual({
      recipient: OTHER,
      amount: '2.5',
      mint: PDA,
      label: 'Coffee Cart',
    });
  });

  it('ignores a token parameter that is not a mint address', () => {
    expect(parseScannedCode(`solana:${OTHER}?spl-token=USDC`)?.mint).toBeNull();
  });

  it('ignores codes that are not payments', () => {
    expect(parseScannedCode('https://example.com')).toBeNull();
    expect(parseScannedCode('solana:not-an-address?amount=1')).toBeNull();
    expect(parseScannedCode('WIFI:S:cafe;T:WPA;P:secret;;')).toBeNull();
  });
});
