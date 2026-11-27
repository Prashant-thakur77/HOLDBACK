'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Ticket } from '@/components/art/Ticket';
import { T, useLang } from '@/components/LangProvider';
import { useAssessment } from '@/hooks/useAssessment';
import { useSendProtected, type SendStage } from '@/hooks/useSendProtected';
import { explorerUrl } from '@/lib/cluster';
import { formatTokenAmount, parseAmount, shortAddress } from '@/lib/format';
import { TIER_INK, windowLabel } from '@/lib/i18n';
import { knownMints, mintMeta } from '@/lib/mints';

/** Typed by the sender before a payment to a sanctioned address can be signed. */
const CONFIRM_PHRASE = 'SEND ANYWAY';

const STAGE_TEXT: Record<SendStage, string> = {
  idle: '',
  assessing: 'Checking the recipient…',
  building: 'Building the payment…',
  previewing: 'Simulating it, so you see what will change…',
  ready: 'Ready to sign.',
  signing: 'Waiting for your wallet…',
  confirming: 'Sent. Waiting for the network to confirm…',
  done: 'Done.',
  error: '',
};

function toBaseUnits(text: string, decimals: number): bigint | null {
  try {
    return parseAmount(text, decimals);
  } catch {
    return null;
  }
}

/**
 * The send form: recipient, amount, an optional reason, and a verdict that
 * updates as you type. "Review payment" assesses, builds and simulates; the
 * pre-sign slip then shows exactly what the wallet is about to be asked for.
 */
export function SendPanel() {
  const { publicKey } = useWallet();
  const { lang, t } = useLang();
  const mints = knownMints();
  // A "pay me" link (/pay?to=…&amount=…&mint=…) hands its values over as query parameters.
  const link = useSearchParams();
  const [recipient, setRecipient] = useState(link.get('to') ?? '');
  const [amountText, setAmountText] = useState(link.get('amount') ?? '');
  const [mint, setMint] = useState<string | null>(
    mints.find((item) => item.address === link.get('mint'))?.address ?? null,
  );
  const [context, setContext] = useState('');
  const [phrase, setPhrase] = useState('');

  const meta = mintMeta(mint);
  const amount = meta ? toBaseUnits(amountText, meta.decimals) : null;
  const verdict = useAssessment(recipient, amount, mint, context, lang);
  const payment = useSendProtected();
  const busy = ['assessing', 'building', 'previewing', 'signing', 'confirming'].includes(
    payment.stage,
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (amount !== null) void payment.prepare({ recipient, mint, amount, context, lang });
  };

  const startOver = () => {
    payment.reset();
    setPhrase('');
  };

  const assessment = verdict.assessment;
  const prepared = payment.prepared;
  const needsPhrase = prepared?.assessment.requiresConfirmation ?? false;
  const phraseOk = !needsPhrase || phrase.trim().toUpperCase() === CONFIRM_PHRASE;

  return (
    <section className="panel send" aria-labelledby="send-title">
      <h2 id="send-title" className="h3">
        <T k="cta.send" />
      </h2>

      <form onSubmit={onSubmit} className="send__form" noValidate>
        <div className="field">
          <label className="field__label" htmlFor="send-to">
            Recipient address
          </label>
          <input
            id="send-to"
            className="input input--mono"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="Solana address"
          />
        </div>
        <div className="send__amount">
          <div className="field">
            <label className="field__label" htmlFor="send-amount">
              Amount
            </label>
            <input
              id="send-amount"
              className="input"
              inputMode="decimal"
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              placeholder="0.00"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="send-asset">
              Asset
            </label>
            <select
              id="send-asset"
              className="select"
              value={mint ?? ''}
              onChange={(event) => setMint(event.target.value || null)}
            >
              {mints.map((item) => (
                <option key={item.symbol} value={item.address ?? ''}>
                  {item.symbol}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="send-why">
            Why are you sending this? <span className="quiet">(optional)</span>
          </label>
          <textarea
            id="send-why"
            className="textarea"
            value={context}
            maxLength={1000}
            onChange={(event) => setContext(event.target.value)}
            aria-describedby="send-why-hint"
          />
          <p id="send-why-hint" className="field__hint">
            In your own words, in any of the four languages. It is read once by the risk check, for
            signs of pressure, and is never stored.
          </p>
        </div>

        <div className="verdict" aria-live="polite">
          <p className="label">Verdict</p>
          {!publicKey ? (
            <p className="quiet">Connect a wallet to check a recipient.</p>
          ) : verdict.status === 'idle' ? (
            <p className="quiet">Enter a recipient and an amount to see the verdict.</p>
          ) : verdict.status === 'loading' && !assessment ? (
            <p>Checking the recipient…</p>
          ) : verdict.status === 'unavailable' ? (
            <p className="notice" data-ink="ochre">
              The risk agent is not configured for this site, so no verdict can be shown and no
              payment can be built.
            </p>
          ) : verdict.status === 'error' ? (
            <p className="notice" data-ink="red" role="alert">
              The risk check did not answer{verdict.error ? `: ${verdict.error.message}` : ''}.
              Without a verdict no payment is built.
            </p>
          ) : assessment ? (
            <div className="verdict__body" data-ink={TIER_INK[assessment.tier]}>
              <p className="verdict__line">
                <span className="pill">{t(`tier.${assessment.tier}`)}</span>
                <span className="verdict__window">
                  Undo window: <strong>{windowLabel(assessment.windowSecs, lang)}</strong>
                </span>
              </p>
              <p className="verdict__spoken" lang={assessment.spoken.lang}>
                {assessment.spoken.text}
              </p>
              {assessment.findings.length > 0 ? (
                <ul className="verdict__findings">
                  {assessment.findings.map((finding) => (
                    <li key={finding.id}>{finding.title}</li>
                  ))}
                </ul>
              ) : null}
              {assessment.tier === 'SUSPICIOUS' || assessment.tier === 'FLAGGED' ? (
                <p className="notice">
                  <T k="warn.pressure" />
                </p>
              ) : null}
              {assessment.unavailable.length > 0 ? (
                <p className="small quiet">
                  Did not answer in time:{' '}
                  <span className="mono">{assessment.unavailable.join(', ')}</span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {!prepared ? (
          <button type="submit" className="btn" disabled={amount === null || !publicKey || busy}>
            {busy ? STAGE_TEXT[payment.stage] : <T k="action.review" />}
          </button>
        ) : null}
      </form>

      {prepared ? (
        <div className="presign" data-ink={TIER_INK[prepared.assessment.tier]}>
          <hr className="perf" />
          <h3 className="label">Before you sign</h3>
          <div className="presign__grid">
            <div className="presign__ticket">
              <Ticket
                ink={TIER_INK[prepared.assessment.tier]}
                windowSecs={prepared.plan.windowSecs}
                serial={prepared.hold ? shortAddress(prepared.hold) : 'Instant'}
                amount={formatTokenAmount(prepared.input.amount, meta).split(' ')[0] ?? ''}
                unit={meta?.symbol ?? ''}
                blockNote={prepared.plan.instant ? 'Paid at once' : 'Held on-chain'}
                gridLabel={t('ticket.grid')}
                tierLabel={t(`tier.${prepared.assessment.tier}`)}
                windowText={windowLabel(prepared.plan.windowSecs, lang)}
                footLine={t('ticket.foot')}
                lang={lang}
                title={`Payment of ${formatTokenAmount(prepared.input.amount, meta)}, undo window ${windowLabel(prepared.plan.windowSecs, 'en')}`}
              />
            </div>
            <div>
              <p className="presign__plan">
                {prepared.plan.instant
                  ? 'This recipient is on your trusted list, so the payment goes through at once. It cannot be undone.'
                  : `The money is held on-chain. You can take it back for ${windowLabel(prepared.plan.windowSecs, lang)}; after that it goes to the recipient.`}
              </p>
              <p className="label presign__changes-title">What changes in your wallet</p>
              <ul className="presign__changes">
                {prepared.preview.changes.map((change) => (
                  <li key={change.mint?.toBase58() ?? 'sol'} className="mono">
                    {formatTokenAmount(change.delta, mintMeta(change.mint?.toBase58() ?? null))}
                  </li>
                ))}
              </ul>
              {prepared.hold ? (
                <p className="small quiet">
                  Hold address: <span className="mono">{shortAddress(prepared.hold, 6)}</span>
                </p>
              ) : null}
            </div>
          </div>

          {needsPhrase ? (
            <div className="field presign__confirm">
              <p className="notice" data-ink="red">
                <T k="warn.SANCTIONED" />
              </p>
              <label className="field__label" htmlFor="send-phrase">
                Type {CONFIRM_PHRASE} to continue
              </label>
              <input
                id="send-phrase"
                className="input"
                value={phrase}
                onChange={(event) => setPhrase(event.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
              />
            </div>
          ) : null}

          {payment.stage === 'done' ? (
            <div className="presign__done" role="status">
              <p className="h3">
                {prepared.plan.instant ? 'Paid.' : 'Held. The clock is running.'}
              </p>
              <div className="btn-row">
                {prepared.hold ? (
                  <Link href={`/h/${prepared.hold}`} className="btn">
                    Open the receipt
                  </Link>
                ) : null}
                <button type="button" className="btn btn--ghost" onClick={startOver}>
                  Send another
                </button>
              </div>
            </div>
          ) : (
            <div className="btn-row presign__actions">
              <button
                type="button"
                className="btn"
                disabled={(payment.stage !== 'ready' && payment.stage !== 'error') || !phraseOk}
                onClick={() =>
                  void payment.send({ acknowledgeSanctioned: needsPhrase && phraseOk })
                }
              >
                {payment.stage === 'signing' || payment.stage === 'confirming' ? (
                  STAGE_TEXT[payment.stage]
                ) : (
                  <T k="action.sign" />
                )}
              </button>
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={startOver}>
                Change something
              </button>
            </div>
          )}
        </div>
      ) : null}

      <p className="send__stage small" role="status">
        {!prepared && busy ? STAGE_TEXT[payment.stage] : ''}
      </p>
      {payment.signature ? (
        <p className="small">
          Transaction:{' '}
          <a href={explorerUrl('tx', payment.signature)} className="mono link" rel="noreferrer">
            {shortAddress(payment.signature, 8)}
          </a>
        </p>
      ) : null}
      {payment.error ? (
        <p className="notice" data-ink="red" role="alert">
          <strong>{payment.error.message}</strong>
          {payment.error.program ? ` (${payment.error.program.name})` : ''} Nothing was sent unless
          a transaction link is shown above.
        </p>
      ) : null}
    </section>
  );
}
