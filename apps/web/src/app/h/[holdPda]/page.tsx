import type { EvidenceDocument, HoldRecord } from '@holdback/sdk';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BoxStamp } from '@/components/art/Stamps';
import { Ticket } from '@/components/art/Ticket';
import { Copy } from '@/components/site/Copy';
import { explorerUrl } from '@/lib/cluster';
import { explainRecord, formatTokenAmount, shortAddress } from '@/lib/format';
import { TIER_INK, windowLabel } from '@/lib/i18n';
import { mintMeta } from '@/lib/mints';
import { loadReceipt } from '@/lib/receipt/load';

import { ReceiptClock } from './ReceiptClock';
import { Spoken } from './Spoken';
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

const STATUS_WORDS: Record<HoldRecord['status'], string> = {
  PENDING: 'Held',
  RECLAIMED: 'Taken back',
  RELEASED: 'Released',
};

const PLAIN_TIER: Record<HoldRecord['tier'], string> = {
  TRUSTED: 'Trusted recipient',
  UNKNOWN: 'New recipient, no warning signs found',
  SUSPICIOUS: 'Some warning signs',
  FLAGGED: 'Flagged: scam reports or a high score',
  SANCTIONED: 'On a sanctions list',
};

function when(iso: string): string {
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return iso;
  const date = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(time);
  return `${date} UTC`;
}

function Address({ value, label }: { value: string; label: string }) {
  return (
    <span className="addr">
      <a href={explorerUrl('address', value)} className="mono link" rel="noreferrer">
        {value}
      </a>
      <Copy value={value} label={label} />
    </span>
  );
}

function Evidence({ document }: { document: EvidenceDocument }) {
  return (
    <>
      <dl className="ledger receipt__score" style={{ ['--cols' as string]: 3 }}>
        <div className="ledger__cell">
          <dt className="label">Risk score</dt>
          <dd className="num">{document.score}</dd>
        </div>
        <div className="ledger__cell">
          <dt className="label">Pieces of evidence</dt>
          <dd className="num">{document.evidence.length}</dd>
        </div>
        <div className="ledger__cell">
          <dt className="label">Policy version</dt>
          <dd className="receipt__policy mono">{document.policyVersion}</dd>
        </div>
      </dl>

      {document.findings.length > 0 ? (
        <ul className="findings">
          {document.findings.map((finding) => (
            <li
              key={finding.id}
              className="notice"
              data-ink={
                finding.level === 'info'
                  ? 'blue'
                  : finding.level === 'warning'
                    ? 'ochre'
                    : 'magenta'
              }
            >
              <strong>{finding.title}</strong>{' '}
              <span className="quiet small">
                {finding.points > 0 ? '+' : ''}
                {finding.points} points
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {document.evidence.length > 0 ? (
        <ol className="evidence">
          {document.evidence.map((item, index) => (
            <li key={`${item.source}-${item.signal}-${index}`} className="evidence__item">
              <p className="evidence__n mono" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </p>
              <div>
                <p>{item.detail}</p>
                {item.quote ? (
                  <blockquote className="evidence__quote">“{item.quote}”</blockquote>
                ) : null}
                <p className="small quiet evidence__meta">
                  <span className="mono">
                    {item.source}.{item.signal}
                  </span>
                  <span>
                    {item.weight > 0 ? '+' : ''}
                    {item.weight} points
                  </span>
                  {item.date ? <span>{item.date}</span> : null}
                  {item.url ? (
                    <a href={item.url} className="link" rel="noreferrer nofollow">
                      Check the source
                    </a>
                  ) : null}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="notice">
          No evidence was found against this recipient. That is not a promise: it means no warning
          signs were found at the time.
        </p>
      )}

      {document.unavailable.length > 0 ? (
        <p className="small quiet">
          Sources that did not answer in time and added no points:{' '}
          <span className="mono">{document.unavailable.join(', ')}</span>
        </p>
      ) : null}
      <p className="small quiet">Assessed {when(document.assessedAt)}.</p>
    </>
  );
}

export default async function ReceiptPage({ params }: Props) {
  const { holdPda } = await params;
  const result = await loadReceipt(holdPda);
  if (result.kind === 'invalid') notFound();
  // A firm "no" from the chain with nothing mirrored is a 404; an outage is not.
  if (result.kind === 'not_found' && result.sources.chain === 'missing') notFound();
  if (result.kind === 'not_found') {
    return (
      <main className="receipt wrap">
        <p className="label receipt__kicker">Hold receipt</p>
        <h1 className="h2">This receipt cannot be loaded right now</h1>
        <hr className="rule" />
        <p className="lead receipt__sentence">
          Neither the chain nor the risk agent answered for this address. The hold, if there is one,
          is not affected. Try again in a moment.
        </p>
        <p className="mono receipt__pda">{holdPda}</p>
        <a href={`/h/${holdPda}`} className="btn">
          Try again
        </a>
      </main>
    );
  }

  const { receipt } = result;
  const { hold, document } = receipt;
  const ink = TIER_INK[hold.tier];
  const [figure = '', ...unit] = formatTokenAmount(hold.amount, mintMeta(hold.mint)).split(' ');
  const windowSecs = Math.max(
    0,
    Math.round((Date.parse(hold.releaseAt) - Date.parse(hold.createdAt)) / 1000),
  );
  const statusInk =
    hold.status === 'RECLAIMED' ? 'red' : hold.status === 'RELEASED' ? 'ink' : 'blue';

  return (
    <main className="receipt wrap" data-ink={ink}>
      <p className="label receipt__kicker">
        <i className="patch" aria-hidden="true" /> Hold receipt
      </p>
      <h1 className="h2 receipt__title">
        {figure} {unit.join(' ')}, {STATUS_WORDS[hold.status].toLowerCase()}
      </h1>
      <p className="receipt__pda">
        <span className="mono">{receipt.pda}</span>
        <Copy value={receipt.pda} label="hold address" />
      </p>
      <hr className="rule" />

      <div className="receipt__top">
        <div className="receipt__ticket">
          <Ticket
            ink={ink}
            windowSecs={windowSecs}
            serial={shortAddress(receipt.pda)}
            amount={figure}
            unit={unit.join(' ')}
            blockNote={STATUS_WORDS[hold.status]}
            gridLabel="Hours the sender can take it back"
            tierLabel={hold.tier}
            windowText={windowLabel(windowSecs, 'en')}
            footLine="Window set from the evidence below. Hash on-chain."
            title={`Hold of ${figure} ${unit.join(' ')}, tier ${hold.tier}, window ${windowLabel(windowSecs, 'en')}`}
          >
            {/* A stamp records an outcome; a hold that is still open has none yet. */}
            {hold.status === 'PENDING' ? null : (
              <BoxStamp text={STATUS_WORDS[hold.status]} ink={statusInk} rotate={-6} size={60} />
            )}
          </Ticket>
        </div>

        <div className="receipt__facts">
          <p className="lead receipt__sentence">{explainRecord(hold)}</p>
          <ReceiptClock
            status={hold.status}
            createdAt={hold.createdAt}
            releaseAt={hold.releaseAt}
          />
          {receipt.holdSource === 'mirror' ? (
            <p className="notice" data-ink="ochre">
              The hold account is not readable on-chain right now (it may have been closed after
              settlement). This receipt shows the recorded copy.
            </p>
          ) : null}
        </div>
      </div>

      <dl className="kv receipt__kv">
        <div className="kv__row">
          <dt>Status</dt>
          <dd>
            <span className="pill" data-ink={statusInk}>
              {STATUS_WORDS[hold.status]}
            </span>{' '}
            <span className="small quiet mono">{hold.status}</span>
          </dd>
        </div>
        <div className="kv__row">
          <dt>Amount</dt>
          <dd>{formatTokenAmount(hold.amount, mintMeta(hold.mint))}</dd>
        </div>
        <div className="kv__row">
          <dt>From</dt>
          <dd>
            <Address value={hold.sender} label="sender address" />
          </dd>
        </div>
        <div className="kv__row">
          <dt>To</dt>
          <dd>
            <Address value={hold.recipient} label="recipient address" />
          </dd>
        </div>
        <div className="kv__row">
          <dt>Risk tier</dt>
          <dd>
            <span className="pill">{PLAIN_TIER[hold.tier]}</span>{' '}
            <span className="small quiet mono">{hold.tier}</span>
          </dd>
        </div>
        <div className="kv__row">
          <dt>Created</dt>
          <dd>
            <time dateTime={hold.createdAt}>{when(hold.createdAt)}</time>
          </dd>
        </div>
        <div className="kv__row">
          <dt>Release time</dt>
          <dd>
            <time dateTime={hold.releaseAt}>{when(hold.releaseAt)}</time>
          </dd>
        </div>
        <div className="kv__row">
          <dt>Evidence hash</dt>
          <dd>
            <span className="addr">
              <code>{hold.evidenceHash}</code>
              <Copy value={hold.evidenceHash} label="evidence hash" />
            </span>
          </dd>
        </div>
        {hold.createSignature ? (
          <div className="kv__row">
            <dt>Created in</dt>
            <dd>
              <a
                href={explorerUrl('tx', hold.createSignature)}
                className="mono link"
                rel="noreferrer"
              >
                {hold.createSignature}
              </a>
            </dd>
          </div>
        ) : null}
        {hold.settleSignature ? (
          <div className="kv__row">
            <dt>Settled in</dt>
            <dd>
              <a
                href={explorerUrl('tx', hold.settleSignature)}
                className="mono link"
                rel="noreferrer"
              >
                {hold.settleSignature}
              </a>
            </dd>
          </div>
        ) : null}
        <div className="kv__row">
          <dt>Read from</dt>
          <dd className="small">
            {receipt.holdSource === 'chain' ? 'The hold account on-chain' : 'The recorded copy'},{' '}
            {when(receipt.loadedAt)}
          </dd>
        </div>
      </dl>

      <section className="receipt__evidence" aria-labelledby="evidence">
        <hr className="rule" />
        <div className="sec-head">
          <h2 id="evidence" className="h2">
            Why this window
          </h2>
        </div>
        <Spoken spoken={receipt.spoken} />
        {receipt.voiceNoteUrl ? (
          <div className="voice">
            <p className="label">Voice note</p>
            {/* Plays only when pressed; sound is never started for the reader. */}
            <audio controls preload="none" src={receipt.voiceNoteUrl} />
          </div>
        ) : null}
        {document ? (
          <Evidence document={document} />
        ) : (
          <p className="notice" data-ink="ochre">
            The evidence document for this hold is not available right now. The hash above is still
            the commitment to it.
          </p>
        )}
        <VerifyHash pda={receipt.pda} evidenceHash={hold.evidenceHash} document={document} />
      </section>
    </main>
  );
}
