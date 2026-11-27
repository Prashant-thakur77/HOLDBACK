'use client';

import { FlagReason, type HoldRecord } from '@holdback/sdk';
import { useWallet } from '@solana/wallet-adapter-react';
import Link from 'next/link';
import { useState } from 'react';

import { T, useLang } from '@/components/LangProvider';
import { useCountdown } from '@/hooks/useCountdown';
import { useHoldActions } from '@/hooks/useHoldActions';
import { useHolds } from '@/hooks/useHolds';
import { explorerUrl } from '@/lib/cluster';
import { explainRecord, formatTokenAmount, shortAddress } from '@/lib/format';
import { TIER_INK } from '@/lib/i18n';
import { mintMeta } from '@/lib/mints';

const FLAG_REASONS: { value: FlagReason; label: string }[] = [
  { value: FlagReason.PHISHING, label: 'Phishing' },
  { value: FlagReason.IMPERSONATION, label: 'Pretended to be someone else' },
  { value: FlagReason.INVESTMENT_FRAUD, label: 'Investment fraud' },
  { value: FlagReason.ROMANCE, label: 'Romance scam' },
  { value: FlagReason.FAKE_SUPPORT, label: 'Fake support' },
  { value: FlagReason.DRAINER, label: 'Wallet drainer' },
  { value: FlagReason.EXTORTION, label: 'Threats or extortion' },
  { value: FlagReason.OTHER, label: 'Something else' },
];

const STATUS_WORDS: Record<HoldRecord['status'], string> = {
  PENDING: 'Held',
  RECLAIMED: 'Taken back',
  RELEASED: 'Released',
};

/** One hold as a ledger row: what it is, its clock, and the actions this wallet may take. */
function HoldRow({ hold, role }: { hold: HoldRecord; role: 'sender' | 'recipient' }) {
  const { t } = useLang();
  const countdown = useCountdown(hold.status === 'PENDING' ? hold.releaseAt : null);
  const actions = useHoldActions(hold);
  const [reason, setReason] = useState<FlagReason>(FlagReason.PHISHING);
  const can = actions.permissions();
  const busy = actions.pending !== null;
  const total = Math.max(1, (Date.parse(hold.releaseAt) - Date.parse(hold.createdAt)) / 1000);
  const left = countdown.remainingSecs;
  const open = hold.status === 'PENDING' && left !== null && left > 0;
  const other = role === 'sender' ? hold.recipient : hold.sender;

  return (
    <li className="hold" data-ink={TIER_INK[hold.tier]}>
      <div className="hold__main">
        <p className="hold__amount">{formatTokenAmount(hold.amount, mintMeta(hold.mint))}</p>
        <p className="small">
          {role === 'sender' ? 'to' : 'from'}{' '}
          <span className="mono" title={other}>
            {shortAddress(other)}
          </span>
        </p>
        <p className="hold__pills">
          <span className="pill">{t(`tier.${hold.tier}`)}</span>
          <span className="pill" data-ink="ink">
            {STATUS_WORDS[hold.status]}
          </span>
        </p>
      </div>

      <div className="hold__clock">
        {open ? (
          <>
            <p className="label">
              <T k="demo.left" />
            </p>
            <p className="hold__left">{countdown.label}</p>
            <div className="drain" aria-hidden="true">
              <i className="drain__left" style={{ ['--left' as string]: (left ?? 0) / total }} />
            </div>
          </>
        ) : (
          <p className="small">{explainRecord(hold)}</p>
        )}
        <Link href={`/h/${hold.pda}`} className="link small">
          Receipt and evidence
        </Link>
      </div>

      <div className="hold__actions">
        {can.reclaim ? (
          <button
            type="button"
            className="btn btn--sm"
            disabled={busy}
            onClick={() => void actions.reclaim()}
          >
            {actions.pending === 'reclaim' ? 'Waiting for your wallet…' : <T k="action.undo" />}
          </button>
        ) : null}
        {can.releaseEarly ? (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={busy}
            onClick={() => void actions.releaseEarly()}
          >
            <T k="action.releaseEarly" />
          </button>
        ) : null}
        {can.release ? (
          <button
            type="button"
            className="btn btn--sm"
            disabled={busy}
            onClick={() => void actions.release()}
          >
            <T k="action.release" />
          </button>
        ) : null}
        {can.close ? (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={busy}
            onClick={() => void actions.close()}
          >
            Close and return rent
          </button>
        ) : null}
        {can.manageRecipient ? (
          <details className="hold__more">
            <summary>About this recipient</summary>
            <div className="hold__more-body">
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                disabled={busy}
                onClick={() => void actions.setTrust()}
              >
                Trust: no wait next time
              </button>
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                disabled={busy}
                onClick={() => void actions.removeTrust()}
              >
                Remove trust
              </button>
              <div className="field">
                <label className="field__label small" htmlFor={`flag-${hold.pda}`}>
                  Report as a scam
                </label>
                <div className="hold__flag">
                  <select
                    id={`flag-${hold.pda}`}
                    className="select"
                    value={reason}
                    onChange={(event) => setReason(Number(event.target.value) as FlagReason)}
                  >
                    {FLAG_REASONS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    disabled={busy}
                    onClick={() => void actions.flag(reason)}
                  >
                    Flag
                  </button>
                </div>
                <p className="field__hint">
                  A flag is written on-chain from your wallet and counts in future verdicts.
                </p>
              </div>
            </div>
          </details>
        ) : null}
      </div>

      {actions.signature ? (
        <p className="hold__note small" role="status">
          Done.{' '}
          <a href={explorerUrl('tx', actions.signature)} className="mono link" rel="noreferrer">
            {shortAddress(actions.signature, 8)}
          </a>
        </p>
      ) : null}
      {actions.error ? (
        <p className="hold__note notice" data-ink="red" role="alert">
          {actions.error.message}
        </p>
      ) : null}
    </li>
  );
}

/** Holds this wallet sent, or holds on their way to it. */
export function HoldsPanel({ role }: { role: 'sender' | 'recipient' }) {
  const { publicKey } = useWallet();
  const list = useHolds(publicKey?.toBase58() ?? null, role);
  const id = `holds-${role}`;

  return (
    <section className="holds" aria-labelledby={id}>
      <hr className="rule" />
      <div className="holds__head">
        <h2 id={id} className="h3">
          {role === 'sender' ? 'Payments you sent' : 'Payments on their way to you'}
        </h2>
        {publicKey ? (
          <p className="small quiet" role="status">
            {list.status === 'loading'
              ? 'Loading…'
              : list.mode === 'realtime'
                ? 'Live'
                : 'Refreshes on a timer'}{' '}
            <button
              type="button"
              className="holds__refresh link"
              onClick={() => void list.refresh()}
            >
              Refresh
            </button>
          </p>
        ) : null}
      </div>
      {list.error ? (
        <p className="notice" data-ink="red" role="alert">
          {list.error}
        </p>
      ) : null}
      {!publicKey ? (
        <p className="holds__empty quiet">Connect a wallet to see its holds.</p>
      ) : list.status === 'unavailable' ? (
        <p className="holds__empty notice" data-ink="ochre">
          The list is unavailable: neither the risk agent nor the database is configured for this
          site.
        </p>
      ) : list.holds.length === 0 && list.status !== 'loading' ? (
        <p className="holds__empty quiet">
          {role === 'sender'
            ? 'Nothing here yet. A payment you send appears here with its clock, and stays undoable until the window ends.'
            : 'Nothing is on its way to this wallet. A payment sent to you appears here while its window runs.'}
        </p>
      ) : (
        <ul className="holds__list">
          {list.holds.map((hold) => (
            <HoldRow key={hold.pda} hold={hold} role={role} />
          ))}
        </ul>
      )}
    </section>
  );
}
