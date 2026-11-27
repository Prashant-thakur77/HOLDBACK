# HOLDBACK web: design brief

Written 2026-11-27. Scope: the public site and the app screens in `apps/web`.

## Subject

Every Solana payment gets an undo window enforced by an on-chain program. A risk agent sizes
that window from live, cited scam evidence: no wait for people the sender trusts, up to 24 hours
for a flagged wallet. When the recipient looks dangerous, a voice in the sender's language says
why, and one tap brings the money back before a scammer can claim it.

## Audience

1. Hackathon judges: Solana ecosystem engineers and partner-track sponsor staff. They open the
   home page first, often only that page, on a laptop, and want proof they can check.
2. Everyday crypto users in India and Latin America who are afraid of being scammed. Phone
   first, mid-range Android, often outdoors, reading Hindi, English, Spanish or Portuguese.

## The one job of the site

Make a first-time visitor understand in five seconds that a payment here can be taken back for
a set time, and that the length of that time was decided from evidence they can inspect.

- Primary action: **Send a protected payment** (opens `/app`).
- Second action, for judges: **Open a live receipt** (a real `/h/[holdPda]` page with its
  evidence list and hash check).

## The subject's world

- **Materials:** thin tinted ticket paper, one-colour letterpress ink, rubber-stamp ink that
  never covers evenly, punched holes and the chads they leave, perforated tear lines, gummed
  revenue stamps, a copper bowl with a pinhole floating in a pot of water.
- **Vernacular:** the conductor's punched bus ticket, the lottery ticket with its "expires"
  line, the passbook column, the cheque crossed with two lines, the money that the post office
  returns to the sender, the shop-counter speaker that says each payment out loud.
- **Textures:** flat tint, visible rule lines, numerals in a grid, ink heavier on one side of a
  stamp, a serial number in a different face from everything else. No grunge, no fake ageing.
- **Motion:** a water level that moves at one steady rate; a punch that goes down fast and
  comes back slower; paper that slides with friction and tears along a line; a bowl that bobs,
  fills, and goes under.
- **Sounds:** the click of a ticket punch, a stamp thud, a single gong when the bowl sinks, a
  calm voice. Sound is off until the visitor turns it on.

## Dials

| Dial      | Story pages | App screens |
| --------- | ----------- | ----------- |
| CRAZINESS | 8           | 3           |
| MOTION    | 7           | 3           |
| DENSITY   | 5           | 5           |
| ART       | 7           | 3           |
| PLAY      | 8           | 3           |
| CALM      | 8           | 8           |

Why they differ from the defaults: MOTION is 7, not 8, because the second audience is on
mid-range phones and the page must stay light; DENSITY is 5 because evidence, results and trust
tables are the argument; CALM is 8 because these readers arrive frightened and urgency is the
scammer's tool, not ours. CRAZINESS lives in the idea and the art, not in the effect count.

## Hard constraints

- **Stack:** Next.js on Cloudflare Workers through OpenNext. `@holdback/sdk` for every chain
  and agent call. No WebGL dependency for the core story.
- **Languages:** en, hi, es, pt, switchable on every page. Layouts allow about 30% longer
  strings than English; Devanagari gets its own line-height and numerals.
- **Content that must appear:** the one-line pitch; live counters from real data (holds, value
  protected, value reclaimed); how a hold works; the evidence sources and the trust model for
  the oracle, the relayer and the deposit box; a results table generated from the eval data,
  including the negative result; one section per partner integration; Scam Dojo; docs and FAQ
  with the program id and account seeds; a designed 404.
- **Numbers:** every figure on the site is read from data or code at build or run time. An
  estimate is labelled as an estimate. Nothing is typed in by hand.
- **App screens:** `/app` dashboard, `/h/[holdPda]` public receipt with client-side hash
  verification, `/dojo/watch/[runId]` spectator page (embedded in a partner frame).
- **Performance targets:** Lighthouse mobile performance 85 or better, CLS under 0.1,
  accessibility 95 or better; usable at 360 px; keyboard reachable with visible focus;
  `prefers-reduced-motion` respected; content readable with JavaScript off.
- **Deadline:** submissions close Sunday 29 November 2026.

## Sitemap draft (finalised after the main reference is chosen)

| Page                  | Its one job                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `/` Home              | Tell the whole story on one page: what a hold is, the live counters, the window you can touch, proof, the way in. |
| `/how-it-works`       | Walk one payment from send to verdict to window to undo or release, step by step.                                 |
| `/evidence`           | Show where a verdict comes from and what each trusted party can and cannot do.                                    |
| `/results`            | Show what was measured, generated from the eval data, with the negative result in plain view.                     |
| `/partners`           | One section per integration: what it does here, the user flow, how it is wired.                                   |
| `/dojo`               | Scam Dojo: explain the game, start a run, show recent runs.                                                       |
| `/docs`               | Setup, program id, account seeds, FAQ.                                                                            |
| `404`                 | A designed dead end that points back in.                                                                          |
| `/app`                | Dashboard: send, see holds draining, undo.                                                                        |
| `/h/[holdPda]`        | Public receipt: parties, amount, status, countdown, evidence, verify the hash.                                    |
| `/dojo/watch/[runId]` | Watch a Dojo run live.                                                                                            |

## Assumptions

- There is no existing brand. The colours and names in the mobile starter are template
  defaults and are replaced freely.
- Judges read English; the language switch is still shown to them because it is part of the
  product's claim.
- Sound is optional everywhere; the voice note is demonstrated with a visible play control.
