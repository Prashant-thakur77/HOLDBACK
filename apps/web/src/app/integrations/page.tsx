import type { Metadata } from 'next';

import { PageOpener } from '@/components/site/blocks';

export const metadata: Metadata = {
  title: 'Integrations',
  description:
    'What each integration does in HOLDBACK and where it lives in the repository: Seeker, Pollar, ElevenLabs, Firecrawl, Supabase and Byte.',
};

interface Integration {
  id: string;
  name: string;
  role: string;
  text: string;
  facts: [string, string][];
}

/** Only what the repository implements; "Not yet" comes from the README's status table. */
const INTEGRATIONS: Integration[] = [
  {
    id: 'seeker',
    name: 'Solana Mobile / Seeker',
    role: 'The phone app',
    text: 'A native Android app. Holds, undo, early release, trust and flags are signed directly through Mobile Wallet Adapter. A "Verified Seeker owner" badge comes from a server-side Seeker Genesis Token check.',
    facts: [
      ['In the repo', 'apps/mobile, and GET /v1/seeker/:wallet in the risk agent'],
      [
        'You get',
        'The same holds and receipts as on the web, with the voice Guardian and Scam Dojo offline',
      ],
    ],
  },
  {
    id: 'pollar',
    name: 'Pollar',
    role: 'Wallets that can only transfer',
    text: 'A Pollar wallet can send tokens to an address and nothing else. The user pays into their own on-chain deposit box; the relayer opens the hold and can only ever return funds to the owner. Login is a proof by transfer: send an exact random amount to your own box.',
    facts: [
      ['In the repo', 'DepositBox in the program; the /v1/relay endpoints in the risk agent'],
      [
        'Enforced by',
        'The program: the hold’s sender is taken from the box, never from instruction data',
      ],
    ],
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    role: 'The voice',
    text: 'The "Holdback Guardian" voice agent speaks Hindi, English, Spanish and Portuguese, explains the evidence behind a hold and can trigger undo. Suspicious and flagged holds get a generated voice note, which a receipt plays only when you press play.',
    facts: [
      [
        'In the repo',
        'services/agent/src/voice; five client tools, among them explain_evidence and undo_hold',
      ],
      ['Not yet', 'Live calls to the service from a deployed agent'],
    ],
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    role: 'Web reports',
    text: 'Searches the web for reports about the recipient and reads the results. A source counts only if its text contains the exact address; that check is done in code, not by the model, and a quote must appear on the page it is attributed to.',
    facts: [
      ['In the repo', 'The web_reports collector in services/agent'],
      [
        'On a receipt',
        'Each web source appears with its quote, its date and a link you can follow',
      ],
    ],
  },
  {
    id: 'supabase',
    name: 'Supabase',
    role: 'Records and live updates',
    text: 'Evidence documents, a Realtime mirror of holds for countdowns, caches and profiles, with row-level security and service-role writes only. The chain stays the source of truth for money in every client.',
    facts: [
      ['In the repo', 'supabase/ (schema, the helius-webhook function, housekeeping)'],
      [
        'On this site',
        'The live counters fall back to it, and the dashboard uses it for live updates after you sign in',
      ],
    ],
  },
  {
    id: 'byte',
    name: 'Byte',
    role: 'Scam Dojo, for agents too',
    text: 'Scam Dojo is eight rounds of real-world payment requests, about 40% of them honest, where checking the address runs the real risk agent. The run result is written to devnet as a memo. The spectator page is built to be embedded in the arena.',
    facts: [
      ['In the repo', 'dojo/ (engine, 65 scenarios, HTTP handler) and /api/dojo on this site'],
      ['Not yet', 'Upload to the arena'],
    ],
  },
];

export default function IntegrationsPage() {
  return (
    <main>
      <PageOpener
        word="Integrations"
        ink="copper"
        page={5}
        lead="Six services do real work in HOLDBACK. This page says what each one does here, where the code is, and what has not been run against the live service yet."
      >
        <nav aria-label="On this page" className="toc">
          {INTEGRATIONS.map((item) => (
            <a key={item.id} href={`#${item.id}`}>
              {item.name}
              <span className="small quiet">{item.role}</span>
            </a>
          ))}
        </nav>
      </PageOpener>

      <div className="wrap section--tight">
        {INTEGRATIONS.map((item) => (
          <section
            key={item.id}
            id={item.id}
            className="integration"
            aria-labelledby={`${item.id}-name`}
          >
            <div>
              <h2 id={`${item.id}-name`} className="integration__name">
                {item.name}
              </h2>
              <p className="integration__role">{item.role}</p>
            </div>
            <div>
              <p className="lead">{item.text}</p>
              <ul className="integration__facts">
                {item.facts.map(([label, value]) => (
                  <li key={label}>
                    <span className="label">{label}</span>
                    <span>{value}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}

        <section className="integration" aria-labelledby="agents-name">
          <div>
            <h2 id="agents-name" className="integration__name">
              AI agents
            </h2>
            <p className="integration__role">Paying through holds</p>
          </div>
          <div>
            <p className="lead">
              A Model Context Protocol server exposes <code>assess_recipient</code>,{' '}
              <code>send_protected_payment</code>, <code>undo_payment</code> and seven more tools,
              so an AI agent pays through holds instead of irreversible transfers. It fails closed:
              no risk verdict, no payment.
            </p>
            <ul className="integration__facts">
              <li>
                <span className="label">In the repo</span>
                <span>mcp/</span>
              </li>
              <li>
                <span className="label">Not yet</span>
                <span>Signing on a real cluster</span>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
