'use client';

// Structure only, visual design pending.
//
// A working wiring example for the dashboard: every piece of data and every
// action comes from a hook, so the design pass replaces this markup and keeps
// the hooks.

import { FlagReason, LANGS, type HoldRecord, type Lang } from '@holdback/sdk';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';

import { useAssessment } from '@/hooks/useAssessment';
import { useCountdown } from '@/hooks/useCountdown';
import { useHoldActions } from '@/hooks/useHoldActions';
import { useHolds } from '@/hooks/useHolds';
import { useSendProtected } from '@/hooks/useSendProtected';
import { useWalletSession } from '@/hooks/useWalletSession';
import {
  explainRecord,
  formatDuration,
  formatTokenAmount,
  parseAmount,
  shortAddress,
} from '@/lib/format';
import { knownMints, mintMeta } from '@/lib/mints';

function toBaseUnits(text: string, decimals: number): bigint | null {
  try {
    return parseAmount(text, decimals);
  } catch {
    return null;
  }
}

function WalletSection() {
  const { wallets, select, connect, disconnect, publicKey, wallet, connecting } = useWallet();
  const session = useWalletSession();

  if (publicKey) {
    return (
      <section aria-label="Wallet">
        <p>Connected: {shortAddress(publicKey.toBase58())}</p>
        <button type="button" onClick={() => void disconnect()}>
          Disconnect
        </button>
        {session.status === 'ready' ? (
          <p>Live updates are on.</p>
        ) : session.status !== 'unsupported' ? (
          <button
            type="button"
            disabled={session.status === 'signing'}
            onClick={() => void session.signIn()}
          >
            Turn on live updates (sign a message)
          </button>
        ) : null}
        {session.error ? <p role="alert">{session.error}</p> : null}
      </section>
    );
  }
  return (
    <section aria-label="Wallet">
      {wallets.length === 0 ? <p>No Solana wallet was detected in this browser.</p> : null}
      <ul>
        {wallets.map(({ adapter }) => (
          <li key={adapter.name}>
            <button type="button" disabled={connecting} onClick={() => select(adapter.name)}>
              {adapter.name}
            </button>
          </li>
        ))}
      </ul>
      {wallet && !connecting ? (
        <button type="button" onClick={() => void connect()}>
          Connect {wallet.adapter.name}
        </button>
      ) : null}
    </section>
  );
}

function SendSection() {
  const mints = knownMints();
  // A "pay me" link (/pay?to=…&amount=…&mint=…) hands its values over as query parameters.
  const link = useSearchParams();
  const [recipient, setRecipient] = useState(link.get('to') ?? '');
  const [amountText, setAmountText] = useState(link.get('amount') ?? '');
  const [mint, setMint] = useState<string | null>(
    mints.find((item) => item.address === link.get('mint'))?.address ?? null,
  );
  const [context, setContext] = useState('');
  const [lang, setLang] = useState<Lang>('en');
  const [acknowledged, setAcknowledged] = useState(false);

  const meta = mintMeta(mint);
  const amount = meta ? toBaseUnits(amountText, meta.decimals) : null;
  const verdict = useAssessment(recipient, amount, mint, context, lang);
  const payment = useSendProtected();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (amount !== null) void payment.prepare({ recipient, mint, amount, context, lang });
  };

  return (
    <section aria-label="Send">
      <form onSubmit={onSubmit}>
        <label>
          Recipient address
          <input value={recipient} onChange={(event) => setRecipient(event.target.value)} />
        </label>
        <label>
          Amount
          <input
            inputMode="decimal"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
          />
        </label>
        <label>
          Asset
          <select value={mint ?? ''} onChange={(event) => setMint(event.target.value || null)}>
            {mints.map((item) => (
              <option key={item.symbol} value={item.address ?? ''}>
                {item.symbol}
              </option>
            ))}
          </select>
        </label>
        <label>
          Why are you sending this? (optional)
          <textarea value={context} onChange={(event) => setContext(event.target.value)} />
        </label>
        <label>
          Language
          <select value={lang} onChange={(event) => setLang(event.target.value as Lang)}>
            {LANGS.map((code) => (
              <option key={code}>{code}</option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={amount === null}>
          Review payment
        </button>
      </form>

      <p aria-live="polite">Risk check: {verdict.status}</p>
      {verdict.assessment ? (
        <div>
          <p>
            {verdict.assessment.tier}, undo window {formatDuration(verdict.assessment.windowSecs)}
          </p>
          <p>{verdict.assessment.spoken.text}</p>
          <ul>
            {verdict.assessment.findings.map((finding) => (
              <li key={finding.id}>{finding.title}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p aria-live="polite">Payment: {payment.stage}</p>
      {payment.prepared ? (
        <div>
          <p>
            {payment.prepared.plan.instant
              ? 'Instant transfer (trusted recipient)'
              : `Hold ${payment.prepared.hold ?? ''} with an undo window of ${formatDuration(payment.prepared.plan.windowSecs)}`}
          </p>
          <ul>
            {payment.prepared.preview.changes.map((change) => (
              <li key={change.mint?.toBase58() ?? 'sol'}>
                {formatTokenAmount(change.delta, mintMeta(change.mint?.toBase58() ?? null))}
              </li>
            ))}
          </ul>
          {payment.prepared.assessment.requiresConfirmation ? (
            <label>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              I understand this recipient is on a sanctions list
            </label>
          ) : null}
          <button
            type="button"
            disabled={payment.stage !== 'ready' && payment.stage !== 'error'}
            onClick={() => void payment.send({ acknowledgeSanctioned: acknowledged })}
          >
            Sign and send
          </button>
        </div>
      ) : null}
      {payment.signature ? <p>Signature: {payment.signature}</p> : null}
      {payment.error ? (
        <p role="alert">
          {payment.error.kind}: {payment.error.message}
        </p>
      ) : null}
    </section>
  );
}

function HoldItem({ hold }: { hold: HoldRecord }) {
  const countdown = useCountdown(hold.status === 'PENDING' ? hold.releaseAt : null);
  const actions = useHoldActions(hold);
  const can = actions.permissions();
  const busy = actions.pending !== null;

  return (
    <li>
      <a href={`/h/${hold.pda}`}>{explainRecord(hold)}</a>
      {countdown.remainingSecs ? <p>Undo for another {countdown.label}</p> : null}
      {can.reclaim ? (
        <button type="button" disabled={busy} onClick={() => void actions.reclaim()}>
          Undo
        </button>
      ) : null}
      {can.releaseEarly ? (
        <button type="button" disabled={busy} onClick={() => void actions.releaseEarly()}>
          Release now
        </button>
      ) : null}
      {can.release ? (
        <button type="button" disabled={busy} onClick={() => void actions.release()}>
          Release
        </button>
      ) : null}
      {can.close ? (
        <button type="button" disabled={busy} onClick={() => void actions.close()}>
          Close
        </button>
      ) : null}
      {can.manageRecipient ? (
        <>
          <button type="button" disabled={busy} onClick={() => void actions.setTrust()}>
            Trust recipient
          </button>
          <button type="button" disabled={busy} onClick={() => void actions.removeTrust()}>
            Remove trust
          </button>
          <button type="button" disabled={busy} onClick={() => void actions.flag(FlagReason.OTHER)}>
            Flag recipient
          </button>
        </>
      ) : null}
      {actions.error ? (
        <p role="alert">
          {actions.error.kind}: {actions.error.message}
        </p>
      ) : null}
    </li>
  );
}

function HoldsSection({ role }: { role: 'sender' | 'recipient' }) {
  const { publicKey } = useWallet();
  const list = useHolds(publicKey?.toBase58() ?? null, role);

  return (
    <section aria-label={role === 'sender' ? 'Sent' : 'Incoming'}>
      <h2>{role === 'sender' ? 'Sent' : 'Incoming'}</h2>
      <p>
        {list.status} ({list.mode})
      </p>
      {list.error ? <p role="alert">{list.error}</p> : null}
      <ul>
        {list.holds.map((hold) => (
          <HoldItem key={hold.pda} hold={hold} />
        ))}
      </ul>
    </section>
  );
}

export default function DashboardPage() {
  return (
    <main>
      <h1>HOLDBACK</h1>
      <WalletSection />
      {/* Reads the query string, which is only known in the browser. */}
      <Suspense>
        <SendSection />
      </Suspense>
      <HoldsSection role="sender" />
      <HoldsSection role="recipient" />
    </main>
  );
}
