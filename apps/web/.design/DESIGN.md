# HOLDBACK web: design system

One direction, built on the taste profile (`taste.md`) and the world board (`world.md`).

**Counter ticket.** The site is a piece of printed counter matter: tinted deposit-book paper,
one printing ink per object, rule lines that are the layout, and a punched hour-grid ticket for
every hold. The clock is a copper bowl sinking in a basin of water, and the visitor lifts it out.

## Taste (copied from taste.md; every choice is checked against it)

- IS **unhurried** (one thing at a time, a steady drain), **accountable** (rules, serials, dates,
  sources and hashes are visible layout), **neighbourly** (ticket and passbook colours, plain
  words, your language and numerals).
- NEVER **alarmist** (no red grounds, flashing or pulsing countdowns), **crypto-hype** (no neon,
  dark, glow, 3D coins), **bureaucratic** (no cold grey, no walls of small print).
- Feel in motion: mechanical and liquid, never elastic. Marks land heavy (70 ms down, 40 ms
  hold, 160 ms release). Paper slides with friction (420 ms, strong ease-out). Water is slow
  (3 s bob, 900 ms sink, 320 ms lift). The drain is the only linear motion.
- Material: flat tinted paper, one or two inks per surface, real holes, stamp ink drawn as
  broken shape. No shadows, no glass, no gradients, no rounded cards.
- Lines not to cross: no pulsing countdown, no danger sections, no caricatures, no fake ageing,
  no imitation of a real operator's ticket or a postal or state mark, no script as ornament,
  the word "safe" is never promised.
- Comfort: light ground everywhere. Body 16 px or more, 44 px touch targets, large numerals.

## Colour tokens

Every colour is tuned from a sampled source on the world board and named after it. Text forms
pass 4.5:1 on every surface (`node .design/palette-check.mjs`).

| Token                         | Hex                   | Source                    | Role                                     |
| ----------------------------- | --------------------- | ------------------------- | ---------------------------------------- |
| `--paper`                     | `#e7e8d6`             | deposit book page         | ground (about 70%)                       |
| `--stock`                     | `#f4f2e4`             | pamphlet paper            | raised: tickets, forms, app panels       |
| `--inset`                     | `#d9dbc6`             | passbook page in shade    | wells, the empty part of a drain         |
| `--card`                      | `#f6da83`             | card rail ticket          | highlight stock, used rarely             |
| `--ink`                       | `#221c44`             | cheque handwriting ink    | text, rules, slabs                       |
| `--quiet`                     | `#4f4a73`             | handstamp violet          | secondary text                           |
| `--blue` / `--blue-ink`       | `#394d96` / `#2f3f80` | lottery ticket blue       | lead pigment; tier "new"; links          |
| `--red` / `--red-ink`         | `#b5282e` / `#9a1f27` | letter box enamel         | stamps and marks only; tier "sanctioned" |
| `--magenta` / `--magenta-ink` | `#ab5375` / `#8a3458` | bus ticket magenta        | tier "flagged"                           |
| `--green` / `--green-ink`     | `#719754` / `#3a5e22` | lottery ticket green      | tier "trusted"; a match; a good call     |
| `--ochre-ink`                 | `#7a5a0e`             | manila envelope, darkened | tier "suspicious"                        |
| `--copper` / `--copper-ink`   | `#bd7f51` / `#7a4a22` | beaten copper bowl        | the bowl, nothing else                   |
| `--water` / `--water-ink`     | `#325785` / `#2a4a73` | water in daylight         | the basin, drain bars                    |
| `--tin`                       | `#acaeb4`             | tin basin                 | the basin wall                           |

Rules: no pure black, white or grey. Red is never a ground and never the only signal. A tier is
told by position and label first, ink second. Each ink keeps one meaning across site and app.

## Type

Two families. Self-hosted WOFF2, `font-display: swap`, the Latin display face preloaded.

- **Anek Latin** (variable: weight 100-800, width 75-125) with **Anek Devanagari** (500, 800),
  one superfamily, so Hindi matches Latin in weight and colour. Condensed heavy capitals echo
  the fare block of a ticket; the regular width is the reading face.
- **Azeret Mono** (variable) for serials, addresses, hashes and amounts in code: the
  numbering-machine face, never quite like the rest.

| Role         | Family / weight / width | Size (360 to 1440)                     | Line | Tracking | Notes                         |
| ------------ | ----------------------- | -------------------------------------- | ---- | -------- | ----------------------------- |
| Hero display | Anek 800 / 80           | `clamp(46px, 7.7vw, 116px)` (46 / 111) | 0.9  | -0.012em | second line in an ink slab    |
| Page opener  | Anek 800 / 78           | `clamp(52px, 12vw, 190px)` (52 / 173)  | 0.86 | -0.015em | one word                      |
| h2           | Anek 800 / 80           | `clamp(32px, 4.4vw, 64px)` (32 / 63)   | 0.98 | -0.005em | balance                       |
| h3           | Anek 700 / 88           | `clamp(21px, 1.9vw, 27px)`             | 1.12 | 0        |                               |
| Lead         | Anek 400 / 100          | `clamp(18px, 1.5vw, 22px)`             | 1.45 | 0        | max 34em                      |
| Body         | Anek 400 / 100          | 17px (16.5 on phones)                  | 1.55 | 0        | max 66ch, `text-wrap: pretty` |
| Small        | Anek 400                | 14px                                   | 1.45 | 0        | never under 12                |
| Label        | Anek 700 / 112          | 12px                                   | 1.1  | +0.08em  | caps; column heads only       |
| Button, nav  | Anek 700 / 100          | 16-17px                                | 1    | 0        | sentence case                 |
| Numeral      | Anek 700 / 76           | `clamp(40px, 5vw, 76px)`               | 0.95 | -0.01em  | tabular                       |
| Serial, code | Azeret Mono 500         | 13-15px                                | 1.4  | -0.01em  | wraps anywhere                |

Devanagari: line-height 1.3 for display and 1.7 for text, no negative tracking, no width
change, and Devanagari numerals on the ticket grid.

## Space, shape, layers

- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 72, 112 (`--s1` to `--s9`).
- Grid: 12 columns, max width 1360 px, gutter `clamp(16px, 3vw, 40px)`.
- Radius: 0 everywhere. The only round things are holes, stamps and the bowl.
- Rules: 3 px opens a section, 1 px divides columns and rows, 2 px boxes a form or a control.
  A dashed 1 px rule is a perforation: it marks where something can be torn off or undone.
- Layers: page 0, sticky header 20, contents sheet 40, page-turn overlay 60, skip link 80.

## Motion system

| Name        | Value                               | Used for                           |
| ----------- | ----------------------------------- | ---------------------------------- |
| `--t-press` | 70 ms                               | a punch or stamp going down        |
| `--t-lift`  | 160 ms                              | its release; hovers; presses       |
| `--t-slide` | 420 ms                              | paper sliding: menu, reveals, page |
| `--t-water` | 900 ms                              | the bowl sinking; slow reveals     |
| `--e-paper` | `cubic-bezier(0.16, 0.84, 0.3, 1)`  | friction, no overshoot             |
| `--e-press` | `cubic-bezier(0.5, 0, 0.9, 0.4)`    | going down                         |
| `--e-sink`  | `cubic-bezier(0.55, 0, 0.85, 0.35)` | easing in                          |

- Stagger 50 ms. Reveals play once. Nothing that is being read moves.
- Scroll: rules draw across, headline lines rise from a mask, stamps land once when their
  section arrives. No pinning, no scroll-jacking, native scroll.
- Page transition: the old page slides up 24 px and out, the new one slides in from 24 px below
  (View Transitions, `--t-slide`). Browsers without it navigate plainly.
- Reduced motion: no travel, no bobbing, no auto-play; state changes still show; the bowl
  jumps between states; the drain still shortens because it is a clock.
- Start states are set under `html.js` only, so everything is visible with scripts off.

## The signature moment: lift the bowl

Where: first screen of the home page, beside the headline.

1. The visitor answers "Who are you paying?" (someone I trust, someone new, looks suspicious,
   flagged wallet). A hole is punched in the ticket's hour grid at the window the policy gives
   that tier (none, 30 minutes, 6 hours, 24 hours). The numbers come from the SDK's table.
2. The bowl is set on the water and starts to fill at one steady rate. Twenty seconds on screen
   stand for the whole window, and the caption says so.
3. **Take it back** lifts the bowl out (320 ms), stamps TAKEN BACK across the ticket and says
   where the money went. Waiting lets the bowl go under (900 ms): RELEASED, stamped in neutral ink, because a release is
   an outcome and not a reward.
4. "Float it again" resets. Keyboard: the choices are a radio group, the action is a button.
   Touch: the same controls, 48 px tall. Reduced motion: no bob or travel; states switch.

It teaches the whole product: the evidence sets the size of the hole, time is the bowl filling,
undo is a hand lifting it out.

## Home page motion score

| Region       | Entrance                                            | Scroll / idle                      | Response                             |
| ------------ | --------------------------------------------------- | ---------------------------------- | ------------------------------------ |
| Header       | mark is punched once (press, lift)                  | hides going down, returns going up | patch grows on hover; contents sheet |
| Hero         | lines rise from masks, slab slides in (slide)       | bowl bobs 3 s; drain runs          | punch, lift, stamp                   |
| Counters     | top rule draws; numerals appear                     | refresh every 30 s                 | none                                 |
| The problem  | rule draws; figures set in cells                    | none                               | source links                         |
| How it works | five tier tickets punched one after another (50 ms) | none                               | hover lifts a ticket 4 px            |
| Verifiable   | date stamp lands on the hash                        | none                               | open a receipt by address            |
| Results      | rule draws; counts set                              | none                               | none                                 |
| Dojo teaser  | box stamp lands                                     | none                               | link                                 |
| Footer       | wordmark letters rise from a mask                   | small bowl bobs                    | the O is punched on hover            |

## Art system

One ink per object, flat fills, line weight 1 to 3 px, no shading except straight hatching.

| Piece          | Meaning                                         | Where                               |
| -------------- | ----------------------------------------------- | ----------------------------------- |
| Punched ticket | a hold: serial, amount, hour grid, one hole     | hero, tier strip, receipt, app rows |
| Bowl and basin | the undo window as time you can see and stop    | hero, receipt, footer               |
| Date stamp     | something happened at a time and can be checked | evidence, receipt, results          |
| Box stamp      | an outcome: taken back, released, hash matches  | hero, receipt, Dojo rounds, 404     |
| Crossing       | held, not payable yet                           | how it works                        |
| Perforation    | this part can be undone or torn off             | dividers, counterfoils              |
| Ink patch      | a page, and the same ink for its tier           | nav, section heads                  |

Art stops at tables, forms and long text. Stamps are struck at an angle, at most one per
section. Nothing imitates a real ticket, emblem or postal mark.

## Play

| Thing to do     | Trigger                 | Teaches                                      |
| --------------- | ----------------------- | -------------------------------------------- |
| Lift the bowl   | hero controls           | the window, and that undo is one action      |
| Verify the hash | button on a receipt     | the evidence cannot have been changed        |
| Scam Dojo       | `/dojo`, eight requests | how to tell a scam, with the real risk agent |
| Switch language | header                  | the ticket's numerals change with the script |
| Open a receipt  | paste a hold address    | every hold is public and checkable           |

## Second pass: more motion, art and play

Everything below sits on top of the system above and obeys the same taste. Story pages may be
lively; app screens (`/app`, `/h/*`, `/pay`, the spectator page) stay calm and load none of it.

### Motion, by region

| Region           | What moves                                                                                                     | How it is built                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Opening          | One large ticket fills the screen, a hole is punched, and the hole grows until only the hero is left (1.5 s)   | CSS only (`@property` on a mask radius); first page of a visit only |
| Hero             | Headline line rises from a mask, the slab slides in; bowl bobs; the clock runs or is dragged                   | CSS and the demo's own state                                        |
| Section headings | Each line rises out of its own mask when the heading arrives                                                   | GSAP SplitText, lazy                                                |
| Figures          | Count up to the value already printed in the page                                                              | GSAP, lazy; the printed value is restored at the end                |
| Drawings         | Every motif draws itself in, stroke by stroke, then its accent appears                                         | CSS on `pathLength="1"` strokes                                     |
| How it works     | Five stages scroll on the left; one drawing stays put on the right and changes with them                       | CSS sticky + GSAP ScrollTrigger; only the bowl's fill is scrubbed   |
| Buttons          | Primary buttons lean toward a fine pointer and settle without a bounce; outline buttons take ink from the left | GSAP (lean), CSS (ink)                                              |
| Page turn        | A sheet of paper with the next page's patch, number and name slides up, then away                              | CSS; the next page's opener then rises                              |
| Scroll           | Smooth scroll on wide pointer screens only; phones keep native scrolling                                       | Lenis, lazy                                                         |
| Footer           | A row of hours to punch; the wordmark arrives and its O is punched                                             | CSS                                                                 |

Rules that did not change: decisive marks (punch, stamp, lift) land at once and are never
scrubbed slowly; nothing bounces; nothing that is being read moves; with reduced motion none of
the libraries load and every state is still shown.

### Art

- **Illustration set** (`src/components/art/Motifs.tsx`): punch, rubber stamp, ledger, phone,
  counter, speaker, report, deposit box, message slips, ticket pad. One ink line of even weight,
  flat accents in the page's ink, paper fills to hide lines behind. Each page opener carries one.
- **The counter scene** (Integrations): six objects standing on one counter top, each with a
  plate that names who it is and what it does, each a link to its section.
- **Ticket, two settings:** the full ticket carries its small print and is drawn 290 px wide or
  more; the compact ticket drops the small print and enlarges the rest for narrow places. No
  text on any ticket is drawn under 12 px.

### Play

| Thing to do        | Physical action    | Where          | Teaches                                                     |
| ------------------ | ------------------ | -------------- | ----------------------------------------------------------- |
| Lift the bowl      | lift it out        | hero           | undo is one action                                          |
| Drag the time      | watch the bowl     | hero           | at which hour an undo is still possible, and when it is not |
| Spot the scam      | mark a box         | home           | the tells, on three real Dojo scenarios; one is honest      |
| Verify any receipt | strike a stamp     | home, evidence | the hash is recomputed by the visitor's own browser         |
| Punch an hour      | punch              | footer         | the tier table read backwards, from time to reason          |
| Sound              | punch, stamp, gong | hero, footer   | off by default; synthesised, no audio files                 |

Each one works by touch, mouse and keyboard, answers at once, and can be reset.

### Where the lively parts stop

The seven public pages get the full footer (the row of hours, the punched wordmark). App screens
and dead ends (`/app`, `/h/*`, `/pay`, 404) get the slim footer: small print and the page list.
Under 620 px, wide tables become labelled cards, the hero ticket takes the full width above the
bowl, and the Dojo's decision row stays at the bottom of the screen.

## Components

Header with ink-patch nav and language switch; contents sheet (focus trapped, Esc closes, page
behind does not scroll); footer with small-print notices and the punched wordmark; buttons
(solid ink, outline, quiet link); ledger cells; section head (h2 + patch + page number); ticket;
bowl; stamps; drain bar; tier pill; key-value ledger; form fields (2 px box, label above, hint
below); notices (rule on the left, never a coloured ground); empty, loading and error states in
the same voice.

## Sitemap

| Page            | Ink     | Job and section order                                                                            |
| --------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `/`             | ink     | claim + toy, counters, the problem, how a hold works, verifiable, results, Dojo, integrations    |
| `/how-it-works` | blue    | one payment step by step: assess, decide, commit, hold, undo or settle; tiers; limits            |
| `/evidence`     | magenta | evidence hash, eight collectors, what each key can and cannot do, six invariants, open a receipt |
| `/results`      | green   | what was measured, generated from the eval data; what has run where                              |
| `/integrations` | copper  | one section per integration: what it does here and how it is wired                               |
| `/dojo`         | red     | play eight requests in the browser; rules; watch link                                            |
| `/docs`         | water   | run it, program id, accounts and seeds, HTTP surface, FAQ                                        |
| `404`           | ink     | a "nothing at this address" slip that points back in                                             |
| `/app`          | ink     | connect, send with live verdict and pre-sign preview, holds with countdown and actions           |
| `/h/[holdPda]`  | by tier | public receipt as a ticket: parties, amount, status, countdown, evidence, verify the hash        |
| `/pay`          | ink     | a payment request slip with the recipient's verdict and one button                               |
| `/dojo/watch/`  | red     | spectator view, framed, readable at 320 px                                                       |

App screens run calm: no entrances, only feedback (press, drain, stamp on outcome).

## Logo

A solid ink square with an H reversed out and a round hole punched through the crossbar: a
ticket cell that has been decided. Wordmark: HOLDBACK in condensed capitals; in the footer the
O is a hole. Motion: punched once on load, again on hover; still under reduced motion.
Files: `public/action-icon.svg`, `src/app/icon.svg`, `public/og.png`.
