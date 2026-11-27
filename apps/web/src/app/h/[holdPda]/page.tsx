import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { explainRecord, formatTokenAmount, shortAddress } from '@/lib/format';
import { mintMeta } from '@/lib/mints';
import { loadReceipt } from '@/lib/receipt/load';
import { explorerUrl } from '@/lib/cluster';

import { VerifyHash } from './VerifyHash';

// A receipt reflects the chain at the moment it is opened.
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ holdPda: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { holdPda } = await params;
  return { title: `Hold ${shortAddress(holdPda)}` };
}

// Structure only, visual design pending. Data: `loadReceipt(pda)` on the
// server; `useVerifyReceipt` and `useCountdown` in client components.
export default async function ReceiptPage({ params }: Props) {
  const { holdPda } = await params;
  const result = await loadReceipt(holdPda);
  if (result.kind === 'invalid') notFound();
  // A firm "no" from the chain with nothing mirrored is a 404; an outage is not.
  if (result.kind === 'not_found' && result.sources.chain === 'missing') notFound();
  if (result.kind === 'not_found') {
    return (
      <main>
        <h1>Hold receipt</h1>
        <p>This hold cannot be loaded right now. Try again in a moment.</p>
      </main>
    );
  }

  const { receipt } = result;
  const { hold, document } = receipt;
  return (
    <main>
      <h1>Hold receipt</h1>
      <p>{explainRecord(hold)}</p>
      {receipt.holdSource === 'mirror' ? (
        <p>
          The hold account is not readable on-chain right now (it may have been closed after
          settlement). This receipt shows the recorded copy.
        </p>
      ) : null}
      <dl>
        <dt>Status</dt>
        <dd>{hold.status}</dd>
        <dt>Amount</dt>
        <dd>{formatTokenAmount(hold.amount, mintMeta(hold.mint))}</dd>
        <dt>From</dt>
        <dd>
          <a href={explorerUrl('address', hold.sender)}>{hold.sender}</a>
        </dd>
        <dt>To</dt>
        <dd>
          <a href={explorerUrl('address', hold.recipient)}>{hold.recipient}</a>
        </dd>
        <dt>Risk tier</dt>
        <dd>{hold.tier}</dd>
        <dt>Created</dt>
        <dd>
          <time dateTime={hold.createdAt}>{hold.createdAt}</time>
        </dd>
        <dt>Release time</dt>
        <dd>
          <time dateTime={hold.releaseAt}>{hold.releaseAt}</time>
        </dd>
        <dt>Evidence hash</dt>
        <dd>
          <code>{hold.evidenceHash}</code>
        </dd>
        {hold.createSignature ? (
          <>
            <dt>Created in</dt>
            <dd>
              <a href={explorerUrl('tx', hold.createSignature)}>{hold.createSignature}</a>
            </dd>
          </>
        ) : null}
        {hold.settleSignature ? (
          <>
            <dt>Settled in</dt>
            <dd>
              <a href={explorerUrl('tx', hold.settleSignature)}>{hold.settleSignature}</a>
            </dd>
          </>
        ) : null}
      </dl>

      <section aria-label="Evidence">
        <h2>Evidence</h2>
        {receipt.spoken.en ? <p>{receipt.spoken.en}</p> : null}
        {receipt.voiceNoteUrl ? <audio controls src={receipt.voiceNoteUrl} /> : null}
        {document ? (
          <ul>
            {document.evidence.map((item, index) => (
              <li key={index}>
                {item.detail} {item.url ? <a href={item.url}>{item.source}</a> : item.source}
              </li>
            ))}
          </ul>
        ) : (
          <p>The evidence document for this hold is not available right now.</p>
        )}
        <VerifyHash pda={receipt.pda} evidenceHash={hold.evidenceHash} document={document} />
      </section>
    </main>
  );
}
