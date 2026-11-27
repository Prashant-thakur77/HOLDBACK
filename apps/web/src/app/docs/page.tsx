import type { Metadata } from 'next';
import Link from 'next/link';

import { PageOpener } from '@/components/site/blocks';
import { Copy } from '@/components/site/Copy';
import { explorerUrl } from '@/lib/cluster';
import { publicEnv } from '@/lib/env';
import { CONFIG_ADDRESS, PROGRAM_ID } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Docs and questions',
  description:
    'Run HOLDBACK locally, the devnet program id, accounts and seeds, the HTTP surface of this site, and common questions.',
};

const ACCOUNTS: [string, string, string][] = [
  ['Config', '["config"]', 'Admin, relayer, oracle, window limits, pause switch'],
  ['Hold', '["hold", sender, nonce_le_u64]', 'One protected payment'],
  ['Vault', 'ATA(mint, owner = Hold)', 'The tokens; SOL sits in the Hold account'],
  ['Trust', '["trust", sender, recipient]', '"Sender trusts recipient"'],
  ['DepositBox', '["box", owner]', 'Inbox for wallets that can only make transfers'],
  ['Flag', '["flag", reporter, subject]', 'One scam report per reporter per subject'],
  ['SubjectStats', '["stats", subject]', 'Flags, holds received, reclaimed-against, released-to'],
];

const INSTRUCTIONS = [
  'initialize_config',
  'update_config',
  'create_hold',
  'create_hold_sol',
  'instant_transfer',
  'instant_transfer_sol',
  'init_deposit_box',
  'open_hold_from_deposit',
  'withdraw_deposit',
  'extend_window',
  'reclaim',
  'reclaim_sol',
  'release',
  'release_early',
  'release_sol',
  'release_early_sol',
  'set_trust',
  'remove_trust',
  'flag_subject',
  'close_hold',
];

const ROUTES: [string, string][] = [
  ['GET /api/health', 'Build info and which integrations are configured (booleans only)'],
  ['GET /actions.json', 'Solana Actions rules: /pay and /api/actions/**'],
  [
    'GET /api/actions/pay?to=&amount=&mint=',
    'Action metadata with the recipient’s current verdict',
  ],
  [
    'POST /api/actions/pay?to=&amount=',
    'Body {"account": "<payer>"}; returns the unsigned payment transaction',
  ],
  ['POST /api/dojo/runs', 'Starts a Scam Dojo run; returns the state and a play token'],
  ['POST /api/dojo/runs/{id}/moves', 'One move, with the turn it was decided on'],
  ['GET /api/dojo/runs/{id}/watch', 'The state plus the truth about every decided round'],
];

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Does this make a payment safe?',
    a: 'No, and nothing here says so. A hold gives you time and a warning. If the check finds nothing, it says "no warning signs found", which is a statement about what was found, not a promise about the recipient. If you wait out the window and only then discover a fraud, the money is gone.',
  },
  {
    q: 'Who decides how long the window is?',
    a: 'A deterministic policy in code. It turns the evidence into a tier, and the tier into a window: none for someone you trust, 30 minutes by default, 6 hours when suspicious, 24 hours when flagged, 72 hours plus a typed confirmation for a sanctioned address. The language model only writes the explanation.',
  },
  {
    q: 'Can HOLDBACK, or anyone running it, take the money?',
    a: 'No. Funds sit in a vault owned by the hold account. Until the release time only the sender can move them, and only back to the sender. Afterwards anyone can release them, and only to the recipient. The admin key cannot touch any vault, and pausing never blocks undo or release.',
  },
  {
    q: 'Can the recipient get the money before the window ends?',
    a: 'Only if the sender signs an early release. Nothing reaches the recipient early otherwise; that is one of the six invariants the property test checks.',
  },
  {
    q: 'What if the risk agent or this website is down?',
    a: 'No new payment is built without a verdict: the app fails closed. Holds that already exist do not depend on any service. A wallet that can sign can undo, release and close with the SDK alone.',
  },
  {
    q: 'Why would an honest recipient accept waiting?',
    a: 'The default wait is 30 minutes, and none at all once the sender marks them as trusted. A recipient sees the hold, its release time and its tier, the way a merchant sees a pending card payment.',
  },
  {
    q: 'Which tokens work?',
    a: 'Native SOL, SPL Token and Token-2022 mints. Fee-on-transfer and transfer-hook mints are refused. Tokens an issuer can freeze can be stuck while frozen.',
  },
  {
    q: 'Has it been audited?',
    a: 'No. The program is on devnet and unaudited. It has unit tests, localnet scenarios and a property test; the results page lists what has run where and what has not.',
  },
  {
    q: 'What is stored about me?',
    a: 'The evidence document for each assessment, a mirror of public hold data, and caches. The note you write about why you are paying is read once and never stored; only the ids of the cues it matched leave the collector.',
  },
];

export default function DocsPage() {
  return (
    <main>
      <PageOpener
        word="Docs"
        ink="water"
        page={7}
        motif="tickets"
        lead="What you need to run it, read it and check it: commands, addresses, accounts, the routes this site serves, and plain answers to common questions."
      />

      <div className="wrap docs section--tight">
        <nav aria-label="On this page" className="toc docs__nav">
          <a href="#run">Run it</a>
          <a href="#addresses">Addresses</a>
          <a href="#accounts">Accounts and seeds</a>
          <a href="#routes">This site&apos;s routes</a>
          <a href="#pay-links">Pay links</a>
          <a href="#faq">Questions</a>
        </nav>

        <div className="docs__body">
          <section aria-labelledby="run">
            <h2 id="run" className="h2">
              Run it
            </h2>
            <p className="prose">From the repository root:</p>
            <pre className="code" tabIndex={0}>
              {`npm install                      # sdk, dojo, mcp, guardian
anchor build && npm run idl:sync
cargo test -p holdback           # Rust tests + 2,000-case property test
npm run program:fuzz             # 100,000 cases -> eval/program_invariants.json
npm run program:test:localnet    # integration tests on a local validator
npm test                         # all TypeScript packages
make eval                        # dataset, baseline, metrics, bench`}
            </pre>
            <p className="prose">
              This site, from <code>apps/web</code>:
            </p>
            <pre className="code" tabIndex={0}>
              {`npm install
cp .env.example .env.local
npm run dev            # http://localhost:3000
npm run cf:build       # next build + the Worker bundle`}
            </pre>
            <p className="prose">
              Every environment value is optional. A missing one switches that integration off and
              the site says it is unavailable; it never substitutes made-up data.
            </p>
          </section>

          <section aria-labelledby="addresses">
            <h2 id="addresses" className="h2">
              Addresses
            </h2>
            <dl className="kv">
              <div className="kv__row">
                <dt>Cluster</dt>
                <dd>
                  <span className="mono">{publicEnv.cluster}</span>. Unaudited.
                </dd>
              </div>
              <div className="kv__row">
                <dt>Program</dt>
                <dd>
                  <span className="addr">
                    <a
                      href={explorerUrl('address', PROGRAM_ID)}
                      className="mono link"
                      rel="noreferrer"
                    >
                      {PROGRAM_ID}
                    </a>
                    <Copy value={PROGRAM_ID} label="program id" />
                  </span>
                </dd>
              </div>
              <div className="kv__row">
                <dt>Config account</dt>
                <dd>
                  <span className="addr">
                    <a
                      href={explorerUrl('address', CONFIG_ADDRESS)}
                      className="mono link"
                      rel="noreferrer"
                    >
                      {CONFIG_ADDRESS}
                    </a>
                    <Copy value={CONFIG_ADDRESS} label="config address" />
                  </span>
                </dd>
              </div>
              <div className="kv__row">
                <dt>Framework</dt>
                <dd>
                  Anchor, with SPL Token and Token-2022 through one interface, and native SOL.
                </dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="accounts">
            <h2 id="accounts" className="h2">
              Accounts and seeds
            </h2>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Seeds</th>
                    <th scope="col">Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {ACCOUNTS.map(([name, seeds, purpose]) => (
                    <tr key={name}>
                      <td>
                        <span className="mono">{name}</span>
                      </td>
                      <td>
                        <span className="mono">{seeds}</span>
                      </td>
                      <td>{purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="prose rules-note">
              Instructions: <span className="mono">{INSTRUCTIONS.join(', ')}</span>.
            </p>
          </section>

          <section aria-labelledby="routes">
            <h2 id="routes" className="h2">
              This site&apos;s routes
            </h2>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Route</th>
                    <th scope="col">What it does</th>
                  </tr>
                </thead>
                <tbody>
                  {ROUTES.map(([route, what]) => (
                    <tr key={route}>
                      <td>
                        <span className="mono">{route}</span>
                      </td>
                      <td>{what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="prose rules-note">
              A receipt lives at <span className="mono">/h/&lt;hold address&gt;</span> and a Scam
              Dojo run can be watched at <span className="mono">/dojo/watch/&lt;run id&gt;</span>.
            </p>
          </section>

          <section aria-labelledby="pay-links">
            <h2 id="pay-links" className="h2">
              Pay links
            </h2>
            <p className="prose">
              A link of the form{' '}
              <span className="mono">/pay?to=&lt;address&gt;&amp;amount=12.5</span> asks for a
              payment that goes through a hold. Wallets and sites that understand Solana Actions
              turn it into a card; everyone else lands on a page with the same description and one
              button.
            </p>
            <dl className="kv" style={{ marginTop: 'var(--s4)' }}>
              <div className="kv__row">
                <dt className="mono">to</dt>
                <dd>The recipient address.</dd>
              </div>
              <div className="kv__row">
                <dt className="mono">amount</dt>
                <dd>Whole units of the asset. When it is missing, the payer is asked for it.</dd>
              </div>
              <div className="kv__row">
                <dt className="mono">mint</dt>
                <dd>A mint address, SOL (the default) or, on devnet, USDC.</dd>
              </div>
              <div className="kv__row">
                <dt className="mono">lang</dt>
                <dd>en, hi, es or pt.</dd>
              </div>
            </dl>
            <p className="prose rules-note">
              A sanctioned recipient is refused. If the risk agent cannot be reached, no transaction
              is built.
            </p>
          </section>

          <section aria-labelledby="faq">
            <h2 id="faq" className="h2">
              Questions
            </h2>
            <div className="faq">
              {FAQ.map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <div>
                    <p>{item.a}</p>
                  </div>
                </details>
              ))}
            </div>
            <p className="prose rules-note">
              More on what each key can do: <Link href="/evidence#keys">the trust model</Link>.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
