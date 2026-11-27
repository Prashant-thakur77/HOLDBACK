import { hashEvidence, toHex } from '@holdback/sdk';
import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import { evidenceDocument, holdFields, startSession } from './harness';

const sender = Keypair.generate();
const recipient = Keypair.generate().publicKey;

describe('verify_evidence', () => {
  const holdAddress = Keypair.generate().publicKey;
  const hold = holdAddress.toBase58();
  const document = evidenceDocument({
    sender: sender.publicKey.toBase58(),
    recipient: recipient.toBase58(),
    tier: 'SUSPICIOUS',
    windowSecs: 21_600,
  });
  const hash = hashEvidence(document);

  async function sessionWithHold() {
    const session = await startSession();
    session.chain.addHold(
      holdAddress,
      holdFields({ sender: sender.publicKey, recipient, evidenceHash: hash }),
    );
    return session;
  }

  it('verifies a document that hashes to the on-chain value', async () => {
    const session = await sessionWithHold();
    session.guardian.documents.set(toHex(hash), document);

    const { isError, data } = await session.call('verify_evidence', { hold });

    expect(isError).toBe(false);
    expect(data).toMatchObject({
      hold,
      verified: true,
      onChainHash: toHex(hash),
      recomputedHash: toHex(hash),
      documentFound: true,
      describesThisHold: true,
      policyVersion: 'test-1',
      tier: 'SUSPICIOUS',
      windowSecs: 21_600,
    });
  });

  it('fails verification when the published document was altered', async () => {
    const session = await sessionWithHold();
    const altered = { ...document, score: document.score + 1 };
    session.guardian.documents.set(toHex(hash), altered);

    const { data } = await session.call('verify_evidence', { hold });

    expect(data.verified).toBe(false);
    expect(data.documentFound).toBe(true);
    expect(data.onChainHash).toBe(toHex(hash));
    expect(data.recomputedHash).toBe(toHex(hashEvidence(altered)));
    expect(data.recomputedHash).not.toBe(data.onChainHash);
  });

  it('fails verification when no document is published for the hash', async () => {
    const session = await sessionWithHold();
    const { isError, data } = await session.call('verify_evidence', { hold });
    expect(isError).toBe(false);
    expect(data).toMatchObject({ verified: false, documentFound: false, recomputedHash: null });
  });

  it('notices a genuine document that describes other parties', async () => {
    const session = await startSession();
    const foreign = evidenceDocument();
    const foreignHash = hashEvidence(foreign);
    session.chain.addHold(
      holdAddress,
      holdFields({ sender: sender.publicKey, recipient, evidenceHash: foreignHash }),
    );
    session.guardian.documents.set(toHex(foreignHash), foreign);

    const { data } = await session.call('verify_evidence', { hold });

    expect(data).toMatchObject({ verified: true, describesThisHold: false });
  });

  it('needs the hold on-chain and a configured risk service', async () => {
    const empty = await startSession();
    expect((await empty.call('verify_evidence', { hold })).data.code).toBe('hold_not_found');

    const offline = await startSession({ guardian: false });
    offline.chain.addHold(holdAddress, holdFields({ sender: sender.publicKey, recipient }));
    expect((await offline.call('verify_evidence', { hold })).data.code).toBe(
      'guardian_unavailable',
    );
  });
});
