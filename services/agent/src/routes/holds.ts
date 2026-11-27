import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';
import {
  Tier,
  fetchHold,
  fetchHoldsByRecipient,
  fetchHoldsBySender,
  type HoldReceipt,
  type HoldRecord,
  type LiveStats,
} from '@holdback/sdk';

import { getHoldRow, holdToRow, listHoldRows, rowToRecord, type HoldRow } from '../db/holds';
import { notFound, unavailable } from '../errors';
import type { Services } from '../services';
import { address, evidenceHash, parse, type App } from './shared';

const listQuery = z.object({
  wallet: address,
  role: z.enum(['sender', 'recipient']).default('sender'),
});

/** The mirrored row, or the chain account when the mirror has none. */
export async function findHoldRow(services: Services, pda: string): Promise<HoldRow | null> {
  if (services.db) {
    const row = await getHoldRow(services.db, pda).catch(() => null);
    if (row) return row;
  }
  const hold = await fetchHold(services.cluster, new PublicKey(pda), {
    programId: services.programId,
  });
  return hold ? holdToRow(hold) : null;
}

/** Whether a spoken note is offered for this hold: only when voice is configured and risk is raised. */
function voiceNoteUrl(services: Services, origin: string, row: HoldRow): string | null {
  const { env } = services;
  if (!env.ELEVENLABS_API_KEY || !env.ELEVENLABS_VOICE_ID || row.tier < Tier.SUSPICIOUS) {
    return null;
  }
  const base = (env.PUBLIC_BASE_URL || origin).replace(/\/+$/, '');
  return `${base}/v1/voice/note/${row.evidence_hash}`;
}

export function holdRoutes(app: App): void {
  app.get('/v1/holds/:pda', async (c) => {
    const pda = parse(address, c.req.param('pda'));
    const row = await findHoldRow(c.var.services, pda);
    if (!row) throw notFound('No such hold');
    // A receipt is still worth showing when the evidence cannot be read right now.
    const evidence = await c.var.services.storage.evidence.get(row.evidence_hash).catch(() => null);
    const receipt: HoldReceipt = {
      hold: rowToRecord(row),
      document: evidence?.document ?? null,
      spoken: evidence?.spoken ?? {},
      voiceNoteUrl: voiceNoteUrl(c.var.services, new URL(c.req.url).origin, row),
    };
    return c.json(receipt);
  });

  app.get('/v1/holds', async (c) => {
    const { wallet, role } = parse(listQuery, c.req.query());
    const { db, cluster, programId } = c.var.services;
    let holds: HoldRecord[];
    if (db) {
      holds = (await listHoldRows(db, wallet, role)).map(rowToRecord);
    } else {
      // No mirror: the chain still knows every hold that is not closed yet.
      const fetch = role === 'sender' ? fetchHoldsBySender : fetchHoldsByRecipient;
      const onChain = await fetch(cluster, new PublicKey(wallet), { programId });
      holds = onChain.map((hold) => rowToRecord(holdToRow(hold)));
    }
    return c.json({ holds });
  });

  app.get('/v1/evidence/:hash', async (c) => {
    const hash = parse(evidenceHash, c.req.param('hash').toLowerCase());
    const evidence = await c.var.services.storage.evidence.get(hash).catch(() => {
      throw unavailable('Evidence cannot be read right now');
    });
    if (!evidence) throw notFound('No evidence document with this hash');
    // Exactly the hashed document, so a client can recompute the hash.
    return c.json(evidence.document);
  });

  app.get('/v1/stats', async (c) => {
    const { db } = c.var.services;
    if (!db) throw unavailable('Statistics need the database');
    const { data, error } = await db.from('live_stats').select('*').maybeSingle();
    if (error) throw unavailable('Statistics are not available right now');
    const stats: LiveStats = {
      holdsCreated: Number(data?.holds_created ?? 0),
      holdsReclaimed: Number(data?.holds_reclaimed ?? 0),
      holdsReleased: Number(data?.holds_released ?? 0),
      valueProtectedUsd: Number(data?.value_protected_usd ?? 0),
      valueReclaimedUsd: Number(data?.value_reclaimed_usd ?? 0),
      updatedAt: new Date((data?.updated_at as string | undefined) ?? Date.now()).toISOString(),
    };
    return c.json(stats);
  });
}
