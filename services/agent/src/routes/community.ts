/** Reports, push registration, names and the Seeker badge. */
import { z } from 'zod';
import { FlagReason } from '@holdback/sdk';

import { walletFromAuthorization } from '../auth';
import { mirrorFlag } from '../chain/flag-mirror';
import { lookalikeOf } from '../collectors/lookalike';
import { resolveName } from '../collectors/sns';
import { insertFlag } from '../db/flags';
import { getProfile, savePushToken } from '../db/profiles';
import { ApiError, badRequest, forbidden, unauthorized, unavailable } from '../errors';
import { request } from '../lib/http';
import { isExpoToken } from '../push/expo';
import { verifySeeker } from '../seeker';
import { address, body, lang, parse, type App, type Ctx } from './shared';

const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_REASON = Math.max(...Object.values(FlagReason));

const flagRequest = z.object({
  subject: address,
  reason: z.number().int().min(0).max(MAX_REASON),
  note: z.string().max(500).optional(),
  captchaToken: z.string().min(1).max(4_096),
  reporter: address.optional(),
});

const pushRequest = z.object({
  wallet: address,
  pushToken: z.string().refine(isExpoToken, 'must be an Expo push token'),
  lang,
});

/** Asks Cloudflare Turnstile whether `token` is a solved captcha. */
async function captchaPassed(c: Ctx, token: string): Promise<boolean> {
  const secret = c.env.TURNSTILE_SECRET_KEY;
  if (!secret)
    throw unavailable(
      'Reports are not available: captcha is not configured',
      'captcha_unavailable',
    );
  const form = new URLSearchParams({ secret, response: token });
  const ip = c.req.header('cf-connecting-ip');
  if (ip) form.set('remoteip', ip);
  const response = await request(TURNSTILE_VERIFY, {
    method: 'POST',
    body: form,
    timeoutMs: 5_000,
  });
  return ((await response.json()) as { success?: boolean }).success === true;
}

export function communityRoutes(app: App): void {
  app.post('/v1/flags', async (c) => {
    const flag = await body(c, flagRequest);
    const { db, background } = c.var.services;
    if (!db) throw unavailable('Reports need the database');
    if (!(await captchaPassed(c, flag.captchaToken))) {
      throw forbidden('The captcha was not solved', 'captcha_failed');
    }
    const id = await insertFlag(db, {
      subject: flag.subject,
      reporter: flag.reporter ?? null,
      reason: flag.reason,
      note: flag.note?.trim() || null,
    });
    background.waitUntil(
      mirrorFlag(c.var.services, id, flag.subject, flag.reason).catch(() => null),
    );
    return c.json({ id });
  });

  app.post('/v1/push/register', async (c) => {
    const registration = await body(c, pushRequest);
    const { db } = c.var.services;
    if (!db) throw unavailable('Push registration needs the database');

    // A first registration needs no session, so a new install works at once.
    // Replacing a device that is already registered does: otherwise anyone
    // could redirect another wallet's warnings to their own phone.
    const caller = await walletFromAuthorization(c.env, c.req.header('authorization'));
    if (caller !== null && caller !== registration.wallet) {
      throw forbidden('This session belongs to a different wallet');
    }
    const existing = await getProfile(db, registration.wallet);
    const replacing = !!existing?.push_token && existing.push_token !== registration.pushToken;
    if (replacing && caller === null) {
      throw unauthorized('Sign in with this wallet to move notifications to a new device');
    }
    await savePushToken(db, registration.wallet, registration.pushToken, registration.lang);
    return c.json({ ok: true });
  });

  app.get('/v1/names/:name', async (c) => {
    const name = decodeURIComponent(c.req.param('name')).trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,63}(\.sol)?$/.test(name)) {
      throw badRequest('Not a .sol name');
    }
    const full = name.endsWith('.sol') ? name : `${name}.sol`;
    let resolved: string | null;
    try {
      resolved = await resolveName(c.env, full);
    } catch {
      throw new ApiError(502, 'name_service_unavailable', 'The name service did not answer');
    }
    const imitated = lookalikeOf(full);
    return c.json({
      name: full,
      address: resolved,
      lookalikeOf: imitated ? `${imitated}.sol` : null,
    });
  });

  app.get('/v1/seeker/:wallet', async (c) => {
    const wallet = parse(address, c.req.param('wallet'));
    try {
      return c.json(await verifySeeker(c.var.services, wallet));
    } catch {
      throw new ApiError(502, 'mainnet_unavailable', 'Mainnet could not be read right now');
    }
  });
}
