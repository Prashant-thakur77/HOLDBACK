'use client';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Ticket } from '@/components/art/Ticket';
import { T, useLang } from '@/components/LangProvider';
import { useCountdown } from '@/hooks/useCountdown';
import { useHoldActions } from '@/hooks/useHoldActions';
import { useSendProtected } from '@/hooks/useSendProtected';
import { explorerUrl } from '@/lib/cluster';
import { shortAddress } from '@/lib/format';
import { TIER_INK, windowLabel } from '@/lib/i18n';
import { requestDevnetSol } from '@/lib/try/faucet';
import { THROWAWAY_WALLET, forgetThrowawayKeypair } from '@/lib/try/throwaway';

/** The "support desk" address from the message: on the sanctions list the agent reads. */
const SCAM_ADDRESS = 'FuCC7GoYwt5TsNTjWL23Xx9UKCvC18chjMEFPL3vJDCC';
/** 0.005 SOL: the hold, its rent and the fees fit in one faucet grant. */
const AMOUNT = 5_000_000n;
/** Enough for one hold with its rent and fees. */
const ENOUGH_LAMPORTS = 9_000_000;

const MESSAGE = [
  'Wallet Security Desk: we detected a login to your wallet from a new device.',
  'To stop your funds being frozen, send a 0.005 SOL verification deposit to the address below within 15 minutes.',
  'It is refunded automatically once the check is complete. Do not share this message.',
].join(' ');

interface Step {
  label: string;
  signature: string;
}

function sol(lamports: number): string {
  return `${(lamports / LAMPORTS_PER_SOL).toLocaleString('en', { maximumFractionDigits: 4 })} SOL`;
}

function message(failure: unknown): string {
  return failure instanceof Error ? failure.message : 'Something went wrong';
}

/**
 * The whole product on one page, with real devnet transactions: a wallet made
 * in this browser, a little SOL from the agent's faucet, a scam message, the
 * risk agent's verdict, an attested hold, and the undo.
 */
export function TryFlow() {
  const { connection } = useConnection();
  const { publicKey, wallet, select, connect, disconnect } = useWallet();
  const { lang, t } = useLang();
  const payment = useSendProtected();
  const [balance, setBalance] = useState<number | null>(null);
  const [funding, setFunding] = useState<'idle' | 'asking' | 'error'>('idle');
  const [fundError, setFundError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [heldAt, setHeldAt] = useState<number | null>(null);
  const [undone, setUndone] = useState(false);

  const hold = payment.stage === 'done' ? (payment.prepared?.hold ?? null) : null;
  const actions = useHoldActions(hold ? { pda: hold } : null);
  const windowSecs = payment.prepared?.plan.windowSecs ?? 0;
  const countdown = useCountdown(heldAt && !undone ? heldAt / 1000 + windowSecs : null);

  // The throwaway wallet is the only one on this page: pick it, then connect.
  useEffect(() => {
    if (!wallet) select(THROWAWAY_WALLET);
    else if (!publicKey) void connect().catch(() => undefined);
  }, [wallet, publicKey, select, connect]);

  const refresh = useCallback(async () => {
    if (!publicKey) return;
    try {
      setBalance(await connection.getBalance(publicKey, 'confirmed'));
    } catch {
      // A rate-limited RPC: keep the last value.
    }
  }, [connection, publicKey]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const record = useCallback((label: string, signature: string) => {
    setSteps((current) =>
      current.some((step) => step.signature === signature)
        ? current
        : [...current, { label, signature }],
    );
  }, []);

  useEffect(() => {
    if (payment.stage === 'done' && payment.signature) {
      record('Hold opened, window signed by the risk oracle', payment.signature);
      setHeldAt((current) => current ?? Date.now());
      void refresh();
    }
  }, [payment.stage, payment.signature, record, refresh]);

  const fund = async () => {
    if (!publicKey) return;
    setFunding('asking');
    setFundError(null);
    try {
      const grant = await requestDevnetSol(publicKey.toBase58());
      record(`Faucet sent ${sol(grant.lamports)}`, grant.signature);
      setFunding('idle');
      await refresh();
    } catch (failure) {
      setFunding('error');
      setFundError(message(failure));
    }
  };

  const check = () =>
    void payment.prepare({
      recipient: SCAM_ADDRESS,
      mint: null,
      amount: AMOUNT,
      context: MESSAGE,
      lang,
    });

  const undo = async () => {
    const signature = await actions.reclaim();
    if (signature) {
      record('Taken back: the money returned to this wallet', signature);
      setUndone(true);
      void refresh();
    }
  };

  const startOver = async () => {
    payment.reset();
    setSteps([]);
    setHeldAt(null);
    setUndone(false);
    setBalance(null);
    forgetThrowawayKeypair();
    await disconnect().catch(() => undefined);
  };

  const funded = balance !== null && balance >= ENOUGH_LAMPORTS;
  const prepared = payment.prepared;
  const assessment = prepared?.assessment ?? null;
  const busy = ['assessing', 'building', 'previewing', 'signing', 'confirming'].includes(
    payment.stage,
  );

  return (
    <div className="try">
      <ol className="try__steps">
        {/* 1. The wallet */}
        <li className="panel try__step" data-ink="blue" data-done={funded || steps.length > 0}>
          <p className="label">Step 1 · A wallet for this tab</p>
          <h2 className="h3">Here is a throwaway devnet wallet</h2>
          <p className="small">
            Made in your browser just now and kept in this browser only. It never holds anything but
            devnet SOL, which has no value.
          </p>
          <p className="try__address mono">
            {publicKey ? (
              <a
                href={explorerUrl('address', publicKey.toBase58())}
                className="link"
                rel="noreferrer"
              >
                {shortAddress(publicKey.toBase58(), 6)}
              </a>
            ) : (
              'Making a key…'
            )}
          </p>
          <p className="try__balance">
            <span className="label">Balance</span>{' '}
            <strong>{balance === null ? '…' : sol(balance)}</strong>
          </p>
          {!funded ? (
            <button
              type="button"
              className="btn"
              disabled={!publicKey || funding === 'asking'}
              onClick={() => void fund()}
            >
              {funding === 'asking' ? 'Asking the faucet…' : 'Get 0.02 devnet SOL'}
            </button>
          ) : null}
          {fundError ? (
            <p className="notice" data-ink="red" role="alert">
              {fundError}. The public faucet at{' '}
              <a href="https://faucet.solana.com" className="link" rel="noreferrer">
                faucet.solana.com
              </a>{' '}
              works too: paste the address above.
            </p>
          ) : null}
        </li>

        {/* 2. The message */}
        <li className="panel try__step" data-ink="red" aria-disabled={!funded && !prepared}>
          <p className="label">Step 2 · A message arrives</p>
          <blockquote className="try__message">
            <p className="try__from small">
              <strong>Wallet Security Desk</strong> · just now
            </p>
            <p>{MESSAGE}</p>
            <p className="mono small">Deposit address: {SCAM_ADDRESS}</p>
          </blockquote>
          <p className="small">
            Urgency, a threat, a promise of a refund, a request for secrecy. Before paying, ask
            HOLDBACK about the address. The message itself goes along as context.
          </p>
          {!prepared ? (
            <button type="button" className="btn" disabled={!funded || busy} onClick={check}>
              {payment.stage === 'assessing'
                ? 'The risk agent is reading the evidence…'
                : busy
                  ? 'Building the hold…'
                  : 'Check before paying'}
            </button>
          ) : null}
        </li>

        {/* 3. The verdict */}
        <li
          className="panel try__step"
          data-ink={assessment ? TIER_INK[assessment.tier] : 'ink'}
          aria-disabled={!assessment}
        >
          <p className="label">Step 3 · The verdict, before you sign</p>
          {assessment && prepared ? (
            <>
              <p className="verdict__line">
                <span className="pill">{t(`tier.${assessment.tier}`)}</span>
                <span className="verdict__window">
                  Undo window: <strong>{windowLabel(prepared.plan.windowSecs, lang)}</strong>
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
              <p className="small quiet">
                Evidence hash <span className="mono">{assessment.evidenceHash.slice(0, 16)}…</span>{' '}
                goes into the hold.{' '}
                {assessment.attestation
                  ? 'The risk oracle signed this window for this exact payment, and the program checks that signature.'
                  : 'The oracle did not sign this one, so the program applies its default window.'}
              </p>
              <div className="try__ticket">
                <Ticket
                  compact
                  ink={TIER_INK[assessment.tier]}
                  windowSecs={prepared.plan.windowSecs}
                  serial={prepared.hold ? shortAddress(prepared.hold) : 'Instant'}
                  amount="0.005"
                  unit="SOL"
                  tierLabel={t(`tier.${assessment.tier}`)}
                  windowText={windowLabel(prepared.plan.windowSecs, lang)}
                  lang={lang}
                  title={`Payment of 0.005 SOL, undo window ${windowLabel(prepared.plan.windowSecs, 'en')}`}
                />
              </div>
              {payment.stage !== 'done' ? (
                <>
                  {assessment.requiresConfirmation ? (
                    <p className="notice" data-ink="red">
                      <T k="warn.SANCTIONED" />
                    </p>
                  ) : null}
                  <p className="small">
                    Say you believed the message anyway. Pay, and see what the hold does.
                  </p>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void payment.send({ acknowledgeSanctioned: true })}
                  >
                    {payment.stage === 'signing' || payment.stage === 'confirming'
                      ? 'Sending to devnet…'
                      : 'Pay anyway, into a hold'}
                  </button>
                </>
              ) : null}
            </>
          ) : (
            <p className="quiet">The verdict appears here once you check the address.</p>
          )}
          {payment.error ? (
            <p className="notice" data-ink="red" role="alert">
              <strong>{payment.error.message}</strong>
              {payment.error.program ? ` (${payment.error.program.name})` : ''}
            </p>
          ) : null}
        </li>

        {/* 4. The undo */}
        <li className="panel try__step" data-ink="green" aria-disabled={!hold}>
          <p className="label">Step 4 · Change your mind</p>
          {hold && !undone ? (
            <>
              <h2 className="h3">The money is held, not gone</h2>
              <p className="small">
                It sits in a program account on devnet. The recipient gets it only after{' '}
                {countdown.label || windowLabel(windowSecs, lang)}. Until then, one press brings it
                back.
              </p>
              <button
                type="button"
                className="btn"
                disabled={actions.pending !== null}
                onClick={() => void undo()}
              >
                {actions.pending ? 'Taking it back…' : 'Take it back'}
              </button>
              <p className="small">
                <Link href={`/h/${hold}`} className="link">
                  Open the hold&apos;s receipt
                </Link>{' '}
                to recompute its evidence hash.
              </p>
            </>
          ) : undone ? (
            <>
              <h2 className="h3">Taken back</h2>
              <p className="small">
                The 0.005 SOL is back in this wallet. The &ldquo;support desk&rdquo; got nothing,
                and nobody but you could have done this.
              </p>
            </>
          ) : (
            <p className="quiet">Once you pay, the undo button is here.</p>
          )}
          {actions.error ? (
            <p className="notice" data-ink="red" role="alert">
              <strong>{actions.error.message}</strong>
              {actions.error.program ? ` (${actions.error.program.name})` : ''}
            </p>
          ) : null}
        </li>
      </ol>

      {steps.length > 0 ? (
        <section className="panel try__record" aria-labelledby="try-record">
          <h2 id="try-record" className="label">
            What just happened, on devnet
          </h2>
          <ol className="try__txs">
            {steps.map((step) => (
              <li key={step.signature}>
                <span>{step.label}</span>{' '}
                <a href={explorerUrl('tx', step.signature)} className="mono link" rel="noreferrer">
                  {shortAddress(step.signature, 8)}
                </a>
              </li>
            ))}
          </ol>
          {undone ? (
            <div className="btn-row">
              <button type="button" className="btn btn--ghost" onClick={() => void startOver()}>
                Start over with a new wallet
              </button>
              <Link href="/proof" className="btn btn--ghost">
                Now try to rob it
              </Link>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
