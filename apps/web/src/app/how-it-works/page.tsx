import type { Metadata } from 'next';
import Link from 'next/link';

import { Bowl } from '@/components/art/Bowl';
import { BoxStamp } from '@/components/art/Stamps';
import { PageOpener, SectionHead, TierTickets } from '@/components/site/blocks';
import { PaymentStory } from '@/components/motion/PaymentStory';
import { COLLECTORS, LIMITS, STEPS, TIER_FACTS } from '@/content/product';
import { windowLabel } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'One payment, step by step: assess, decide, commit, hold, then undo or settle. The undo window is sized by evidence.',
};

/** The crossed cheque: two strokes across the face mean "not payable over the counter yet". */
function Crossing() {
  return (
    <svg
      viewBox="0 0 280 150"
      className="crossing"
      role="img"
      aria-label="A payment slip crossed with two lines: held, not yet payable"
    >
      <rect
        x="2"
        y="2"
        width="276"
        height="146"
        fill="var(--stock)"
        stroke="var(--ink)"
        strokeWidth="2.5"
      />
      <path d="M18 34h120M18 60h244M18 86h170M18 112h90" stroke="var(--ink)" strokeWidth="1" />
      <rect
        x="196"
        y="98"
        width="66"
        height="30"
        fill="none"
        stroke="var(--ink)"
        strokeWidth="1.5"
      />
      <path
        d="M96 150 L176 0 M122 150 L202 0"
        stroke="var(--blue-ink)"
        strokeWidth="4"
        strokeLinecap="square"
      />
    </svg>
  );
}

/** The scroll story follows one payment to a recipient the policy calls suspicious. */
const EXAMPLE_WINDOW = TIER_FACTS.find((fact) => fact.tier === 'SUSPICIOUS')?.windowSecs ?? 0;

const ASIDES = [
  <>
    <span className="label">Time budgets</span>
    Each collector has a few seconds. One that does not answer in time is listed as unavailable and
    adds no points; it is never counted as a clean result.
  </>,
  <>
    <span className="label">Who decides</span>
    Code, not a model. The same evidence always gives the same tier and the same window, and the
    policy version is part of the evidence document.
  </>,
  <>
    <span className="label">The commitment</span>
    <code>Hold.evidence_hash = sha256(canonicalJson(document))</code>
  </>,
  null,
  null,
];

export default function HowItWorksPage() {
  return (
    <main>
      <PageOpener
        word="How it works"
        ink="blue"
        page={2}
        motif="punch"
        lead="A hold is a payment that waits. The money leaves your wallet and sits in a vault that belongs to that one payment. Until the release time only you can move it, and only back to yourself."
      >
        <nav aria-label="On this page" className="toc">
          <a href="#journey">One payment, five stages</a>
          <a href="#tiers">Five tiers, five windows</a>
          <a href="#transfer-only">Wallets that can only transfer</a>
          <a href="#limits">Limits</a>
        </nav>
      </PageOpener>

      <section className="section wrap" aria-labelledby="journey">
        <SectionHead id="journey" title="One payment, five stages" ink="blue" />
        <PaymentStory
          steps={STEPS}
          collectors={COLLECTORS.map((collector) => collector.name)}
          windowSecs={EXAMPLE_WINDOW}
          windowText={windowLabel(EXAMPLE_WINDOW, 'en')}
        />
        <ol className="journey">
          {STEPS.map((step, index) => (
            <li key={step.name} className="journey__step">
              <span className="journey__n num" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <h3 className="h3">{step.name}</h3>
                <p className="prose">{step.text}</p>
              </div>
              {index === 3 ? (
                <div className="journey__aside journey__aside--art">
                  <Crossing />
                  <p className="small quiet">
                    Held: crossed, like a cheque that cannot be cashed on the spot.
                  </p>
                </div>
              ) : index === 4 ? (
                <div className="journey__aside journey__aside--art">
                  <Bowl
                    fill={0.6}
                    state="floating"
                    title="The bowl is still floating: the payment can still be taken back"
                  />
                  <p className="small quiet">
                    Undo is lifting the bowl out. Settling is letting it sink.
                  </p>
                </div>
              ) : (
                <p className="journey__aside">{ASIDES[index]}</p>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="section wrap" aria-labelledby="tiers">
        <SectionHead id="tiers" title="Five tiers, five windows" ink="blue" />
        <p className="lead">
          The riskier the recipient looks, the longer you can take the money back. Each tier prints
          its own ticket, punched at the hour its window ends.
        </p>
        <TierTickets />
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">In plain words</th>
                <th scope="col">Tier</th>
                <th scope="col">When</th>
                <th scope="col">Undo window</th>
              </tr>
            </thead>
            <tbody>
              {TIER_FACTS.map((fact) => (
                <tr key={fact.tier}>
                  <td>{fact.plain}</td>
                  <td>
                    <span className="mono">{fact.tier}</span>
                  </td>
                  <td>{fact.when}</td>
                  <td>
                    {windowLabel(fact.windowSecs, 'en')}
                    {fact.extra ? `, ${fact.extra}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="prose rules-note">
          While a window runs, the risk oracle can lengthen it if new evidence raises the tier, up
          to 72 hours after the hold was created. It can never shorten it. You can release early at
          any time, with your own signature.
        </p>
      </section>

      <section className="section wrap" aria-labelledby="transfer-only">
        <SectionHead id="transfer-only" title="Wallets that can only transfer" ink="blue" />
        <div className="two-col">
          <div className="prose">
            <p>
              Some embedded wallets can send tokens to an address and nothing else. They cannot sign
              a program instruction, so they cannot open a hold themselves. For them there is the
              deposit box.
            </p>
            <ol className="limits">
              <li>
                <span className="mono">01</span>
                <span>
                  The relayer creates your deposit box: an on-chain inbox that belongs to you.
                </span>
              </li>
              <li>
                <span className="mono">02</span>
                <span>
                  You prove the wallet is yours without signing a message: you send an exact, random
                  amount into your own box, and the transfer is verified on-chain.
                </span>
              </li>
              <li>
                <span className="mono">03</span>
                <span>
                  To pay, you transfer into the box and ask for a hold. The program takes the
                  hold&apos;s sender from the box, never from instruction data.
                </span>
              </li>
              <li>
                <span className="mono">04</span>
                <span>
                  Undo and withdraw return funds to your own wallet. The relayer has no other
                  destination available.
                </span>
              </li>
            </ol>
          </div>
          <div className="stack">
            <p className="notice" data-ink="ochre">
              <strong>The trade-off.</strong> A wallet that cannot sign program instructions depends
              on the relayer to undo within the window. That is why a deposit box is meant to hold
              only what is about to be sent.
            </p>
            <Link href="/evidence#keys" className="more">
              What the relayer key can and cannot do
            </Link>
          </div>
        </div>
      </section>

      <section className="section wrap" aria-labelledby="limits">
        <SectionHead id="limits" title="Limits" ink="blue" />
        <div className="two-col">
          <ul className="limits">
            {LIMITS.map((limit, index) => (
              <li key={limit}>
                <span className="mono">{String(index + 1).padStart(2, '0')}</span>
                <span>{limit}</span>
              </li>
            ))}
          </ul>
          <div aria-hidden="true">
            <span
              data-reveal="stamp"
              style={{ ['--rot' as string]: '-5deg', display: 'inline-block' }}
            >
              <BoxStamp text="Not insurance" ink="blue" rotate={0} size={68} />
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
