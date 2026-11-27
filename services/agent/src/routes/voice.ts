/** Voice: the spoken note, live sessions with the Guardian agent, and its extend tool. */
import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';
import { LANGS, type Lang, type VoiceSession } from '@holdback/sdk';

import { requireWallet, walletFromAuthorization } from '../auth';
import { MAX_EXTEND_HOURS, extendByHours } from '../chain/oracle';
import { getEvidence } from '../db/evidence';
import { evidenceInUse } from '../db/holds';
import { flag } from '../env';
import { forbidden, notFound, unauthorized } from '../errors';
import { templateSpoken } from '../llm/spoken';
import type { Services } from '../services';
import { sessionCredentials, textToSpeech } from '../voice/elevenlabs';
import { sessionVariables } from '../voice/session';
import { findHoldRow } from './holds';
import { address, body, evidenceHash, lang, parse, type App } from './shared';

const NOTE_BUCKET = 'voice-notes';
const noteKey = (hash: string, language: Lang) => `notes/${hash}-${language}.mp3`;

/** Reads a cached note from R2 when bound, otherwise from Supabase Storage. */
async function readNote(services: Services, key: string): Promise<ArrayBuffer | null> {
  const { env, db } = services;
  try {
    if (env.VOICE_BUCKET) return (await (await env.VOICE_BUCKET.get(key))?.arrayBuffer()) ?? null;
    if (!db) return null;
    const { data } = await db.storage.from(NOTE_BUCKET).download(key);
    return data ? await data.arrayBuffer() : null;
  } catch {
    return null;
  }
}

async function writeNote(services: Services, key: string, audio: ArrayBuffer): Promise<void> {
  const { env, db } = services;
  if (env.VOICE_BUCKET) {
    await env.VOICE_BUCKET.put(key, audio, { httpMetadata: { contentType: 'audio/mpeg' } });
    return;
  }
  if (!db) return;
  const upload = () =>
    db.storage.from(NOTE_BUCKET).upload(key, audio, { contentType: 'audio/mpeg', upsert: true });
  const { error } = await upload();
  if (error) {
    // First use: the bucket does not exist yet.
    await db.storage.createBucket(NOTE_BUCKET, { public: false });
    await upload();
  }
}

export function voiceRoutes(app: App): void {
  app.get('/v1/voice/note/:hash', async (c) => {
    const hash = parse(evidenceHash, c.req.param('hash').toLowerCase());
    const requested = c.req.query('lang');
    const language: Lang = (LANGS as readonly string[]).includes(requested ?? '')
      ? (requested as Lang)
      : 'en';
    const services = c.var.services;
    const evidence = await getEvidence(services.db, hash);
    if (!evidence) throw notFound('No evidence document with this hash');

    const key = noteKey(hash, language);
    let audio = await readNote(services, key);
    // Speech is generated only for evidence behind a real hold: assessments
    // are free to request, and each new note costs synthesis credits.
    if (!audio && services.db && !(await evidenceInUse(services.db, hash))) {
      throw notFound('No hold uses this evidence yet');
    }
    if (!audio) {
      const text = evidence.spoken[language] ?? templateSpoken(evidence.document, language);
      audio = await textToSpeech(c.env, text, language);
      services.background.waitUntil(writeNote(services, key, audio).catch(() => undefined));
    }
    return new Response(audio, {
      headers: {
        'content-type': 'audio/mpeg',
        // The text behind a hash never changes, so neither does its audio.
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  });

  app.post('/v1/voice/session', async (c) => {
    const request = await body(c, z.object({ hold: address, lang }));
    const services = c.var.services;
    const row = await findHoldRow(services, request.hold);
    if (!row) throw notFound('No such hold');
    if (flag(c.env.VOICE_REQUIRE_AUTH)) {
      const caller = await walletFromAuthorization(c.env, c.req.header('authorization'));
      if (caller === null) throw unauthorized();
      if (caller !== row.sender) throw forbidden('Only the sender can talk about this hold');
    }
    const evidence = await getEvidence(services.db, row.evidence_hash);
    const credentials = await sessionCredentials(c.env);
    const session: VoiceSession = {
      ...credentials,
      dynamicVariables: sessionVariables(
        row,
        evidence?.document ?? null,
        evidence?.spoken[request.lang] ?? null,
        request.lang,
        new Date(),
      ),
    };
    return c.json(session);
  });

  // Called by the agent's `extend_hold` tool through the app. Only the
  // sender may lengthen their own hold; nobody can shorten one.
  app.post('/v1/voice/extend', async (c) => {
    const caller = await requireWallet(c.env, c.req.header('authorization'));
    const request = await body(
      c,
      z.object({ hold: address, hours: z.number().int().min(1).max(MAX_EXTEND_HOURS) }),
    );
    const services = c.var.services;
    const row = await findHoldRow(services, request.hold);
    if (!row) throw notFound('No such hold');
    if (row.sender !== caller) throw forbidden('Only the sender can extend this hold');
    return c.json(await extendByHours(services, new PublicKey(request.hold), request.hours));
  });
}
