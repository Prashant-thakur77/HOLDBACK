import { PublicKey } from '@solana/web3.js';
import type { Metadata } from 'next';

import { PageOpener } from '@/components/site/blocks';
import { explorerUrl, rpcUrl } from '@/lib/cluster';
import { ATTACKERS, attackerOf, programBuild, proofReport } from '@/lib/proof/data';

import { ProofBoard } from './ProofBoard';

export const metadata: Metadata = {
  title: 'Try to rob it',
  description:
    'Every attack on the HOLDBACK program that was tried on Solana devnet, refused on-chain, with a button that re-checks each transaction from your own browser.',
};

/** The loader that owns upgradeable programs; a program's bytes live in its ProgramData account. */
const UPGRADEABLE_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

const JUDGES_URL = 'https://github.com/Prashant-thakur77/HOLDBACK/blob/main/JUDGES.md';

function day(iso: string): string {
  const time = new Date(iso);
  return Number.isNaN(time.getTime())
    ? iso
    : new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(time);
}

/**
 * "Try to rob it": the devnet proofs. Every row is read from
 * `proofs/devnet.json`, compiled in at build time; nothing on the page is
 * typed in by hand. The board re-checks each row from the visitor's browser.
 */
export default function ProofPage() {
  const report = proofReport();
  const build = programBuild();

  if (!report) {
    return (
      <main>
        <PageOpener
          word="Try to rob it"
          ink="ochre"
          page={8}
          motif="stamp"
          lead="The record of attacks tried against the program on Solana devnet."
        />
        <div className="wrap section--tight">
          <p className="notice" data-ink="ochre">
            <code>proofs/devnet.json</code> was not found when this site was built, so there are no
            rows to show. <code>make verify</code> in the repository checks the proofs from a
            terminal.
          </p>
        </div>
      </main>
    );
  }

  const attacks = report.proofs.filter((proof) => proof.kind === 'attack');
  const executed = report.proofs.filter((proof) => proof.kind === 'happy path');
  const groups = ATTACKERS.map((attacker) => ({
    ...attacker,
    proofs: attacks.filter((proof) => attackerOf(proof) === attacker.key),
  }));
  const [programData] = PublicKey.findProgramAddressSync(
    [new PublicKey(report.program).toBytes()],
    UPGRADEABLE_LOADER,
  );

  return (
    <main>
      <PageOpener
        word="Try to rob it"
        ink="ochre"
        page={8}
        motif="stamp"
        lead="Every row is a transaction on Solana devnet. Attacks were sent with preflight off, so the refusal is recorded on-chain."
      >
        <p className="prose">
          A wallet normally simulates a transaction first and never sends one that would fail. These
          were sent anyway, on purpose, so that each refusal is a public record anyone can look up,
          not a claim.
        </p>
      </PageOpener>

      <div className="wrap">
        <dl className="ledger proof-ledger" style={{ ['--cols' as string]: 4 }}>
          <div className="ledger__cell">
            <dt className="label">Attacks refused</dt>
            <dd className="num">{report.counts.attacks_refused}</dd>
          </div>
          <div className="ledger__cell">
            <dt className="label">Happy paths executed</dt>
            <dd className="num">{report.counts.happy_paths}</dd>
          </div>
          <div className="ledger__cell">
            <dt className="label">Transactions on {report.cluster}</dt>
            <dd className="num">{report.proofs.length}</dd>
          </div>
          <div className="ledger__cell">
            <dt className="label">Recorded</dt>
            <dd className="proof-ledger__date">{day(report.generated_at)}</dd>
          </div>
        </dl>

        <ProofBoard
          groups={groups}
          executed={executed}
          programId={report.program}
          programDataAddress={programData.toBase58()}
          programExplorer={explorerUrl('address', report.program)}
          build={build}
          rpcUrl={rpcUrl()}
        />

        <p className="proof-foot prose">
          Reproduce from a terminal: <code>make verify</code>. It applies the same rules to the same
          file, with no keys.{' '}
          <a href={JUDGES_URL} className="link" rel="noreferrer">
            The judges&apos; guide
          </a>{' '}
          walks through it. The program is on devnet and unaudited; these proofs show what was
          tried, not that nothing else could be.
        </p>
      </div>
    </main>
  );
}
