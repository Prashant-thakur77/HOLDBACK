import { Tier, WINDOW_SECS_BY_TIER } from '@holdback/sdk';
import { RULES, SCENARIOS, findScenario } from '@holdback/dojo';
import Link from 'next/link';

import { Motif, type MotifName } from '@/components/art/Motifs';
import { DateStamp } from '@/components/art/Stamps';
import { T } from '@/components/LangProvider';
import { HomeHero } from '@/components/home/HomeHero';
import { Intro } from '@/components/home/Intro';
import { LiveCounters } from '@/components/home/LiveCounters';
import { SpotTheScam, type QuickCase } from '@/components/home/SpotTheScam';
import { Continued, KeyTable, SectionHead, TierTickets } from '@/components/site/blocks';
import { VerifyAny } from '@/components/site/VerifyAny';
import { STEPS } from '@/content/product';
import { PRECEDENTS, PROBLEM_FIGURES } from '@/content/references';
import { explorerUrl } from '@/lib/cluster';
import { evaluation, programInvariants } from '@/lib/results';
import { EXAMPLE_HOLD, PROGRAM_ID } from '@/lib/site';
import { loadLiveStats } from '@/lib/stats.server';

// The counters are read per request; nothing here is cached.
export const dynamic = 'force-dynamic';

const count = new Intl.NumberFormat('en-US');

const INTEGRATIONS: { name: string; motif: MotifName; text: string }[] = [
  {
    name: 'Solana Mobile / Seeker',
    motif: 'phone',
    text: 'A native Android app that signs holds through Mobile Wallet Adapter.',
  },
  {
    name: 'Pollar',
    motif: 'box',
    text: 'Wallets that can only make transfers pay into their own deposit box.',
  },
  {
    name: 'ElevenLabs',
    motif: 'speaker',
    text: 'A voice that explains the evidence in four languages.',
  },
  {
    name: 'Firecrawl',
    motif: 'report',
    text: 'Web reports that count only if they contain the exact address.',
  },
  {
    name: 'Supabase',
    motif: 'ledger',
    text: 'Evidence documents and a live mirror of holds for countdowns.',
  },
  { name: 'Byte', motif: 'slips', text: 'Scam Dojo, playable by people and by agents.' },
];

/**
 * Three written scenarios for the mini-game: two scams and one honest request
 * whose urgency is real. Named by id; if one is ever removed from the corpus,
 * the first scenarios of the right kind stand in.
 */
const QUICK_IDS = [
  'giveaway-send-to-double',
  'landlord-rent-overdue',
  'address-poisoning-contractor',
];

function quickCases(): QuickCase[] {
  const fallback = [
    SCENARIOS.find((item) => item.truth === 'scam'),
    SCENARIOS.find((item) => item.truth === 'legitimate'),
    [...SCENARIOS].reverse().find((item) => item.truth === 'scam'),
  ];
  return QUICK_IDS.flatMap((id, index) => {
    const scenario = findScenario(id) ?? fallback[index];
    if (!scenario) return [];
    return [
      {
        id: scenario.id,
        scam: scenario.truth === 'scam',
        channel: scenario.channel,
        from: scenario.from,
        transcript: scenario.transcript,
        amount: scenario.ask.amount,
        purpose: scenario.ask.purpose,
        tells: scenario.tells,
        lesson: scenario.lesson,
      },
    ];
  });
}

export default async function HomePage() {
  const live = await loadLiveStats();
  const invariants = programInvariants();
  const run = evaluation();
  const today = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date());

  return (
    <main className="home">
      <Intro />
      <div className="wrap">
        <p className="edition small">
          <span>{today}</span>
          <span className="edition__motto">Every claim carries its receipt.</span>
          <a
            href={explorerUrl('address', PROGRAM_ID)}
            className="mono edition__program"
            rel="noreferrer"
          >
            Program {PROGRAM_ID.slice(0, 6)}…{PROGRAM_ID.slice(-4)}
          </a>
        </p>
      </div>

      <HomeHero
        exampleHold={EXAMPLE_HOLD}
        windows={{
          TRUSTED: WINDOW_SECS_BY_TIER[Tier.TRUSTED],
          UNKNOWN: WINDOW_SECS_BY_TIER[Tier.UNKNOWN],
          SUSPICIOUS: WINDOW_SECS_BY_TIER[Tier.SUSPICIOUS],
          FLAGGED: WINDOW_SECS_BY_TIER[Tier.FLAGGED],
        }}
      />

      <LiveCounters initial={live} />

      <section className="section wrap" aria-labelledby="problem">
        <SectionHead id="problem" title="Final in under a second" ink="red" tag="The problem" />
        <div className="problem">
          <p className="lead problem__lead">
            Payments on Solana cannot be taken back. That is the feature scammers rely on: by the
            time you know, the money has moved on.
          </p>
          <ul className="figures">
            {PROBLEM_FIGURES.map((item, index) => (
              <li
                key={item.figure}
                className={index === 3 ? 'figures__item is-point' : 'figures__item'}
              >
                <p className="figures__num">{item.figure}</p>
                <p className="figures__claim">{item.claim}</p>
                <p className="small quiet">{item.scope}</p>
                <a href={item.url} className="link small" rel="noreferrer">
                  {item.source}
                </a>
              </li>
            ))}
          </ul>
          <div className="problem__point">
            <div>
              <p className="h2 problem__say" data-split>
                The last figure is the point.
              </p>
              <p className="prose">
                Where a payment can still be stopped, money comes back. On-chain there is no such
                moment. HOLDBACK adds one, and makes it exactly as long as the evidence about the
                recipient justifies.
              </p>
            </div>
            <ul className="precedents">
              {PRECEDENTS.map((item) => (
                <li key={item.place}>
                  <b>{item.place}.</b> {item.what}{' '}
                  <a href={item.url} className="link" rel="noreferrer">
                    {item.source}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="section wrap" aria-labelledby="how">
        <SectionHead id="how" title="How a hold works" ink="blue" tag="Page 2" />
        <p className="lead">
          The riskier the recipient looks, the longer you can take the money back. Five tiers, five
          tickets, one hole each.
        </p>
        <TierTickets />
        <ol className="steps">
          {STEPS.map((step, index) => (
            <li key={step.name} data-reveal="slide" style={{ ['--i' as string]: index }}>
              <span className="steps__n num" aria-hidden="true">
                {index + 1}
              </span>
              <h3 className="h3">{step.name}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
        <Continued href="/how-it-works" page={2}>
          One payment, step by step
        </Continued>
      </section>

      <section className="section wrap" aria-labelledby="verify">
        <SectionHead id="verify" title="Checkable, not promised" ink="magenta" tag="Page 3" />
        <div className="verify">
          <div className="verify__copy">
            <p className="lead">
              The evidence behind every window is hashed, and the hash is written into the hold.
              Open any receipt, press one button, and your browser recomputes it.
            </p>
            <p className="verify__formula mono">
              Hold.evidence_hash = sha256(canonicalJson(document))
            </p>
            <p className="prose">
              If the two match, the window was set from exactly that evidence by exactly that policy
              version, and nobody can have changed it afterwards.
            </p>
            <VerifyAny example={EXAMPLE_HOLD} />
          </div>
          <div className="verify__stamp" aria-hidden="true">
            <DateStamp
              top="EVIDENCE · SHA-256"
              bottom="RECOMPUTED IN YOUR BROWSER"
              line1="CHECK IT"
              line2="YOURSELF"
              ink="magenta"
              size={220}
            />
          </div>
        </div>
        <h3 className="h3 verify__keys">
          Service keys are boxed in by the program, not by promises
        </h3>
        <KeyTable />
        <p className="verify__more">
          <Continued href="/evidence" page={3}>
            The evidence and the trust model
          </Continued>
          <Continued href="/proof" page={8}>
            Try to rob it: every attack, refused on-chain
          </Continued>
        </p>
      </section>

      <section className="section wrap" aria-labelledby="results">
        <SectionHead id="results" title="What was measured" ink="green" tag="Page 4" />
        {invariants ? (
          <>
            <dl className="ledger" style={{ ['--cols' as string]: 3 }}>
              <div className="ledger__cell">
                <dt className="label">Random cases in the property test</dt>
                <dd className="num" data-count={invariants.cases}>
                  {count.format(invariants.cases)}
                </dd>
              </div>
              <div className="ledger__cell">
                <dt className="label">Instructions executed</dt>
                <dd className="num" data-count={invariants.instructions}>
                  {count.format(invariants.instructions)}
                </dd>
              </div>
              <div className="ledger__cell">
                <dt className="label">Invariant violations</dt>
                <dd className="num" data-count={invariants.violations}>
                  {count.format(invariants.violations)}
                </dd>
              </div>
            </dl>
            <p className="ledger__note">
              Six invariants are checked after every instruction. Read from{' '}
              <code>eval/program_invariants.json</code> at build time. A test is not an audit: the
              program is unaudited.
            </p>
          </>
        ) : (
          <p className="notice">The property-test counts were not available when this was built.</p>
        )}
        {run?.negative?.caught ? (
          <p className="notice results-teaser" data-ink="green">
            <strong>The risk agent was measured too, and one result is negative.</strong> Of{' '}
            {run.negative.caught.n} freshly created wallets, the policy raised{' '}
            {run.negative.caught.successes} above the default tier. The results page prints the
            whole evaluation, with its limitations.
          </p>
        ) : null}
        <Continued href="/results" page={4}>
          All results, and what has run where
        </Continued>
      </section>

      <section className="section wrap dojo-teaser" aria-labelledby="dojo">
        <SectionHead id="dojo" title="Should you pay this?" ink="red" tag="Page 6" />
        <p className="lead">
          Three real requests from Scam Dojo. Some are honest: rent, a bill, a friend splitting
          dinner. Some are scams. Mark each one, then see the tells.
        </p>
        <SpotTheScam cases={quickCases()} />
        <p className="small quiet dojo-teaser__rules">
          The full game is {RULES.maxRounds} rounds with {RULES.startingLives} lives and a practice
          wallet of {count.format(RULES.startingWallet)} USDC, and its address check runs the real
          risk agent.
        </p>
      </section>

      <section className="section wrap" aria-labelledby="integrations">
        <SectionHead id="integrations" title="Built with" ink="copper" tag="Page 5" />
        <ul className="integrations" data-ink="copper">
          {INTEGRATIONS.map((item, index) => (
            <li key={item.name} data-reveal="draw" style={{ ['--i' as string]: index }}>
              <Motif name={item.motif} size={84} />
              <div>
                <h3 className="h3">{item.name}</h3>
                <p>{item.text}</p>
              </div>
            </li>
          ))}
        </ul>
        <Continued href="/integrations" page={5}>
          What each one does here
        </Continued>
      </section>

      <section className="closing wrap" aria-labelledby="closing">
        <hr className="rule" data-reveal="rule" />
        <div className="closing__grid">
          <h2 id="closing" className="h2 closing__title" data-split>
            Nobody honest needs your money this minute.
          </h2>
          <div>
            <p className="lead">
              Urgency is how scams work. A hold takes the urgency away: send now, and keep the right
              to change your mind.
            </p>
            <div className="btn-row closing__actions">
              <Link href="/app" className="btn" data-magnetic>
                <T k="cta.send" />
              </Link>
              <Link href="/docs" className="btn btn--ghost">
                Read the docs
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
