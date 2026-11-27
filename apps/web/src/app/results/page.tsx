import type { Metadata } from 'next';

import { DateStamp } from '@/components/art/Stamps';
import { PageOpener, SectionHead } from '@/components/site/blocks';
import {
  evalResults,
  evaluation,
  programInvariants,
  type Evaluation,
  type Rate,
  type ResultRow,
} from '@/lib/results';

export const metadata: Metadata = {
  title: 'Results',
  description:
    'What was measured, read from the evaluation data at build time, and an honest list of what has run where.',
};

const count = new Intl.NumberFormat('en-US');

const percent = (value: number) => `${(value * 100).toFixed(value > 0 && value < 0.1 ? 1 : 0)}%`;

/** A rate is always printed with its counts; the interval follows when the file has one. */
function RateCell({ rate }: { rate: Rate | null }) {
  if (!rate) return <>not reported</>;
  if (rate.n === 0 || rate.value === null)
    return (
      <>
        no cases ({rate.successes} of {rate.n})
      </>
    );
  return (
    <>
      <strong>
        {rate.successes} of {rate.n}
      </strong>{' '}
      ({percent(rate.value)}
      {rate.low !== null && rate.high !== null
        ? `; 95% interval ${percent(rate.low)} to ${percent(rate.high)}`
        : ''}
      )
    </>
  );
}

/** Backticks in the evaluation's own sentences become code. */
function Sentence({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, index) => (index % 2 ? <code key={index}>{part}</code> : part))}
    </>
  );
}

function when(iso: string | null): string {
  if (!iso) return 'an unrecorded time';
  const time = new Date(iso);
  return Number.isNaN(time.getTime())
    ? iso
    : `${time.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function EvaluationView({ run, rows }: { run: Evaluation; rows: ResultRow[] }) {
  const heldout = run.splits.find((split) => split.name === 'heldout') ?? run.splits[0] ?? null;
  const ms = (value: number | null) =>
    value === null ? 'not reported' : `${Math.round(value)} ms`;
  return (
    <div className="stack">
      {run.unavailableCollectors.length > 0 ? (
        <p className="notice" data-ink="ochre">
          <strong>Read this first.</strong> In this run {run.unavailableCollectors.length} of the{' '}
          {run.unavailableCollectors.length + run.answeringCollectors.length} collectors did not
          answer in any assessment (
          <span className="mono">{run.unavailableCollectors.join(', ')}</span>
          ), because their keys or data were not configured. A missing collector adds no points, so
          the numbers below describe a mostly blind agent, not a configured one.
        </p>
      ) : null}

      <dl className="ledger" style={{ ['--cols' as string]: 3 }}>
        <div className="ledger__cell">
          <dt className="label">Known scam addresses raised above the default, held-out set</dt>
          <dd className="num">
            {heldout?.holdback.recall
              ? `${heldout.holdback.recall.successes} of ${heldout.holdback.recall.n}`
              : '–'}
          </dd>
        </div>
        <div className="ledger__cell">
          <dt className="label">Honest addresses wrongly raised</dt>
          <dd className="num">
            {heldout?.holdback.falsePositive
              ? `${heldout.holdback.falsePositive.successes} of ${heldout.holdback.falsePositive.n}`
              : '–'}
          </dd>
        </div>
        <div className="ledger__cell">
          <dt className="label">Fresh wallets raised above the default</dt>
          <dd className="num">
            {run.negative?.caught
              ? `${run.negative.caught.successes} of ${run.negative.caught.n}`
              : '–'}
          </dd>
        </div>
      </dl>
      <p className="small quiet">
        {run.datasetRows !== null
          ? `${count.format(run.datasetRows)} addresses in the dataset`
          : ''}
        {Object.keys(run.rowsByLabel).length > 0
          ? ` (${Object.entries(run.rowsByLabel)
              .map(([label, n]) => `${n} ${label}`)
              .join(', ')})`
          : ''}
        . {run.detectionRule ? `Counted as raised when the ${run.detectionRule}. ` : ''}
        Generated {when(run.generatedAt)}
        {run.commit ? ` at commit ${run.commit.slice(0, 7)}` : ''}
        {run.uncommittedChanges ? ', from a working tree with uncommitted changes' : ''}.
      </p>

      {run.negative?.caught ? (
        <div className="negative">
          <h3 className="h3">The negative result</h3>
          <p className="prose">
            A wallet created minutes ago, with no history and no report against it, is what a
            scammer&apos;s next address looks like. The evaluation tried {run.negative.caught.n} of
            them and the policy raised {run.negative.caught.successes} above the default tier.
            Evidence cannot see an address nobody has reported yet. What such a payment still gets
            is the default window
            {run.negative.windowsSecs[0]
              ? ` of ${Math.round(run.negative.windowsSecs[0] / 60)} minutes`
              : ''}
            , and the table below shows how much that is worth.
          </p>
        </div>
      ) : null}

      {run.splits.length > 0 ? (
        <div className="table-scroll">
          <table className="table">
            <caption className="visually-hidden">
              Detection, HOLDBACK against a static blocklist
            </caption>
            <thead>
              <tr>
                <th scope="col">Set</th>
                <th scope="col">Measure</th>
                <th scope="col">HOLDBACK</th>
                <th scope="col">Static blocklist</th>
              </tr>
            </thead>
            <tbody>
              {run.splits.flatMap((split) =>
                (
                  [
                    ['Scam addresses caught', split.holdback.recall, split.baseline.recall],
                    [
                      'Honest addresses wrongly caught',
                      split.holdback.falsePositive,
                      split.baseline.falsePositive,
                    ],
                  ] as const
                ).map(([measure, ours, theirs]) => (
                  <tr key={`${split.name}-${measure}`}>
                    <td>
                      <span className="mono">{split.name}</span>
                    </td>
                    <td>{measure}</td>
                    <td>
                      <RateCell rate={ours} />
                    </td>
                    <td>
                      <RateCell rate={theirs} />
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      ) : null}
      {run.baselineMethod ? (
        <p className="small quiet">Blocklist baseline: {run.baselineMethod}.</p>
      ) : null}

      {run.replay.length > 0 ? (
        <>
          <h3 className="h3 results__sub">
            If the fraud is noticed later, what can still be taken back
          </h3>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Payments</th>
                  <th scope="col">Noticed after</th>
                  <th scope="col">Still undoable with a hold</th>
                  <th scope="col">With a plain transfer</th>
                </tr>
              </thead>
              <tbody>
                {run.replay.flatMap((table) =>
                  table.rows.map((row) => (
                    <tr key={`${table.label}-${row.delay}`}>
                      <td>{table.label}</td>
                      <td>{row.delay}</td>
                      <td>
                        <strong>
                          {row.reclaimable} of {row.payments}
                        </strong>
                      </td>
                      <td>
                        {row.plainTransferShare === null
                          ? 'not reported'
                          : row.plainTransferShare === 0
                            ? 'none'
                            : percent(row.plainTransferShare)}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          <p className="small quiet">
            A replay, not live payments: each address is paid once and the window the policy gave it
            is compared with the delay.
            {run.assumedAmountUsd !== null
              ? ` Amounts are an assumption of $${count.format(run.assumedAmountUsd)} each, so only the counts are shown.`
              : ''}
          </p>
        </>
      ) : null}

      {run.verdict || run.chain ? (
        <>
          <h3 className="h3 results__sub">How long it takes</h3>
          <dl className="ledger" style={{ ['--cols' as string]: run.chain ? 4 : 2 }}>
            {run.verdict ? (
              <>
                <div className="ledger__cell">
                  <dt className="label">
                    Verdict, median{run.verdict.n ? ` of ${run.verdict.n}` : ''}
                  </dt>
                  <dd className="num">{ms(run.verdict.median)}</dd>
                </div>
                <div className="ledger__cell">
                  <dt className="label">Verdict, 95th percentile</dt>
                  <dd className="num">{ms(run.verdict.p95)}</dd>
                </div>
              </>
            ) : null}
            {run.chain ? (
              <>
                <div className="ledger__cell">
                  <dt className="label">
                    Create a hold on devnet, median
                    {run.chain.createHold.n ? ` of ${run.chain.createHold.n}` : ''}
                  </dt>
                  <dd className="num">{ms(run.chain.createHold.median)}</dd>
                </div>
                <div className="ledger__cell">
                  <dt className="label">
                    Undo on devnet, median{run.chain.reclaim.n ? ` of ${run.chain.reclaim.n}` : ''}
                  </dt>
                  <dd className="num">{ms(run.chain.reclaim.median)}</dd>
                </div>
              </>
            ) : null}
          </dl>
          <p className="small quiet">
            {run.unavailableCollectors.length > 0
              ? 'Verdict times come from an agent whose unavailable collectors did no work, so a configured agent will be slower. '
              : ''}
            Chain times run from sending the transaction to confirmation.
          </p>
        </>
      ) : null}

      {run.limitations.length > 0 ? (
        <>
          <h3 className="h3 results__sub">Limitations, as the evaluation states them</h3>
          <ol className="limits">
            {run.limitations.map((limitation, index) => (
              <li key={limitation}>
                <span className="mono">{String(index + 1).padStart(2, '0')}</span>
                <span>
                  <Sentence text={limitation} />
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      <details className="results__all">
        <summary>Every value in eval/results.json ({rows.length} rows)</summary>
        <div className="table-scroll results-rows">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Path in the file</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.path}>
                  <td>
                    <span className="mono">{row.path}</span>
                  </td>
                  <td>
                    <span className="mono">{row.value}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** From the repository README's "What has run where". */
const STATUS: { part: string; verified: string; notYet: string }[] = [
  {
    part: 'Program',
    verified:
      '30 Rust tests, a 100,000-case property test, 13 localnet scenarios; deployed and exercised on devnet',
    notYet: 'Audit; reproducible Docker build',
  },
  { part: 'SDK', verified: '27 unit tests; used by every other package', notYet: '' },
  {
    part: 'Risk agent',
    verified:
      '221 tests; create, oracle extend, crank release and close, and a Dojo memo on devnet under Node',
    notYet:
      'Inside the Workers runtime with a private RPC; live calls to Helius, Chainabuse, Firecrawl, ElevenLabs; a real database',
  },
  {
    part: 'Webhook and schema',
    verified: '56 decoder tests; migrations and end-to-end ingest against a local Postgres',
    notYet: 'A hosted project, a real Helius delivery, Realtime',
  },
  {
    part: 'MCP server',
    verified: '45 tests; the binary lists its tools',
    notYet: 'Signing on a real cluster',
  },
  {
    part: 'Web',
    verified: 'Action, Dojo API and headers under the Workers runtime locally',
    notYet: 'Deployment; a wallet in a browser; a Blink client',
  },
  {
    part: 'Scam Dojo',
    verified: '101 tests; a full run over HTTP',
    notYet: 'Upload to Byte; the report collector (needs a Firecrawl key)',
  },
];

export default function ResultsPage() {
  const invariants = programInvariants();
  const rows = evalResults();
  const run = evaluation();

  return (
    <main>
      <PageOpener
        word="Results"
        ink="green"
        page={4}
        lead="Numbers on this page are read from files that scripts write. If a script has not been run, the page says so instead of showing a figure."
      />

      <section className="section wrap" aria-labelledby="property">
        <SectionHead id="property" title="The program, under random fire" ink="green" />
        {invariants ? (
          <>
            <dl
              className="ledger"
              style={{ ['--cols' as string]: invariants.holdsOpened === null ? 3 : 4 }}
            >
              <div className="ledger__cell">
                <dt className="label">Random cases</dt>
                <dd className="num">{count.format(invariants.cases)}</dd>
              </div>
              <div className="ledger__cell">
                <dt className="label">Instructions executed</dt>
                <dd className="num">{count.format(invariants.instructions)}</dd>
              </div>
              {invariants.holdsOpened === null ? null : (
                <div className="ledger__cell">
                  <dt className="label">Holds opened</dt>
                  <dd className="num">{count.format(invariants.holdsOpened)}</dd>
                </div>
              )}
              <div className="ledger__cell">
                <dt className="label">Invariant violations</dt>
                <dd className="num">{count.format(invariants.violations)}</dd>
              </div>
            </dl>
            <p className="prose rules-note">
              A property test drives the program with random sequences of instructions and checks
              six invariants after every one. Source: <code>eval/program_invariants.json</code>,
              written by <code>npm run program:fuzz</code> and read when this site was built. A test
              is not an audit: the program is unaudited.
            </p>
          </>
        ) : (
          <p className="notice" data-ink="ochre">
            <code>eval/program_invariants.json</code> was not found when this site was built, so no
            counts are shown. <code>npm run program:fuzz</code> writes it.
          </p>
        )}
      </section>

      <section className="section wrap" aria-labelledby="evaluation">
        <SectionHead id="evaluation" title="The risk agent, measured" ink="green" />
        {run && rows ? (
          <EvaluationView run={run} rows={rows} />
        ) : (
          <div className="empty-state">
            <span aria-hidden="true">
              <DateStamp
                top="EVALUATION"
                bottom="NOTHING TO SHOW YET"
                line1="NOT RUN"
                line2="ON THIS BUILD"
                ink="green"
                size={150}
              />
            </span>
            <div className="prose">
              <p className="h3">The evaluation has not been run for this build.</p>
              <p>
                Results are generated by <code>make eval</code>, which builds the dataset, runs a
                blocklist baseline and the risk agent against it, and writes{' '}
                <code>eval/results.json</code>. This page prints that file. Until it exists, there
                is no detection rate to show, and none is claimed.
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="section wrap" aria-labelledby="status">
        <SectionHead id="status" title="What has run where" ink="green" />
        <div className="table-scroll status-table">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Part</th>
                <th scope="col">Verified</th>
                <th scope="col">Not yet</th>
              </tr>
            </thead>
            <tbody>
              {STATUS.map((row) => (
                <tr key={row.part}>
                  <td>{row.part}</td>
                  <td>{row.verified}</td>
                  <td>{row.notYet || 'Nothing outstanding'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
