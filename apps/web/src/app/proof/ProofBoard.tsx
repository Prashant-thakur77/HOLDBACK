'use client';

import { useCallback, useState } from 'react';

import { BoxStamp } from '@/components/art/Stamps';
import type { Attacker, ProgramBuild, Proof } from '@/lib/proof/data';
import {
  fetchAccountBytes,
  fetchTransaction,
  judgeProof,
  programHash,
  readProgramData,
  runLimited,
  toBase58,
} from '@/lib/proof/verify';

/** Public endpoints rate-limit hard: two at a time, with a short pause after each. */
const CONCURRENCY = 2;
const PAUSE_MS = 300;

type Check =
  | { status: 'checking' }
  | { status: 'pass' | 'fail'; detail: string }
  | { status: 'error'; detail: string };

interface ProgramCheck {
  status: 'checking' | 'pass' | 'fail' | 'error';
  detail: string;
  hash?: string;
  authority?: string | null;
}

export interface AttackGroup {
  key: Attacker;
  title: string;
  text: string;
  proofs: Proof[];
}

interface Props {
  groups: AttackGroup[];
  executed: Proof[];
  programId: string;
  /** The program's ProgramData account, derived on the server from the program id. */
  programDataAddress: string;
  programExplorer: string;
  build: ProgramBuild | null;
  rpcUrl: string;
}

function short(signature: string): string {
  return `${signature.slice(0, 8)}…${signature.slice(-6)}`;
}

function message(failure: unknown): string {
  return failure instanceof Error ? failure.message : 'The check could not be completed.';
}

function Result({ check }: { check: Check | undefined }) {
  if (!check) return null;
  if (check.status === 'checking') return <span className="quiet">Asking the chain…</span>;
  if (check.status === 'error') {
    return (
      <span className="proof-row__verdict" data-ink="ochre">
        <span className="pill">Not checked</span> {check.detail}
      </span>
    );
  }
  return (
    <span className="proof-row__verdict" data-ink={check.status === 'pass' ? 'green' : 'red'}>
      <span className="pill">{check.status === 'pass' ? 'Pass' : 'Fail'}</span> {check.detail}
    </span>
  );
}

/**
 * The proofs, with a way to stop trusting this page: every row can be checked
 * again from the visitor's own browser against a public devnet RPC endpoint.
 * A happy path passes if its transaction succeeded; an attack passes if its
 * transaction failed with the recorded error. The same rules as `make verify`.
 */
export function ProofBoard({
  groups,
  executed,
  programId,
  programDataAddress,
  programExplorer,
  build,
  rpcUrl,
}: Props) {
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [program, setProgram] = useState<ProgramCheck | null>(null);
  const [running, setRunning] = useState(false);
  const all = [...groups.flatMap((group) => group.proofs), ...executed];
  const host = new URL(rpcUrl).host;

  const checkOne = useCallback(
    async (proof: Proof) => {
      setChecks((current) => ({ ...current, [proof.id]: { status: 'checking' } }));
      let next: Check;
      try {
        const verdict = judgeProof(
          proof,
          await fetchTransaction(rpcUrl, proof.signature),
          programId,
        );
        next = { status: verdict.pass ? 'pass' : 'fail', detail: verdict.detail };
      } catch (failure) {
        next = { status: 'error', detail: message(failure) };
      }
      setChecks((current) => ({ ...current, [proof.id]: next }));
      return next.status;
    },
    [rpcUrl, programId],
  );

  const checkProgram = useCallback(async () => {
    setProgram({ status: 'checking', detail: 'Downloading the program from the chain…' });
    try {
      const data = await fetchAccountBytes(rpcUrl, programDataAddress);
      if (!data) {
        setProgram({ status: 'fail', detail: 'The program data account was not found.' });
        return;
      }
      const hash = await programHash(data);
      const authorityBytes = readProgramData(data).authority;
      const authority = authorityBytes ? toBase58(authorityBytes) : null;
      if (!build) {
        setProgram({
          status: 'error',
          detail: 'There is no build record to compare with.',
          hash,
          authority,
        });
        return;
      }
      const same = hash === build.program_hash;
      setProgram({
        status: same ? 'pass' : 'fail',
        detail: same
          ? 'The bytes on-chain hash to the reproducible build.'
          : 'The bytes on-chain do not hash to the reproducible build.',
        hash,
        authority,
      });
    } catch (failure) {
      setProgram({ status: 'error', detail: message(failure) });
    }
  }, [rpcUrl, programDataAddress, build]);

  const checkAll = async () => {
    setRunning(true);
    await checkProgram();
    const missed: Proof[] = [];
    await runLimited(
      all,
      CONCURRENCY,
      async (proof) => {
        if ((await checkOne(proof)) === 'error') missed.push(proof);
      },
      PAUSE_MS,
    );
    // Rows the endpoint turned away get one more, slower, pass: one at a time.
    await runLimited(missed, 1, async (proof) => void (await checkOne(proof)), PAUSE_MS * 3);
    setRunning(false);
  };

  const done = all.filter((proof) => {
    const status = checks[proof.id]?.status;
    return status === 'pass' || status === 'fail';
  });
  const passed = done.filter((proof) => checks[proof.id]?.status === 'pass').length;
  const unreachable = all.filter((proof) => checks[proof.id]?.status === 'error').length;

  const row = (proof: Proof, refused: boolean) => (
    <li key={proof.id} className="proof-row">
      <span className="proof-row__id mono">{proof.id}</span>
      <div className="proof-row__what">
        <p className="proof-row__desc">{proof.description}</p>
        <p className="small">
          {refused ? (
            <>
              The program answered <code>{proof.error}</code>
            </>
          ) : (
            <span className="quiet">Expected: {proof.expected}</span>
          )}
        </p>
        {/* Not a live region: forty-eight of them would talk over each other. The tally announces. */}
        <p className="small proof-row__result">
          <Result check={checks[proof.id]} />
        </p>
      </div>
      <span className="proof-row__mark">
        {refused ? (
          <BoxStamp text="Refused" ink="red" rotate={-4} size={36} />
        ) : (
          <span className="pill" data-ink="green">
            Executed
          </span>
        )}
      </span>
      <div className="proof-row__actions">
        <a href={proof.explorer} className="link mono" rel="noreferrer">
          {short(proof.signature)}
          <span className="visually-hidden"> (transaction for {proof.id} on the explorer)</span>
        </a>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={checks[proof.id]?.status === 'checking'}
          onClick={() => void checkOne(proof)}
          aria-label={`Re-check ${proof.id} on chain`}
        >
          Re-check
        </button>
      </div>
    </li>
  );

  return (
    <>
      <section className="proof-check panel" aria-labelledby="recheck-title">
        <div className="proof-check__head">
          <div>
            <h2 id="recheck-title" className="h3">
              Do not take this page&apos;s word for it
            </h2>
            <p className="small quiet">
              Your browser asks <span className="mono">{host}</span> for each transaction and for
              the program itself, and compares what the chain says with the record. This site is not
              in between.
            </p>
          </div>
          <button type="button" className="btn" disabled={running} onClick={() => void checkAll()}>
            {running ? 'Re-checking…' : `Re-check all ${all.length} on chain`}
          </button>
        </div>
        <p className="proof-check__tally" role="status">
          {done.length === 0 && unreachable === 0 ? (
            <span className="quiet">Nothing re-checked yet.</span>
          ) : (
            <>
              <strong>
                {passed} of {done.length} re-checked match the record
              </strong>
              {done.length - passed > 0 ? `; ${done.length - passed} do not` : ''}
              {unreachable > 0
                ? `. ${unreachable} could not be reached (the endpoint limits requests); press Re-check on those rows.`
                : '.'}
            </>
          )}
        </p>

        <div className="proof-program">
          <h3 className="label">The program itself</h3>
          <dl className="kv">
            <div className="kv__row">
              <dt>Program</dt>
              <dd>
                <a href={programExplorer} className="link mono" rel="noreferrer">
                  {programId}
                </a>
              </dd>
            </div>
            {build ? (
              <>
                <div className="kv__row">
                  <dt>Hash of the reproducible build</dt>
                  <dd className="mono">{build.program_hash}</dd>
                </div>
                <div className="kv__row">
                  <dt>Built with</dt>
                  <dd>
                    <span className="mono">{build.base_image}</span>, commit{' '}
                    <span className="mono">{build.commit}</span>
                  </dd>
                </div>
              </>
            ) : (
              <div className="kv__row">
                <dt>Build record</dt>
                <dd>Not available in this build of the site.</dd>
              </div>
            )}
            {program?.hash ? (
              <div className="kv__row">
                <dt>Hash of the bytes on-chain, just now</dt>
                <dd className="mono">{program.hash}</dd>
              </div>
            ) : null}
            {program && program.authority !== undefined ? (
              <div className="kv__row">
                <dt>Upgrade authority</dt>
                <dd>
                  {program.authority ? (
                    <span className="mono">{program.authority}</span>
                  ) : (
                    'None: the program can no longer be upgraded.'
                  )}
                </dd>
              </div>
            ) : null}
          </dl>
          <div className="proof-program__foot">
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              disabled={program?.status === 'checking'}
              onClick={() => void checkProgram()}
            >
              Re-check the program
            </button>
            <p className="small" role="status">
              {program ? (
                program.status === 'checking' ? (
                  <span className="quiet">{program.detail}</span>
                ) : (
                  <span
                    className="proof-row__verdict"
                    data-ink={
                      program.status === 'pass'
                        ? 'green'
                        : program.status === 'fail'
                          ? 'red'
                          : 'ochre'
                    }
                  >
                    <span className="pill">
                      {program.status === 'pass'
                        ? 'Pass'
                        : program.status === 'fail'
                          ? 'Fail'
                          : 'Not checked'}
                    </span>{' '}
                    {program.detail}
                  </span>
                )
              ) : (
                <span className="quiet">
                  Downloads the program&apos;s bytes and hashes them here (sha256, in your browser).
                </span>
              )}
            </p>
          </div>
        </div>
      </section>

      <section className="section--tight" aria-labelledby="refused-title">
        <hr className="rule" />
        <div className="sec-head" data-ink="red">
          <h2 id="refused-title" className="h2">
            Refused
          </h2>
          <span className="sec-head__tag label">
            <i className="patch" aria-hidden="true" />
            {groups.reduce((sum, group) => sum + group.proofs.length, 0)} attacks
          </span>
        </div>
        {groups.map((group) =>
          group.proofs.length === 0 ? null : (
            <div key={group.key} className="proof-group">
              <div className="proof-group__head">
                <h3 className="h3">{group.title}</h3>
                <p className="small quiet">{group.text}</p>
              </div>
              <ul className="proof-rows">{group.proofs.map((proof) => row(proof, true))}</ul>
            </div>
          ),
        )}
      </section>

      <section className="section--tight" aria-labelledby="executed-title">
        <hr className="rule" />
        <div className="sec-head" data-ink="green">
          <h2 id="executed-title" className="h2">
            Executed
          </h2>
          <span className="sec-head__tag label">
            <i className="patch" aria-hidden="true" />
            {executed.length} happy paths
          </span>
        </div>
        <p className="prose proof-group__lead">
          The same program doing what it is for, so the refusals above are not a program that
          refuses everything.
        </p>
        <ul className="proof-rows">{executed.map((proof) => row(proof, false))}</ul>
      </section>
    </>
  );
}
