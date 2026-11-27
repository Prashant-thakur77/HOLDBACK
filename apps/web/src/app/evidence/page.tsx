import type { Metadata } from 'next';

import { DateStamp } from '@/components/art/Stamps';
import { KeyTable, PageOpener, SectionHead } from '@/components/site/blocks';
import { VerifyAny } from '@/components/site/VerifyAny';
import { COLLECTORS, INVARIANTS } from '@/content/product';
import { programInvariants } from '@/lib/results';
import { EXAMPLE_HOLD } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Evidence and trust model',
  description:
    'Where a verdict comes from, how the evidence hash makes it checkable, and what each service key can and cannot do.',
};

const count = new Intl.NumberFormat('en-US');

const ATTACKS: { title: string; text: string }[] = [
  {
    title: 'If the oracle key is stolen',
    text: 'The attacker can delay releases of pending holds, up to 72 hours after each hold was created. They cannot take funds, cannot block undo, and cannot touch a hold whose window already ended. The admin rotates the key.',
  },
  {
    title: 'If the relayer key is stolen',
    text: 'This applies only to deposit-box users. The attacker can open a hold from a box to an address of their choice, but never with less than the default window of 30 minutes, cannot release it early, and cannot withdraw to themselves. During that window the owner can undo and the admin rotates the key.',
  },
  {
    title: 'If the risk agent is wrong or dishonest',
    text: 'The agent chooses nothing the sender does not sign. A window that is too short is a missed warning, not a loss of control. A window that is too long delays an honest recipient by at most the configured maximum, and the sender can release early at any time. The hash is on-chain, so the agent cannot later change what it claimed.',
  },
  {
    title: 'If a sender pays, receives the goods, and undoes',
    text: 'HOLDBACK is deliberately sender-protective inside the window. A recipient sees the hold, its release time and its tier before treating the payment as final, the way a merchant treats a pending card payment.',
  },
  {
    title: 'If every service is down',
    text: 'Nothing off-chain can move funds on its own. A wallet that can sign can still undo, release and close with the SDK alone.',
  },
];

export default function EvidencePage() {
  const invariants = programInvariants();
  return (
    <main>
      <PageOpener
        word="Evidence"
        ink="magenta"
        page={3}
        motif="stamp"
        lead="A verdict you cannot check is just an opinion. Every undo window here comes with the evidence that set it, and a hash on-chain that proves the evidence has not been changed."
      >
        <VerifyAny example={EXAMPLE_HOLD} />
      </PageOpener>

      <section className="section wrap" aria-labelledby="hash">
        <SectionHead id="hash" title="The evidence hash" ink="magenta" />
        <div className="two-col">
          <div className="stack">
            <ol className="hash-flow">
              <li>
                <span className="label">1. The document</span>
                Tier, window, score, policy version and every piece of evidence, as one JSON
                document in a fixed key order.
              </li>
              <li>
                <span className="label">2. The hash</span>
                <code>sha256(canonicalJson(document))</code>, 32 bytes.
              </li>
              <li>
                <span className="label">3. The hold</span>
                Those 32 bytes are written into the hold account when you sign. They cannot be
                edited afterwards.
              </li>
            </ol>
            <p className="prose">
              The receipt page fetches the document, recomputes the hash in your browser and
              compares it with the chain. If they match, the window was set from exactly that
              evidence by exactly that policy version. The language model never decides a tier or a
              window; it only writes the spoken explanation.
            </p>
          </div>
          <div aria-hidden="true" className="verify__stamp">
            <span
              data-reveal="stamp"
              style={{ ['--rot' as string]: '-8deg', display: 'inline-block' }}
            >
              <DateStamp
                top="EVIDENCE · SHA-256"
                bottom="WRITTEN INTO THE HOLD"
                line1="32 BYTES"
                line2="ON-CHAIN"
                ink="magenta"
                rotate={0}
                size={210}
              />
            </span>
          </div>
        </div>
      </section>

      <section className="section wrap" aria-labelledby="collectors">
        <SectionHead id="collectors" title="Eight places a verdict looks" ink="magenta" />
        <p className="lead">
          Eight collectors run in parallel. Each returns evidence with a weight, a plain sentence
          and, where there is one, a link you can follow.
        </p>
        <ul className="collectors" style={{ marginTop: 'var(--s5)' }}>
          {COLLECTORS.map((collector) => (
            <li key={collector.id}>
              <span className="mono small">{collector.id}</span>
              <h3 className="h3">{collector.name}</h3>
              <p>{collector.text}</p>
            </li>
          ))}
        </ul>
        <p className="prose rules-note">
          One signal exists nowhere else: how often senders pulled money back from an address. No
          blocklist has it, because it only exists where payments can be undone.
        </p>
      </section>

      <section className="section wrap" aria-labelledby="keys">
        <SectionHead id="keys" title="Keys boxed in by the program" ink="magenta" />
        <p className="lead" style={{ marginBottom: 'var(--s5)' }}>
          Three service keys exist. What each may do is enforced by the on-chain program, not by a
          promise from whoever runs the service.
        </p>
        <KeyTable />
        <div className="faq" style={{ marginTop: 'var(--s6)' }}>
          {ATTACKS.map((attack) => (
            <details key={attack.title}>
              <summary>{attack.title}</summary>
              <div>
                <p>{attack.text}</p>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="section wrap" aria-labelledby="invariants">
        <SectionHead id="invariants" title="Six invariants" ink="magenta" />
        <p className="lead" style={{ marginBottom: 'var(--s5)' }}>
          Six statements that must hold after every instruction.
          {invariants
            ? ` A property test checked them across ${count.format(invariants.cases)} random cases and ${count.format(invariants.instructions)} instructions, with ${count.format(invariants.violations)} violations.`
            : ''}{' '}
          A test is not an audit; the program is unaudited.
        </p>
        <ol className="invariants">
          {INVARIANTS.map((invariant) => (
            <li key={invariant}>{invariant}</li>
          ))}
        </ol>
      </section>
    </main>
  );
}
