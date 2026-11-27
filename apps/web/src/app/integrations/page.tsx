import type { Metadata } from 'next';

import { Motif, type MotifName } from '@/components/art/Motifs';
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
  /** The object that stands for it on the counter. */
  motif: MotifName;
  text: string;
  facts: [string, string][];
}

/** Only what the repository implements; "Not yet" comes from the README's status table. */
const INTEGRATIONS: Integration[] = [
  {
    id: 'seeker',
    name: 'Solana Mobile / Seeker',
    role: 'The phone app',
    motif: 'phone',
    text: 'A native Android app. Holds, undo, early release, trust and flags are signed directly through Mobile Wallet Adapter. A "Verified Seeker owner" badge comes from a server-side Seeker Genesis Token check.',
    facts: [
      ['In the repo', 'apps/mobile, and GET /v1/seeker/:wallet in the risk agent'],
      ['Verified', 'A signed release build against the live services'],
      ['Not yet', 'Any run on a device or emulator'],
    ],
  },
  {
    id: 'pollar',
    name: 'Pollar',
    role: 'Wallets that can only transfer',
    motif: 'box',
    text: 'A Pollar wallet can send tokens to an address and nothing else. The user pays into their own on-chain deposit box; the relayer opens the hold and can only ever return funds to the owner. Login is a proof by transfer: send an exact random amount to your own box.',
    facts: [
      ['In the repo', 'DepositBox in the program; the /v1/relay endpoints in the risk agent'],
      [
        'Enforced by',
        'The program: the hold’s sender is taken from the box, never from instruction data',
      ],
      ['Verified', 'The publishable key is accepted for native clients, with Solana enabled'],
    ],
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    role: 'The voice',
    motif: 'speaker',
    text: 'The "Holdback Guardian" voice agent speaks Hindi, English, Spanish and Portuguese, explains the evidence behind a hold and can trigger undo. Suspicious and flagged holds get a generated voice note, which a receipt plays only when you press play.',
    facts: [
      [
        'In the repo',
        'services/agent/src/voice; five client tools, among them explain_evidence and undo_hold',
      ],
      ['Verified', 'The voice agent exists, and a live Hindi voice note was served and cached'],
      ['Not yet', 'The outbound phone call'],
    ],
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    role: 'Web reports',
    motif: 'report',
    text: 'Searches the web for reports about the recipient and reads the results. A source counts only if its text contains the exact address; that check is done in code, not by the model, and a quote must appear on the page it is attributed to.',
    facts: [
      ['In the repo', 'The web_reports collector in services/agent'],
      [
        'On a receipt',
        'Each web source appears with its quote, its date and a link you can follow',
      ],
      ['Verified', 'A live assessment with the web-reports collector answering'],
    ],
  },
  {
    id: 'supabase',
    name: 'Supabase',
    role: 'Records and live updates',
    motif: 'ledger',
    text: 'Evidence documents, a Realtime mirror of holds for countdowns, caches and profiles, with row-level security and service-role writes only. The chain stays the source of truth for money in every client.',
    facts: [
      ['In the repo', 'supabase/ (schema, the helius-webhook function, housekeeping)'],
      [
        'On this site',
        'The live counters fall back to it, and the dashboard uses it for live updates after you sign in',
      ],
      ['Verified', 'The webhook mirrored a live hold from pending to taken back'],
    ],
  },
  {
    id: 'byte',
    name: 'Byte',
    role: 'Scam Dojo, for agents too',
    motif: 'slips',
    text: 'Scam Dojo is eight rounds of real-world payment requests, about 40% of them honest, where checking the address runs the real risk agent. The run result is written to devnet as a memo. The spectator page is built to be embedded in the arena.',
    facts: [
      ['In the repo', 'dojo/ (engine, 65 scenarios, HTTP handler) and /api/dojo on this site'],
      ['Verified', 'A live run, with its result written to devnet as a memo'],
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
        motif="counter"
        lead="Six services do real work in HOLDBACK. This page says what each one does here, where the code is, and what has not been run against the live service yet."
      />

      <section className="wrap counter-scene" aria-labelledby="counter-title">
        <h2 id="counter-title" className="label">
          Who works at the counter
        </h2>
        <ul className="counter-scene__row" data-ink="copper">
          {INTEGRATIONS.map((item, index) => (
            <li key={item.id} data-reveal="draw" style={{ ['--i' as string]: index }}>
              <a href={`#${item.id}`}>
                <Motif name={item.motif} size={132} />
                <span className="counter-scene__plate">
                  <b>{item.name}</b>
                  <span>{item.role}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>

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
              <span className="integration__motif" data-ink="copper" data-reveal="draw">
                <Motif name={item.motif} size={110} />
              </span>
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
